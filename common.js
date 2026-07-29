/**
 * Common utilities — Supabase edition
 * Replaces all Google Apps Script API calls with direct Supabase queries.
 */

/* ---------- Supabase client ---------- */
// Note: supabase-js library creates a global `supabase` object.
// We use _sb for our client instance to avoid name collision.
let _sb = null;
let _realtimeChannels = [];

function initSupabase() {
  if (typeof window !== 'undefined' && window.supabase && CONFIG.SUPABASE_URL.indexOf('PASTE_YOUR') === -1) {
    _sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 10 } }
    });
    console.log('Supabase client initialized');
    return true;
  }
  console.warn('Supabase not initialized — check config.js');
  return false;
}

/* ---------- API helpers (Supabase queries) ---------- */
// All functions return promises, same as before.

// Generic: select from table with optional filters
async function dbSelect(table, filters) {
  if (!_sb) throw new Error('Supabase not initialized');
  let query = _sb.from(table).select('*');
  if (filters) {
    Object.keys(filters).forEach(function(k) {
      const v = filters[k];
      if (v !== undefined && v !== null && v !== '') {
        query = query.eq(k, v);
      }
    });
  }
  const { data, error } = await query;
  if (error) {
    console.error('dbSelect error:', table, error.message, error);
    throw new Error(error.message);
  }
  return data || [];
}

async function dbInsert(table, record) {
  if (!_sb) throw new Error('Supabase not initialized');
  const { data, error } = await _sb.from(table).insert(record).select();
  if (error) {
    console.error('dbInsert error:', table, error.message, error.details, error.hint, record);
    throw new Error(error.message + (error.hint ? ' (подсказка: ' + error.hint + ')' : ''));
  }
  return data && data.length > 0 ? data[0] : record;
}

async function dbInsertBatch(table, records) {
  if (!_sb) throw new Error('Supabase not initialized');
  const { data, error } = await _sb.from(table).insert(records);
  if (error) {
    console.error('dbInsertBatch error:', table, error.message, error.details, error.hint, records);
    throw new Error(error.message + (error.hint ? ' (подсказка: ' + error.hint + ')' : ''));
  }
  return records;
}

async function dbUpdate(table, id, updates) {
  if (!_sb) throw new Error('Supabase not initialized');
  // Use .select() to get the affected rows back. Without it, supabase-js returns
  // data=null and we cannot tell whether the update actually hit any row
  // (RLS without policy, missing id, type mismatch — all silently affect 0 rows).
  const { data, error, count } = await _sb
    .from(table)
    .update(updates)
    .eq('id', id)
    .select();
  if (error) {
    console.error('dbUpdate error:', table, id, error.message, error.details, error.hint, updates);
    throw new Error(error.message + (error.hint ? ' (подсказка: ' + error.hint + ')' : ''));
  }
  if (!data || data.length === 0) {
    throw new Error('Update failed: no rows matched id=' + id + ' (check RLS policies for table "' + table + '")');
  }
  return data[0];
}

async function dbDelete(table, id) {
  if (!_sb) throw new Error('Supabase not initialized');
  const { error } = await _sb.from(table).delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// Atomic increment/decrement of a numeric column using PostgreSQL RPC.
// Falls back to read-modify-write if the RPC is not available.
// This avoids race conditions and bypasses potential UPDATE-only RLS issues.
async function dbIncrementStock(menuItemId, delta) {
  if (!_sb) throw new Error('Supabase not initialized');
  delta = Number(delta) || 0;
  // Try the RPC first (defined in supabase-schema.sql as replenish_stock)
  try {
    const { data, error } = await _sb.rpc('replenish_stock', {
      p_menu_id: menuItemId,
      p_delta: delta
    });
    if (!error && data !== null && data !== undefined) {
      return { id: menuItemId, stock: Number(data) };
    }
    // If RPC fails with "function not found", fall through to read-modify-write
    if (error && error.message && error.message.indexOf('Could not find the function') === -1) {
      console.warn('RPC replenish_stock failed, falling back to RMW:', error.message);
    } else {
      console.warn('RPC replenish_stock not available, using read-modify-write');
    }
  } catch (e) {
    console.warn('RPC replenish_stock exception, falling back:', e.message);
  }
  // Fallback: read-modify-write
  const items = await dbSelect('menu', { id: menuItemId });
  if (items.length === 0) throw new Error('Menu item not found: ' + menuItemId);
  const current = Number(items[0].stock) || 0;
  const newStock = Math.max(0, current + delta);
  console.log('dbIncrementStock fallback: itemId=', menuItemId, 'current=', current, 'delta=', delta, 'new=', newStock);
  await dbUpdate('menu', menuItemId, { stock: newStock });
  return { id: menuItemId, stock: newStock };
}

/* ---------- Settings ---------- */
async function getSetting(key) {
  const rows = await dbSelect('settings', { key: key });
  return rows.length > 0 ? rows[0].value : null;
}

async function saveSettingsToDB(settings) {
  if (!_sb) throw new Error('Supabase not initialized');
  for (const key in settings) {
    const { data: existing } = await _sb.from('settings').select('key').eq('key', key);
    if (existing && existing.length > 0) {
      const { error: updErr } = await _sb.from('settings').update({ value: String(settings[key]) }).eq('key', key);
      if (updErr) console.warn('Setting update error for', key, updErr.message);
    } else {
      const { error: insErr } = await _sb.from('settings').insert({ key: key, value: String(settings[key]) });
      if (insErr) console.warn('Setting insert error for', key, insErr.message);
    }
  }
  if (APP_DATA && APP_DATA.settings) {
    for (const key in settings) {
      APP_DATA.settings[key] = String(settings[key]);
    }
  }
  return APP_DATA ? APP_DATA.settings : settings;
}

/* ---------- Data loader ---------- */
var APP_DATA = null;
var _cachedDataVersion = null;

async function loadAppData(force) {
  if (APP_DATA && !force) return APP_DATA;

  // Load all reference data in parallel (no is_active filter — filter on client)
  const [settings, categories, menu, users, modifications, tables, suppliers, warehouses, accounts, deliveries, deliveryItems, writeoffs, writeoffItems] = await Promise.all([
    dbSelect('settings'),
    dbSelect('categories'),
    dbSelect('menu'),
    dbSelect('users'),
    dbSelect('menu_modifications'),
    dbSelect('tables'),
    dbSelect('suppliers'),
    dbSelect('warehouses'),
    dbSelect('accounts'),
    dbSelect('deliveries'),
    dbSelect('delivery_items'),
    dbSelect('writeoffs'),
    dbSelect('writeoff_items')
  ]);

  // Filter active items on client side
  const activeCategories = categories.filter(function(c) { return c.is_active === true || c.is_active === 'true'; });
  const activeMenu = menu.filter(function(m) { return m.is_active === true || m.is_active === 'true'; });
  const activeUsers = users.filter(function(u) { return u.is_active === true || u.is_active === 'true'; });
  const activeModifications = modifications.filter(function(m) { return m.is_active === true || m.is_active === 'true'; });
  const activeTables = tables.filter(function(t) { return t.is_active === true || t.is_active === 'true'; });

  const settingsObj = {};
  settings.forEach(function(s) { settingsObj[s.key] = s.value; });

  // Group modifications by menu_id for easy access
  const modsByMenu = {};
  activeModifications.forEach(function(mod) {
    if (!modsByMenu[mod.menu_id]) modsByMenu[mod.menu_id] = [];
    modsByMenu[mod.menu_id].push({
      id: mod.id,
      menu_id: mod.menu_id,
      name: mod.name,
      name_translation: mod.name_translation || '',
      price: Number(mod.price) || 0,
      cost: Number(mod.cost) || 0,
      markup: Number(mod.markup) || 0,
      sort: Number(mod.sort) || 0
    });
  });
  // Sort each menu's modifications by sort
  Object.keys(modsByMenu).forEach(function(mid) {
    modsByMenu[mid].sort(function(a, b) { return a.sort - b.sort; });
  });

  // Attach modifications to their menu items
  const menuWithMods = activeMenu.map(function(m) {
    return Object.assign({}, m, {
      cost: Number(m.cost) || 0,
      markup: Number(m.markup) || 0,
      has_modifications: m.has_modifications === true || m.has_modifications === 'true',
      modifications: modsByMenu[m.id] || [],
      image_url: m.image_url || '',
      description: m.description || ''
    });
  });

  // Normalize tables: split into numbered and virtual, sorted by `sort` then number/name
  const normalizedTables = activeTables.map(function(t) {
    return {
      id: t.id,
      type: t.type,
      number: t.number !== null && t.number !== undefined ? Number(t.number) : null,
      label: t.label || '',
      sort: Number(t.sort) || 0
    };
  });
  const numberedTables = normalizedTables
    .filter(function(t) { return t.type === 'numbered'; })
    .sort(function(a, b) { return (a.number || 0) - (b.number || 0); });
  const virtualTables = normalizedTables
    .filter(function(t) { return t.type === 'virtual'; })
    .sort(function(a, b) { return a.sort - b.sort; });

  // For backward compatibility: keep table_count and virtual_tables in settings
  // (some legacy code may still reference them), but the canonical source is APP_DATA.tables
  settingsObj.table_count = String(numberedTables.length);
  settingsObj.virtual_tables = virtualTables.map(function(t) { return t.label; }).join(',');

  APP_DATA = {
    settings: settingsObj,
    categories: activeCategories,
    menu: menuWithMods,
    modifications: activeModifications,
    tables: {
      all: normalizedTables,
      numbered: numberedTables,
      virtual: virtualTables
    },
    suppliers: suppliers.filter(function(s) { return s.is_active === true || s.is_active === 'true'; }),
    warehouses: warehouses.filter(function(w) { return w.is_active === true || w.is_active === 'true'; }),
    accounts: accounts.filter(function(a) { return a.is_active === true || a.is_active === 'true'; }),
    deliveries: deliveries, // all deliveries, including historic — don't filter
    delivery_items: deliveryItems,
    writeoffs: writeoffs,
    writeoff_items: writeoffItems,
    users: activeUsers.map(function(u) {
      return {
        id: u.id,
        name: u.name,
        role: u.role,
        is_active: u.is_active,
        sort: u.sort,
        phone: u.phone || '',
        email: u.email || '',
        last_login: u.last_login || null,
        has_password: !!(u.pin && String(u.pin).length > 0),
        allowed_warehouses: u.allowed_warehouses || ''
      };
    }),
    // Include hidden (is_active=false) users separately so admin can manage them
    users_all: users.map(function(u) {
      return {
        id: u.id,
        name: u.name,
        role: u.role,
        is_active: u.is_active === true || u.is_active === 'true',
        sort: u.sort,
        phone: u.phone || '',
        email: u.email || '',
        last_login: u.last_login || null,
        has_password: !!(u.pin && String(u.pin).length > 0),
        created_at: u.created_at || null,
        allowed_warehouses: u.allowed_warehouses || ''
      };
    })
  };

  return APP_DATA;
}

async function loadAppDataForce() {
  const result = await loadAppData(true);
  // Reset the warehouse dropdown populated flag so it re-renders with fresh data
  try {
    const sel = document.getElementById('stock-warehouse-select');
    if (sel) delete sel.dataset.populated;
  } catch (e) {}
  return result;
}

/* ---------- Orders ---------- */
async function getOrders(status, waiterId) {
  // Query orders and order_items separately to avoid join issues
  let orderQuery = _sb.from('orders').select('*');

  if (status === 'accepted') {
    orderQuery = orderQuery.in('status', ['accepted', 'paused']);
  } else if (status === 'accepted_only') {
    orderQuery = orderQuery.eq('status', 'accepted');
  } else if (status && status !== 'all') {
    orderQuery = orderQuery.eq('status', status);
  }

  if (waiterId) {
    orderQuery = orderQuery.or(`waiter_id.eq.${waiterId},table_type.eq.virtual,table_type.eq.tab`);
  }

  orderQuery = orderQuery.order('created_at', { ascending: false }).limit(200);

  // Fetch orders first
  const { data: orders, error: orderError } = await orderQuery;
  if (orderError) {
    console.error('getOrders error:', orderError);
    throw new Error(orderError.message);
  }

  // Fetch items for these orders IN PARALLEL with a single query
  const orderIds = (orders || []).map(function(o) { return o.id; });
  let items = [];
  if (orderIds.length > 0) {
    const { data: itemsData, error: itemsError } = await _sb
      .from('order_items')
      .select('*')
      .in('order_id', orderIds);
    if (itemsError) {
      console.error('getOrders items error:', itemsError);
    } else {
      items = itemsData || [];
    }
  }

  // Group items by order_id
  const itemsByOrder = {};
  items.forEach(function(it) {
    if (!itemsByOrder[it.order_id]) itemsByOrder[it.order_id] = [];
    itemsByOrder[it.order_id].push({
      id: it.id,
      order_id: it.order_id,
      menu_item_id: it.menu_item_id || '',
      name: it.name,
      name_translation: it.name_translation || '',
      category_name: it.category_name || '',
      category_name_translation: it.category_name_translation || '',
      modification_id: it.modification_id || '',
      modification_name: it.modification_name || '',
      price: Number(it.price) || 0,
      quantity: Number(it.quantity) || 1,
      comment: it.comment || '',
      is_ready: it.is_ready === true,
      is_served: it.is_served === true,
      needs_cooking: it.needs_cooking === true,
      created_at: it.created_at
    });
  });

  // Attach items to orders (sorted by created_at — preserves insertion order)
  const result = (orders || []).map(function(o) {
    var its = (itemsByOrder[o.id] || []).slice();
    its.sort(function(a, b) {
      var ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      var tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (ta !== tb) return ta - tb;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
    o.items = its;
    return o;
  });

  return { orders: orders, server_time: new Date().toISOString() };
}

async function getOrder(id) {
  // Query order and items IN PARALLEL (2 requests at once, not sequentially)
  const [orderResult, itemsResult] = await Promise.all([
    _sb.from('orders').select('*').eq('id', id).single(),
    _sb.from('order_items').select('*').eq('order_id', id).order('created_at', { ascending: true })
  ]);
  if (orderResult.error) throw new Error(orderResult.error.message);
  if (itemsResult.error) console.error('getOrder items error:', itemsResult.error);

  const data = orderResult.data;
  var rawItems = itemsResult.data || [];
  // Defensive sort by created_at (preserves insertion order — fixes items
  // reordering when quantity is updated or another item is removed).
  rawItems.sort(function(a, b) {
    var ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    var tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (ta !== tb) return ta - tb;
    // Fallback: by id (lexicographic — items created at the same millisecond
    // get a stable order based on their random suffix).
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  data.items = rawItems.map(function(it) {
    return {
      id: it.id,
      order_id: it.order_id,
      menu_item_id: it.menu_item_id || '',
      name: it.name,
      name_translation: it.name_translation || '',
      category_name: it.category_name || '',
      category_name_translation: it.category_name_translation || '',
      modification_id: it.modification_id || '',
      modification_name: it.modification_name || '',
      price: Number(it.price) || 0,
      quantity: Number(it.quantity) || 1,
      comment: it.comment || '',
      is_ready: it.is_ready === true,
      is_served: it.is_served === true,
      needs_cooking: it.needs_cooking === true,
      created_at: it.created_at
    };
  });
  return data;
}

async function createOrder(orderData) {
  // Check table conflict for numbered tables
  if (orderData.table_type === 'numbered' || !orderData.table_type) {
    const { data: existing } = await _sb
      .from('orders')
      .select('id, waiter_name')
      .eq('table_number', String(orderData.table_number))
      .eq('status', 'accepted')
      .neq('waiter_id', orderData.waiter_id || '')
      .limit(1);
    if (existing && existing.length > 0) {
      throw new Error('Столик №' + orderData.table_number + ' уже занят другим официантом (' + (existing[0].waiter_name || '') + ')');
    }
  }

  // Generate ID
  const orderId = 'ord_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
  const now = new Date().toISOString();

  const items = orderData.items || [];
  let total = 0;
  items.forEach(function(it) { total += (Number(it.price) || 0) * (Number(it.quantity) || 1); });

  // Insert order
  const orderRecord = {
    id: orderId,
    table_number: String(orderData.table_number || ''),
    table_type: orderData.table_type || 'numbered',
    tab_id: orderData.tab_id || '',
    guests: orderData.guests || 1,
    main_category_id: orderData.main_category_id || '',
    main_category_name: orderData.main_category_name || '',
    status: 'accepted',
    total: total,
    created_at: now,
    waiter_id: orderData.waiter_id || '',
    waiter_name: orderData.waiter_name || '',
    waiter_note: orderData.waiter_note || '',
    payment_method: ''
  };

  await dbInsert('orders', orderRecord);

  // Insert items
  const itemRecords = items.map(function(it) {
    return {
      id: 'it_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6),
      order_id: orderId,
      menu_item_id: it.menu_item_id || '',
      name: it.name,
      name_translation: it.name_translation || '',
      category_name: it.category_name || '',
      category_name_translation: it.category_name_translation || '',
      modification_id: it.modification_id || '',
      modification_name: it.modification_name || '',
      price: Number(it.price) || 0,
      quantity: Number(it.quantity) || 1,
      comment: it.comment || '',
      is_ready: false,
      is_served: false,
      needs_cooking: it.needs_cooking === true,
      created_at: now
    };
  });

  if (itemRecords.length > 0) {
    await dbInsertBatch('order_items', itemRecords);
  }

  // Deduct stock if tracking enabled
  await deductStock(items);

  // Log: order created
  var tableLabel = orderData.table_type === 'virtual' ? orderData.table_number :
                   orderData.table_type === 'tab' ? 'счёт ' + orderData.table_number :
                   'столик ' + orderData.table_number;
  await logOrderAction(orderId, 'created', 'Открыт счёт — ' + tableLabel + ' (' + items.length + ' позиций, ' + (orderData.guests || 1) + ' чел.)');

  // Log: each item in the initial order (so they appear in the history timeline)
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    await logOrderAction(orderId, 'item_added',
      'Добавлено: ' + (it.name || '?') + ' ×' + (it.quantity || 1) +
      (it.modification_name ? ' (' + it.modification_name + ')' : '') +
      (it.comment ? ' — ' + it.comment : ''));
  }

  return await getOrder(orderId);
}

async function updateOrderStatus(orderId, status, paymentMethod, cashAmount, cardAmount) {
  const updates = { status: status };
  if (status === 'completed') {
    updates.completed_at = new Date().toISOString();
    if (paymentMethod) updates.payment_method = paymentMethod;
    // Store payment split amounts
    if (paymentMethod === 'cash') {
      updates.cash_amount = Number(cashAmount) || 0;
      updates.card_amount = 0;
    } else if (paymentMethod === 'card') {
      updates.card_amount = Number(cardAmount) || 0;
      updates.cash_amount = 0;
    } else if (paymentMethod === 'mixed') {
      updates.cash_amount = Number(cashAmount) || 0;
      updates.card_amount = Number(cardAmount) || 0;
    }
  }
  await dbUpdate('orders', orderId, updates);
  // Log completion or cancellation
  if (status === 'completed') {
    var payLabel = paymentMethod === 'cash' ? 'наличные' : (paymentMethod === 'card' ? 'карта' : (paymentMethod === 'mixed' ? 'смешанная' : paymentMethod || ''));
    await logOrderAction(orderId, 'completed', 'Закрыт чек (оплата: ' + payLabel + ')');
  }
  return await getOrder(orderId);
}

async function addItemToOrder(itemData) {
  // Check if the same dish with the same modification already exists in the order.
  // If so, increment its quantity instead of inserting a new row.
  // EXCEPTION: if the new item has a comment ("пояснение"), always insert a new row
  // so the пояснение is preserved (merging would silently drop it).
  const hasComment = !!(itemData.comment && String(itemData.comment).trim());
  if (!hasComment) {
    const existing = await _sb.from('order_items')
      .select('*')
      .eq('order_id', itemData.order_id)
      .eq('menu_item_id', itemData.menu_item_id || '')
      .eq('modification_id', itemData.modification_id || '');
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data && existing.data.length > 0) {
      // Merge — increment qty on existing item
      const row = existing.data[0];
      const newQty = (Number(row.quantity) || 0) + (Number(itemData.quantity) || 1);
      await dbUpdate('order_items', row.id, { quantity: newQty });
      // Deduct stock, recalc total, return updated order
      await deductStock([{ menu_item_id: itemData.menu_item_id, quantity: itemData.quantity }]);
      await recalcOrderTotalDB(itemData.order_id);
      return await getOrder(itemData.order_id);
    }
  }
  // Insert new row (always when there's a comment, or when no matching item exists)
  const itemId = 'it_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
  await dbInsert('order_items', {
    id: itemId,
    order_id: itemData.order_id,
    menu_item_id: itemData.menu_item_id || '',
    name: itemData.name,
    name_translation: itemData.name_translation || '',
    category_name: itemData.category_name || '',
    category_name_translation: itemData.category_name_translation || '',
    modification_id: itemData.modification_id || '',
    modification_name: itemData.modification_name || '',
    price: Number(itemData.price) || 0,
    quantity: Number(itemData.quantity) || 1,
    comment: itemData.comment || '',
    is_ready: false,
    is_served: false,
    needs_cooking: itemData.needs_cooking === true,
    created_at: new Date().toISOString()
  });

  // Deduct stock
  await deductStock([{ menu_item_id: itemData.menu_item_id, quantity: itemData.quantity }]);

  // Log: item added
  await logOrderAction(itemData.order_id, 'item_added',
    'Добавлено: ' + (itemData.name || '?') + ' ×' + (itemData.quantity || 1) +
    (itemData.modification_name ? ' (' + itemData.modification_name + ')' : '') +
    (itemData.comment ? ' — ' + itemData.comment : ''));

  // Recalc total
  await recalcOrderTotalDB(itemData.order_id);
  return await getOrder(itemData.order_id);
}

async function updateItemQuantity(itemId, quantity) {
  await dbUpdate('order_items', itemId, { quantity: Number(quantity) });
  // Recalc order total
  const item = await dbSelect('order_items', { id: itemId });
  if (item.length > 0) {
    await recalcOrderTotalDB(item[0].order_id);
    // Log: qty changed
    await logOrderAction(item[0].order_id, 'qty_changed',
      'Изменено количество: ' + (item[0].name || '?') + ' → ' + quantity + ' шт');
    return await getOrder(item[0].order_id);
  }
  return null;
}

async function updateItemComment(itemId, comment) {
  await dbUpdate('order_items', itemId, { comment: comment || '' });
}

async function removeItemFromOrder(itemId) {
  const items = await dbSelect('order_items', { id: itemId });
  if (items.length === 0) throw new Error('Item not found');
  const orderId = items[0].order_id;
  var itemInfo = items[0].name + ' ×' + items[0].quantity;
  await dbDelete('order_items', itemId);
  await recalcOrderTotalDB(orderId);
  // Log: item removed
  await logOrderAction(orderId, 'item_removed', 'Удалено: ' + itemInfo);
  return await getOrder(orderId);
}

async function toggleItemReady(itemId, isReady) {
  await dbUpdate('order_items', itemId, { is_ready: isReady === true });
  const items = await dbSelect('order_items', { id: itemId });
  if (items.length > 0) return await getOrder(items[0].order_id);
  return null;
}

async function toggleItemServedDB(itemId, isServed) {
  // If cook disabled, also set is_ready = true
  const cookEnabled = String(await getSetting('cook_enabled')) !== 'false';
  const updates = { is_served: isServed === true };
  if (isServed && !cookEnabled) {
    // Check if item needs cooking
    const items = await dbSelect('order_items', { id: itemId });
    if (items.length > 0) {
      const it = items[0];
      const needsCooking = it.needs_cooking === true;
      if (needsCooking) {
        updates.is_ready = true;
      }
    }
  }
  // Also auto-set is_ready for non-cooking items
  if (isServed) {
    const items = await dbSelect('order_items', { id: itemId });
    if (items.length > 0 && !items[0].needs_cooking) {
      updates.is_ready = true;
    }
  }
  await dbUpdate('order_items', itemId, updates);
  const items2 = await dbSelect('order_items', { id: itemId });
  if (items2.length > 0) return await getOrder(items2[0].order_id);
  return null;
}

async function deleteOrder(orderId) {
  // Delete logs first, then items, then order
  try { await _sb.from('order_logs').delete().eq('order_id', orderId); } catch(e) {}
  await _sb.from('order_items').delete().eq('order_id', orderId);
  await dbDelete('orders', orderId);
  return { ok: true };
}

// ===== Order logging =====
// Logs an action to the order_logs table. Fire-and-forget — errors are ignored.
async function logOrderAction(orderId, action, details) {
  try {
    var logId = 'log_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
    await dbInsert('order_logs', {
      id: logId,
      order_id: orderId,
      action: action,
      details: details || '',
      created_at: new Date().toISOString()
    });
  } catch (e) { /* ignore logging errors */ }
}

// Get all logs for an order, sorted DESCENDING (newest first — fresh action on top)
async function getOrderLogs(orderId) {
  const logs = await dbSelect('order_logs', { order_id: orderId });
  logs.sort(function(a, b) {
    return new Date(b.created_at) - new Date(a.created_at);
  });
  return logs;
}

// Mark an order as cancelled (preserving it for statistics) with a reason.
// Order items are preserved too so admins can review what was cancelled.
async function cancelOrderWithReasonDB(orderId, cancelReason) {
  var result = await dbUpdate('orders', orderId, {
    status: 'cancelled',
    cancel_reason: cancelReason || '',
    cancelled_at: new Date().toISOString()
  });
  // Log: order cancelled
  await logOrderAction(orderId, 'cancelled', 'Заказ отменён' + (cancelReason ? ' — ' + cancelReason : ''));
  return result;
}

async function pauseOrderDB(orderId) {
  return await dbUpdate('orders', orderId, { status: 'paused' });
}

async function resumeOrderDB(orderId) {
  return await dbUpdate('orders', orderId, { status: 'accepted' });
}

async function recalcOrderTotalDB(orderId) {
  const items = await dbSelect('order_items', { order_id: orderId });
  let total = 0;
  items.forEach(function(it) {
    total += (Number(it.price) || 0) * (Number(it.quantity) || 1);
  });
  await dbUpdate('orders', orderId, { total: total });
}

/* ---------- Tables ---------- */
async function getTables(waiterId) {
  // Run all 3 queries IN PARALLEL — table_count setting + orders + virtual_tables setting
  const [tcResult, ordersResult, vtResult] = await Promise.all([
    _sb.from('settings').select('value').eq('key', 'table_count').single(),
    _sb.from('orders').select('table_number, waiter_id, waiter_name, table_type').eq('status', 'accepted'),
    _sb.from('settings').select('value').eq('key', 'virtual_tables').single()
  ]);
  const tableCount = Number(tcResult.data?.value) || 20;
  const activeOrders = ordersResult.data || [];
  const virtualTablesSetting = vtResult.data?.value || '';

  const tables = [];
  for (let i = 1; i <= tableCount; i++) {
    const occ = activeOrders.find(function(o) {
      return String(o.table_number) === String(i) && (!o.table_type || o.table_type === 'numbered');
    });
    let status = 'free', waiterName = '';
    if (occ) {
      waiterName = occ.waiter_name || '';
      if (waiterId && occ.waiter_id === waiterId) status = 'mine';
      else status = 'other';
    }
    tables.push({ table: i, type: 'numbered', status: status, waiter_name: waiterName });
  }

  // Virtual tables
  const virtualNames = virtualTablesSetting.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
  virtualNames.forEach(function(name) {
    const activeCount = activeOrders.filter(function(o) {
      return o.table_type === 'virtual' && String(o.table_number).indexOf(name) === 0;
    }).length;
    tables.push({ table: name, type: 'virtual', status: activeCount > 0 ? 'active' : 'free', active_count: activeCount });
  });

  return { tables: tables };
}

/* ---------- Shifts ---------- */
async function openShiftDB(waiterId, waiterName, openingCash) {
  // Check if already has open shift
  const existing = await dbSelect('shifts', { waiter_id: waiterId, status: 'open' });
  if (existing.length > 0) throw new Error('У вас уже открыта смена');

  const id = 'shift_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
  const now = new Date().toISOString();
  const cash = openingCash !== undefined ? Number(openingCash) : Number(await getSetting('cash_register')) || 0;

  const shift = await dbInsert('shifts', {
    id: id,
    waiter_id: waiterId,
    waiter_name: waiterName || '',
    opened_at: now,
    opening_cash: cash,
    orders_count: 0,
    guests_count: 0,
    cash_total: 0,
    card_total: 0,
    status: 'open'
  });

  return {
    id: id,
    waiter_id: waiterId,
    waiter_name: waiterName || '',
    opened_at: now,
    opening_cash: cash,
    status: 'open',
    current_cash: cash
  };
}

async function closeShift(waiterId, actualCash) {
  const shifts = await dbSelect('shifts', { waiter_id: waiterId, status: 'open' });
  if (shifts.length === 0) throw new Error('Нет открытой смены');
  const shift = shifts[0];

  // SAFETY: block close if there are active (non-completed) orders — EXCEPT virtual/tab
  const activeOrders = await dbSelect('orders', { waiter_id: waiterId, status: 'accepted' });
  const blockingOrders = activeOrders.filter(function(o) {
    return o.table_type !== 'virtual' && o.table_type !== 'tab';
  });
  if (blockingOrders.length > 0) {
    const labels = blockingOrders.map(function(o) {
      const num = o.table_number || '?';
      const type = o.table_type || 'numbered';
      if (type === 'tab') return 'счёт ' + num;
      if (type === 'virtual') return num;
      return 'столик ' + num;
    });
    throw new Error('Нельзя закрыть смену: есть незавершённые заказы (' + labels.join(', ') + '). Сначала завершите их. Виртуальные заказы и счета могут переходить между сменами.');
  }

  // Calculate stats from completed orders
  const { data: orders } = await _sb
    .from('orders')
    .select('*')
    .eq('waiter_id', waiterId)
    .eq('status', 'completed')
    .gte('completed_at', shift.opened_at);

  let cashTotal = 0, cardTotal = 0, guestsCount = 0;
  (orders || []).forEach(function(o) {
    const total = Number(o.total) || 0;
    if (o.payment_method === 'cash') cashTotal += total;
    else if (o.payment_method === 'card') cardTotal += total;
    guestsCount += Number(o.guests) || 0;
  });

  const openingCash = Number(shift.opening_cash) || 0;

  // ===== Fetch shift_transactions (incassations + supply payments + writeoffs) for this shift =====
  let incassationTotal = 0, supplyPaymentTotal = 0, writeoffTotal = 0;
  try {
    const { data: txs } = await _sb.from('shift_transactions')
      .select('*')
      .eq('shift_id', shift.id);
    (txs || []).forEach(function(t) {
      if (t.type === 'incassation') incassationTotal += Number(t.amount) || 0;
      else if (t.type === 'supply_payment') supplyPaymentTotal += Number(t.amount) || 0;
      else if (t.type === 'writeoff') writeoffTotal += Number(t.amount) || 0;
    });
  } catch (e) {
    console.warn('Failed to fetch shift_transactions for shift', shift.id, e.message);
  }

  // Expected cash in drawer:
  //   openingCash + cashOrdersDuringShift + writeoffsCreditedDuringShift
  //   - incassationsDuringShift - supplyPaymentsDuringShift
  // (writeoffs ADD to cash because the sale amount is credited to the cash register)
  const expectedCash = openingCash + cashTotal + writeoffTotal - incassationTotal - supplyPaymentTotal;
  // actualCash is what the waiter counted; if not provided, fall back to expected
  const countedCash = (actualCash !== undefined && actualCash !== null && actualCash !== '')
    ? Number(actualCash) : expectedCash;
  const cashDifference = countedCash - expectedCash;

  const now = new Date().toISOString();
  await dbUpdate('shifts', shift.id, {
    closed_at: now,
    status: 'closed',
    cash_total: cashTotal,
    card_total: cardTotal,
    orders_count: (orders || []).length,
    guests_count: guestsCount,
    actual_cash: countedCash,
    cash_difference: cashDifference,
    incassation_total: incassationTotal,
    supply_payment_total: supplyPaymentTotal,
    writeoff_total: writeoffTotal
  });

  // Set cash_register to the counted amount (the actual money in the drawer)
  // NOTE: the previous logic added countedCash to currentCash, which double-counted.
  // The correct value is just countedCash — that IS what's in the drawer right now.
  await saveSettingsToDB({ cash_register: String(countedCash) });

  return {
    id: shift.id,
    opened_at: shift.opened_at,
    closed_at: now,
    opening_cash: openingCash,
    orders_count: (orders || []).length,
    guests_count: guestsCount,
    cash_total: cashTotal,
    card_total: cardTotal,
    incassation_total: incassationTotal,
    supply_payment_total: supplyPaymentTotal,
    writeoff_total: writeoffTotal,
    expected_cash: expectedCash,
    actual_cash: countedCash,
    cash_difference: cashDifference,
    final_cash: countedCash,
    status: 'closed'
  };
}

/* ---------- Waiter transactions: incassation + supply from cash register ---------- */
// waiterTransaction(data) — handles two types of cash-register movements initiated
// by the waiter from the index.html top-bar transaction button.
//
// data.type:        'incassation' | 'supply'
// data.amount:      number (required for incassation; for supply, computed from items if not given)
// data.waiter_id:   string (required)
// data.waiter_name: string
// data.supplier_name: string (supply only)
// data.supplier_id:   string (supply only, optional — looked up by name if absent)
// data.items:       array (supply only) — same shape as saveDelivery items
// data.comment:     string (optional)
//
// Both types:
//   1. Find the waiter's open shift (fail if none)
//   2. Find the cash-register account (is_cash_register=true)
//   3. Deduct amount from cash_register setting
//   4. Record a shift_transaction row linked to the shift
//   'supply' type additionally:
//   5. Create a delivery record (with warehouse = first cash-register-linked warehouse)
//   6. Apply items to stock if data.apply_to_stock is true
async function waiterTransaction(data) {
  if (!data || !data.waiter_id) throw new Error('waiter_id required');
  if (!data.type || (data.type !== 'incassation' && data.type !== 'supply')) {
    throw new Error('type must be "incassation" or "supply"');
  }

  // 1. Find the waiter's open shift
  const shifts = await dbSelect('shifts', { waiter_id: data.waiter_id, status: 'open' });
  if (shifts.length === 0) throw new Error('Нет открытой смены');
  const shift = shifts[0];

  // 2. Find the cash-register account
  const allAccs = await dbSelect('accounts', { is_active: true });
  const cashAcc = allAccs.find(function(a) { return a.is_cash_register === true; });
  if (!cashAcc) {
    throw new Error('Не найден счёт кассы. Отметьте один счёт как "Касса ресторана" в админке.');
  }

  // 3. Find a warehouse linked to the cash-register account (for supply type)
  let warehouseId = '', warehouseName = '';
  if (data.type === 'supply') {
    const allWhs = await dbSelect('warehouses', { is_active: true });
    const linkedWh = allWhs.find(function(w) { return w.account_id === cashAcc.id; });
    if (!linkedWh) {
      throw new Error('Не найден склад, привязанный к кассе ресторана. Создайте склад и привяжите его к счёту кассы.');
    }
    warehouseId = linkedWh.id;
    warehouseName = linkedWh.name;
  }

  // 4. Compute amount
  let amount = Number(data.amount) || 0;
  let deliveryResult = null;
  if (data.type === 'supply') {
    // For supply: amount = sum of items' total_price. If data.amount given, use it; else compute.
    const items = Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) throw new Error('Поставка должна содержать хотя бы один товар');
    if (amount === 0) {
      amount = items.reduce(function(s, it) {
        return s + (Number(it.total_price) || (Number(it.quantity) * Number(it.unit_price)) || 0);
      }, 0);
    }
    if (amount <= 0) throw new Error('Сумма поставки должна быть больше нуля');
  } else {
    // Incassation: amount is required
    if (amount <= 0) throw new Error('Сумма инкассации должна быть больше нуля');
  }

  // 5. Compute the ACTUAL current cash in the drawer:
  //    opening_cash + cash sales during shift - sum of existing shift_transactions
  //    (NOT the stale cash_register setting, which only updates at shift close)
  const openingCash = Number(shift.opening_cash) || 0;
  let cashSales = 0;
  try {
    const { data: shiftOrders } = await _sb
      .from('orders')
      .select('total,payment_method,completed_at')
      .eq('waiter_id', data.waiter_id)
      .eq('status', 'completed')
      .gte('completed_at', shift.opened_at);
    (shiftOrders || []).forEach(function(o) {
      if (o.payment_method === 'cash') cashSales += Number(o.total) || 0;
    });
  } catch (e) { console.warn('Failed to fetch shift orders for cash calc', e.message); }
  let existingTxTotal = 0;
  try {
    const { data: existingTxs } = await _sb.from('shift_transactions')
      .select('amount')
      .eq('shift_id', shift.id);
    (existingTxs || []).forEach(function(t) { existingTxTotal += Number(t.amount) || 0; });
  } catch (e) { console.warn('Failed to fetch existing shift_transactions', e.message); }
  const currentCash = openingCash + cashSales - existingTxTotal;
  if (amount > currentCash) {
    throw new Error('Недостаточно денег в кассе. Текущий остаток: ' + currentCash +
      ' (открытие ' + openingCash + ' + наличные ' + cashSales + ' − вычеты ' + existingTxTotal + ')');
  }

  // 6. For supply: create the delivery record — saveDelivery() handles BOTH
  //    the cash_register deduction AND the shift_transaction recording.
  //    We do NOT deduct or record a transaction here (would be double-counting).
  let supplierName = (data.supplier_name || '').trim();
  let supplierId = data.supplier_id || '';
  if (data.type === 'supply') {
    if (!supplierName) throw new Error('Укажите поставщика');
    // Look up supplier by name (case-insensitive) to get the id
    if (!supplierId) {
      const sups = await dbSelect('suppliers', { is_active: true });
      const found = sups.find(function(s) {
        return String(s.name || '').toLowerCase() === supplierName.toLowerCase();
      });
      if (found) supplierId = found.id;
    }
    deliveryResult = await saveDelivery({
      delivery_date: new Date().toISOString(),
      supplier_id: supplierId,
      supplier_name: supplierName,
      warehouse_id: warehouseId,
      warehouse_name: warehouseName,
      account_id: cashAcc.id,
      account_name: cashAcc.name,
      paid_amount: amount,
      comment: data.comment || ('Поставка от официанта ' + (data.waiter_name || '')),
      items: data.items,
      apply_to_stock: data.apply_to_stock === true
    });
    // saveDelivery already deducted cash_register + recorded shift_transaction
    // Recompute new cash after saveDelivery's deduction
    var newCash = currentCash - amount;
  } else {
    // 7. For incassation: deduct from cash_register + record shift_transaction
    //    (no saveDelivery involved, so we handle it here)
    await saveSettingsToDB({ cash_register: String(currentCash - amount) });
    var newCash = currentCash - amount;
    const txId = 'stx_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4);
    await dbInsert('shift_transactions', {
      id: txId,
      shift_id: shift.id,
      waiter_id: data.waiter_id,
      waiter_name: data.waiter_name || '',
      type: 'incassation',
      amount: amount,
      delivery_id: '',
      supplier_name: '',
      account_id: cashAcc.id,
      comment: data.comment || 'Инкассация'
    });
  }

  return {
    type: data.type,
    amount: amount,
    new_cash_register: newCash,
    delivery: deliveryResult
  };
}

// Read all shift_transactions for a given shift (or for a waiter's open shift)
async function getShiftTransactions(shiftId, waiterId) {
  if (!shiftId && waiterId) {
    const shifts = await dbSelect('shifts', { waiter_id: waiterId, status: 'open' });
    if (shifts.length === 0) return { transactions: [] };
    shiftId = shifts[0].id;
  }
  if (!shiftId) return { transactions: [] };
  const { data, error } = await _sb.from('shift_transactions')
    .select('*')
    .eq('shift_id', shiftId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return { transactions: data || [] };
}

// Fetch all shifts WITH their transactions attached, for the admin statistics view.
// Each shift gets a `transactions` array (may be empty).
async function getAllShiftsWithTransactions() {
  const shifts = await dbSelect('shifts');
  if (shifts.length === 0) return { shifts: [] };
  // Fetch ALL shift_transactions in one query (faster than per-shift)
  const { data: allTxs, error } = await _sb.from('shift_transactions')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  // Group transactions by shift_id
  const txsByShift = {};
  (allTxs || []).forEach(function(t) {
    if (!t.shift_id) return;
    if (!txsByShift[t.shift_id]) txsByShift[t.shift_id] = [];
    txsByShift[t.shift_id].push(t);
  });
  // Attach to each shift
  shifts.forEach(function(s) {
    s.transactions = txsByShift[s.id] || [];
    // Recompute totals from transactions (in case the columns weren't saved)
    let inc = 0, sup = 0, wof = 0;
    s.transactions.forEach(function(t) {
      if (t.type === 'incassation') inc += Number(t.amount) || 0;
      else if (t.type === 'supply_payment') sup += Number(t.amount) || 0;
      else if (t.type === 'writeoff') wof += Number(t.amount) || 0;
    });
    s.incassation_total = s.incassation_total !== undefined ? Number(s.incassation_total) || 0 : inc;
    s.supply_payment_total = s.supply_payment_total !== undefined ? Number(s.supply_payment_total) || 0 : sup;
    s.writeoff_total = s.writeoff_total !== undefined ? Number(s.writeoff_total) || 0 : wof;
  });
  return { shifts: shifts };
}

// Compute the ACTUAL current cash for a waiter's open shift.
// Returns a breakdown so the UI can display where the money came from / went.
//   current_cash = opening_cash + cash_sales - sum(shift_transactions)
async function getWaiterCurrentCash(waiterId) {
  const shifts = await dbSelect('shifts', { waiter_id: waiterId, status: 'open' });
  if (shifts.length === 0) {
    return { has_open_shift: false, current_cash: 0, opening_cash: 0, cash_sales: 0, deductions: 0 };
  }
  const shift = shifts[0];
  const openingCash = Number(shift.opening_cash) || 0;
  let cashSales = 0;
  try {
    const { data: shiftOrders } = await _sb
      .from('orders')
      .select('total,payment_method')
      .eq('waiter_id', waiterId)
      .eq('status', 'completed')
      .gte('completed_at', shift.opened_at);
    (shiftOrders || []).forEach(function(o) {
      if (o.payment_method === 'cash') cashSales += Number(o.total) || 0;
    });
  } catch (e) { console.warn('getWaiterCurrentCash: failed to fetch orders', e.message); }
  let deductions = 0, writeoffCredits = 0;
  try {
    const { data: txs } = await _sb.from('shift_transactions')
      .select('amount,type')
      .eq('shift_id', shift.id);
    (txs || []).forEach(function(t) {
      const amt = Number(t.amount) || 0;
      // Deductions (incassation, supply_payment) subtract from cash.
      // Writeoffs ADD to cash (sale amount credited to cash register).
      if (t.type === 'writeoff') writeoffCredits += amt;
      else deductions += amt;
    });
  } catch (e) { console.warn('getWaiterCurrentCash: failed to fetch transactions', e.message); }
  return {
    has_open_shift: true,
    shift_id: shift.id,
    opening_cash: openingCash,
    cash_sales: cashSales,
    deductions: deductions,
    writeoff_credits: writeoffCredits,
    current_cash: openingCash + cashSales + writeoffCredits - deductions
  };
}

async function getActiveShift(waiterId) {
  // Run all 3 queries IN PARALLEL
  const [shifts, cashSetting, cookSetting] = await Promise.all([
    dbSelect('shifts', { waiter_id: waiterId, status: 'open' }),
    _sb.from('settings').select('value').eq('key', 'cash_register').single(),
    _sb.from('settings').select('value').eq('key', 'cook_enabled').single()
  ]);
  const shift = shifts.length > 0 ? shifts[0] : null;
  const currentCash = Number(cashSetting.data?.value) || 0;
  const cookEnabled = String(cookSetting.data?.value) !== 'false';
  return { shift: shift, current_cash: currentCash, cook_enabled: cookEnabled };
}

/* ---------- Tables ---------- */
// Check if there are any open shifts across all waiters.
// Table configuration changes are blocked while at least one shift is open,
// to prevent breaking in-flight orders / shift reports.
async function hasOpenShifts() {
  const shifts = await dbSelect('shifts', { status: 'open' });
  return shifts.length > 0;
}

// Get the current tables configuration (numbered + virtual).
// Returns: { numbered: [...], virtual: [...], open_shifts: bool }
async function getTablesConfig() {
  const allTables = await dbSelect('tables');
  const active = allTables.filter(function(t) { return t.is_active === true || t.is_active === 'true'; });
  const numbered = active
    .filter(function(t) { return t.type === 'numbered'; })
    .map(function(t) {
      return {
        id: t.id,
        type: 'numbered',
        number: t.number !== null && t.number !== undefined ? Number(t.number) : null,
        label: t.label || '',
        sort: Number(t.sort) || 0
      };
    })
    .sort(function(a, b) { return (a.number || 0) - (b.number || 0); });
  const virtual = active
    .filter(function(t) { return t.type === 'virtual'; })
    .map(function(t) {
      return {
        id: t.id,
        type: 'virtual',
        number: null,
        label: t.label || '',
        sort: Number(t.sort) || 0
      };
    })
    .sort(function(a, b) { return a.sort - b.sort; });
  const openShifts = await hasOpenShifts();
  return { numbered: numbered, virtual: virtual, open_shifts: openShifts };
}

// Save the tables configuration. Blocked if any shift is open.
// Inputs:
//   numberedCount: int — how many numbered tables (1..N)
//   numberedLabels: { [number]: string } — custom labels per number (optional)
//   virtual: [{ label: string }] — virtual tables (id assigned automatically)
async function saveTablesConfig(config) {
  // SAFETY: never allow table changes while any shift is open
  if (await hasOpenShifts()) {
    throw new Error('Невозможно изменить столы: есть открытые смены. Сначала закройте все смены.');
  }

  // Validate input
  const numberedCount = parseInt(config.numbered_count, 10) || 0;
  if (numberedCount < 0 || numberedCount > 500) {
    throw new Error('Количество столиков должно быть от 0 до 500');
  }
  const virtualList = Array.isArray(config.virtual) ? config.virtual : [];
  for (const v of virtualList) {
    if (!v.label || !String(v.label).trim()) {
      throw new Error('У виртуального столика должно быть название');
    }
  }

  // Get existing tables so we can preserve ids where possible
  const existing = await dbSelect('tables');
  const existingNumbered = existing.filter(function(t) { return t.type === 'numbered'; });
  const existingVirtual = existing.filter(function(t) { return t.type === 'virtual'; });

  // Mark all existing tables as inactive first (we'll re-activate the ones we want)
  // This preserves history — old orders still reference table_number/table_type
  // directly, and we don't lose the table rows in case we want to re-activate.
  for (const t of existing) {
    if (t.is_active === true || t.is_active === 'true') {
      try {
        await dbUpdate('tables', t.id, { is_active: false });
      } catch (e) {
        console.warn('Failed to deactivate table', t.id, e.message);
      }
    }
  }

  // Re-activate / create numbered tables 1..N
  const numberedLabels = config.numbered_labels || {};
  for (let i = 1; i <= numberedCount; i++) {
    const id = 'tbl_num_' + i;
    const label = String(numberedLabels[i] || '').trim();
    // Try to find an existing row with this id (could be active or inactive)
    const existingRow = existingNumbered.find(function(t) { return t.id === id; });
    if (existingRow) {
      await dbUpdate('tables', id, { is_active: true, number: i, label: label, sort: i, type: 'numbered' });
    } else {
      await dbInsert('tables', {
        id: id,
        type: 'numbered',
        number: i,
        label: label,
        is_active: true,
        sort: i,
        created_at: new Date().toISOString()
      });
    }
  }

  // Re-activate / create virtual tables
  for (let i = 0; i < virtualList.length; i++) {
    const v = virtualList[i];
    const id = 'tbl_vir_' + (i + 1);
    const label = String(v.label).trim();
    const existingRow = existingVirtual.find(function(t) { return t.id === id; });
    if (existingRow) {
      await dbUpdate('tables', id, { is_active: true, label: label, sort: i + 1, type: 'virtual', number: null });
    } else {
      await dbInsert('tables', {
        id: id,
        type: 'virtual',
        number: null,
        label: label,
        is_active: true,
        sort: i + 1,
        created_at: new Date().toISOString()
      });
    }
  }

  return { ok: true, numbered: numberedCount, virtual: virtualList.length };
}

/* ---------- Suppliers / Warehouses / Accounts ---------- */
// These are simple CRUD wrappers. Each record has an `id`, a name, optional
// extra fields, and `is_active` (we never hard-delete — just deactivate, so
// historical deliveries still reference the right supplier/warehouse/account).

async function saveSupplier(data) {
  const id = data.id || 'sup_' + Date.now().toString(36);
  const existing = await dbSelect('suppliers', { id: id });
  const record = {
    name: (data.name || '').trim(),
    phone: (data.phone || '').trim(),
    address: (data.address || '').trim(),
    comment: (data.comment || '').trim(),
    is_active: data.is_active !== false
  };
  if (existing.length > 0) {
    return await dbUpdate('suppliers', id, record);
  } else {
    record.id = id;
    return await dbInsert('suppliers', record);
  }
}

async function deleteSupplier(id) {
  // Soft-delete: just mark as inactive so historical deliveries still work
  return await dbUpdate('suppliers', id, { is_active: false });
}

async function saveWarehouse(data) {
  const id = data.id || 'wh_' + Date.now().toString(36);
  const existing = await dbSelect('warehouses', { id: id });
  const record = {
    name: (data.name || '').trim(),
    comment: (data.comment || '').trim(),
    account_id: data.account_id || '',
    is_active: data.is_active !== false
  };
  if (existing.length > 0) {
    return await dbUpdate('warehouses', id, record);
  } else {
    record.id = id;
    return await dbInsert('warehouses', record);
  }
}

async function deleteWarehouse(id) {
  return await dbUpdate('warehouses', id, { is_active: false });
}

async function saveAccount(data) {
  const id = data.id || 'acc_' + Date.now().toString(36);
  const existing = await dbSelect('accounts', { id: id });
  const record = {
    name: (data.name || '').trim(),
    currency: data.currency || '₾',
    type: data.type || 'cash', // cash | card | bank
    initial_balance: Number(data.initial_balance) || 0,
    is_cash_register: data.is_cash_register === true,
    is_active: data.is_active !== false
  };
  // Enforce: only ONE account can be the cash register
  if (record.is_cash_register) {
    // Find all other accounts currently flagged and unset them
    const allAccs = await dbSelect('accounts', {});
    for (const a of allAccs) {
      if (a.id !== id && a.is_cash_register === true) {
        try { await dbUpdate('accounts', a.id, { is_cash_register: false }); } catch(e) { console.warn(e.message); }
      }
    }
    // Sync the cash_register setting:
    // - On FIRST designation (new account or non-cash → cash): only seed if cash_register is 0
    // - On subsequent saves (already cash): if the user manually changed the balance,
    //   treat it as a manual correction and update cash_register to match
    const wasCashRegister = existing.length > 0 && existing[0].is_cash_register === true;
    try {
      const currentCash = Number(await getSetting('cash_register')) || 0;
      const newBalance = Number(record.initial_balance) || 0;
      if (!wasCashRegister) {
        // First time being designated as cash register
        if (currentCash === 0 && newBalance > 0) {
          await saveSettingsToDB({ cash_register: String(newBalance) });
        }
      } else {
        // Already was cash register — if balance changed, treat as manual correction
        const oldBalance = Number(existing[0].initial_balance) || 0;
        if (Math.abs(newBalance - currentCash) >= 0.01 && Math.abs(newBalance - oldBalance) >= 0.01) {
          // User entered a new value that differs from both stored balance AND current cash_register
          // → treat as a manual correction
          await saveSettingsToDB({ cash_register: String(newBalance) });
        }
      }
    } catch(e) { console.warn('Failed to sync cash_register', e.message); }
  }
  if (existing.length > 0) {
    return await dbUpdate('accounts', id, record);
  } else {
    record.id = id;
    return await dbInsert('accounts', record);
  }
}

async function deleteAccount(id) {
  return await dbUpdate('accounts', id, { is_active: false });
}

/* ---------- Deliveries ---------- */
// A delivery is a header (date, supplier, warehouse, account, paid/unpaid,
// total) plus a list of items. Each item links to a menu_item_id (or has a
// free-form name), with pack/quantity/unit_price/total_price.
//
// Saving a delivery does NOT automatically update menu.stock — that's a
// separate decision per item (the UI offers "apply to stock" checkboxes).
// The replenishStock() RPC is used when applying.

// Get the next delivery number from the settings counter
async function getNextDeliveryNumber() {
  const cur = await getSetting('delivery_number_seq');
  let n = parseInt(cur, 10);
  if (isNaN(n)) n = 1;
  await saveSettingsToDB({ delivery_number_seq: String(n + 1) });
  return n;
}

// Get a single delivery with its items, joined with names for display
async function getDelivery(deliveryId) {
  const deliveries = await dbSelect('deliveries', { id: deliveryId });
  if (deliveries.length === 0) throw new Error('Поставка не найдена');
  const delivery = deliveries[0];
  const items = await dbSelect('delivery_items', { delivery_id: deliveryId });
  items.sort(function(a, b) { return (Number(a.sort) || 0) - (Number(b.sort) || 0); });
  delivery.items = items;
  return delivery;
}

// Get all deliveries with their items. Sorted by delivery_date desc.
async function getAllDeliveries() {
  const deliveries = await dbSelect('deliveries');
  const items = await dbSelect('delivery_items');
  // Group items by delivery_id
  const itemsByDelivery = {};
  items.forEach(function(it) {
    if (!itemsByDelivery[it.delivery_id]) itemsByDelivery[it.delivery_id] = [];
    itemsByDelivery[it.delivery_id].push({
      id: it.id,
      menu_item_id: it.menu_item_id || '',
      name: it.name,
      pack: it.pack || '',
      quantity: Number(it.quantity) || 0,
      unit: it.unit || 'шт',
      unit_price: Number(it.unit_price) || 0,
      markup: Number(it.markup) || 0,
      total_price: Number(it.total_price) || 0,
      sort: Number(it.sort) || 0
    });
  });
  // Attach items to deliveries and sort
  const result = deliveries.map(function(d) {
    return {
      id: d.id,
      number: d.number,
      delivery_date: d.delivery_date,
      supplier_id: d.supplier_id || '',
      supplier_name: d.supplier_name || '',
      warehouse_id: d.warehouse_id || '',
      warehouse_name: d.warehouse_name || '',
      account_id: d.account_id || '',
      account_name: d.account_name || '',
      is_paid: d.is_paid === true || d.is_paid === 'true',
      paid_amount: Number(d.paid_amount) || 0,
      total_amount: Number(d.total_amount) || 0,
      status: d.status || 'received',
      comment: d.comment || '',
      items: (itemsByDelivery[d.id] || []).sort(function(a, b) { return a.sort - b.sort; })
    };
  });
  result.sort(function(a, b) {
    return new Date(b.delivery_date) - new Date(a.delivery_date);
  });
  return result;
}

// Get all deliveries that contain a specific menu_item_id — used in the
// stock report's "Поставки" link next to each item.
async function getDeliveriesForMenuItem(menuItemId) {
  const all = await getAllDeliveries();
  return all.filter(function(d) {
    return d.items.some(function(it) { return it.menu_item_id === menuItemId; });
  }).map(function(d) {
    // Filter items to only those for this menu item
    return Object.assign({}, d, {
      items: d.items.filter(function(it) { return it.menu_item_id === menuItemId; })
    });
  });
}

// Get deliveries that contain an item with a specific NAME (case-insensitive).
// Used for delivery-only items (no menu_item_id) — e.g. "Соль", "Моющее средство".
// Optionally filter by warehouse_id.
async function getDeliveriesForItemName(itemName, warehouseId) {
  const all = await getAllDeliveries();
  const lowerName = String(itemName || '').toLowerCase().trim();
  return all.filter(function(d) {
    if (warehouseId && d.warehouse_id !== warehouseId) return false;
    return d.items.some(function(it) {
      return String(it.name || '').toLowerCase().trim() === lowerName;
    });
  }).map(function(d) {
    return Object.assign({}, d, {
      items: d.items.filter(function(it) {
        return String(it.name || '').toLowerCase().trim() === lowerName;
      })
    });
  });
}

// Save a delivery (insert or update) with all its items.
// Items list replaces the existing items for this delivery.
async function saveDelivery(data) {
  const id = data.id || 'del_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4);

  // Look up supplier/warehouse/account names (so the delivery has them frozen
  // in case the referenced record is later deactivated)
  let supplierName = data.supplier_name || '';
  if (data.supplier_id && !supplierName) {
    const sup = await dbSelect('suppliers', { id: data.supplier_id });
    if (sup.length > 0) supplierName = sup[0].name;
  }
  let warehouseName = data.warehouse_name || '';
  if (data.warehouse_id && !warehouseName) {
    const wh = await dbSelect('warehouses', { id: data.warehouse_id });
    if (wh.length > 0) warehouseName = wh[0].name;
  }
  let accountName = data.account_name || '';
  if (data.account_id && !accountName) {
    const acc = await dbSelect('accounts', { id: data.account_id });
    if (acc.length > 0) accountName = acc[0].name;
  }

  // Calculate total from items
  const items = Array.isArray(data.items) ? data.items : [];
  const total = items.reduce(function(s, it) {
    return s + (Number(it.total_price) || (Number(it.quantity) * Number(it.unit_price)) || 0);
  }, 0);

  // Determine if this is a new delivery (need to assign a number)
  const existing = await dbSelect('deliveries', { id: id });
  let number = data.number;
  if (!number && existing.length === 0) {
    number = await getNextDeliveryNumber();
  } else if (!number && existing.length > 0) {
    number = existing[0].number;
  }

  // Determine paid status
  const paidAmount = Number(data.paid_amount) || 0;
  let isPaid, status;
  if (paidAmount >= total) {
    isPaid = true; status = 'received';
  } else if (paidAmount > 0) {
    isPaid = false; status = 'partial';
  } else {
    isPaid = false; status = 'unpaid';
  }

  const record = {
    number: number,
    delivery_date: data.delivery_date || new Date().toISOString(),
    supplier_id: data.supplier_id || '',
    supplier_name: supplierName,
    warehouse_id: data.warehouse_id || '',
    warehouse_name: warehouseName,
    account_id: data.account_id || '',
    account_name: accountName,
    is_paid: isPaid,
    paid_amount: paidAmount,
    total_amount: total,
    status: status,
    comment: data.comment || ''
  };

  if (existing.length > 0) {
    await dbUpdate('deliveries', id, record);
  } else {
    record.id = id;
    record.created_at = new Date().toISOString();
    await dbInsert('deliveries', record);
  }

  // Replace items: delete all existing items for this delivery, then insert the new ones
  const existingItems = await dbSelect('delivery_items', { delivery_id: id });
  for (const it of existingItems) {
    try { await dbDelete('delivery_items', it.id); } catch (e) {
      console.warn('Failed to delete delivery item', it.id, e.message);
    }
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.name && !it.menu_item_id) continue;
    const itemName = it.name || '';
    // If no name but menu_item_id is set, look up the menu item name
    let finalName = itemName;
    if (!finalName && it.menu_item_id) {
      const menuItems = await dbSelect('menu', { id: it.menu_item_id });
      if (menuItems.length > 0) finalName = menuItems[0].name;
    }
    const qty = Number(it.quantity) || 0;
    const unitPrice = Number(it.unit_price) || 0;
    const markup = Math.round(Number(it.markup) || 0);
    const totalPrice = Number(it.total_price) || (qty * unitPrice);
    const itemId = 'dit_' + Date.now().toString(36) + '_' + i + '_' + Math.random().toString(36).substr(2, 4);
    await dbInsert('delivery_items', {
      id: itemId,
      delivery_id: id,
      menu_item_id: it.menu_item_id || '',
      name: finalName,
      pack: it.pack || '',
      quantity: qty,
      unit: it.unit || 'шт',
      unit_price: unitPrice,
      markup: markup,
      total_price: totalPrice,
      sort: i,
      created_at: new Date().toISOString()
    });
  }

  // Optionally apply items to stock (if data.apply_to_stock is true)
  if (data.apply_to_stock === true) {
    for (const it of items) {
      if (!it.menu_item_id) continue;
      const qty = Number(it.quantity) || 0;
      if (qty <= 0) continue;
      try {
        await dbIncrementStock(it.menu_item_id, qty);
      } catch (e) {
        console.warn('Failed to apply stock for', it.menu_item_id, e.message);
      }
    }
  }

  // ===== Auto-deduct from cash_register if account is the cash register =====
  // If the delivery's account_id matches the account flagged is_cash_register=true,
  // AND there's a paid_amount > 0, then deduct paid_amount from the cash_register
  // setting and record a shift_transaction for the active waiter's open shift.
  let cashRegisterDeducted = false;
  let recordedShiftTxId = null;
  if (paidAmount > 0 && data.account_id) {
    try {
      const accs = await dbSelect('accounts', { id: data.account_id });
      const acc = accs.length > 0 ? accs[0] : null;
      if (acc && acc.is_cash_register === true) {
        // Find the most-recently-opened shift to attribute the transaction to
        let openShift = null;
        try {
          const { data: openShifts } = await _sb.from('shifts')
            .select('*')
            .eq('status', 'open')
            .order('opened_at', { ascending: false })
            .limit(1);
          if (openShifts && openShifts.length > 0) openShift = openShifts[0];
        } catch (e) { console.warn('Failed to find open shift for delivery tx', e.message); }

        // Compute the ACTUAL current cash (not the stale cash_register setting):
        //   opening_cash + cash_sales_during_shift - existing_shift_transactions
        // This prevents double-deduction when called from waiterTransaction
        // (which already computed the same value and validated against it).
        let currentCash;
        if (openShift) {
          const openingCash = Number(openShift.opening_cash) || 0;
          let cashSales = 0;
          try {
            const { data: shiftOrders } = await _sb
              .from('orders')
              .select('total,payment_method')
              .eq('waiter_id', openShift.waiter_id)
              .eq('status', 'completed')
              .gte('completed_at', openShift.opened_at);
            (shiftOrders || []).forEach(function(o) {
              if (o.payment_method === 'cash') cashSales += Number(o.total) || 0;
            });
          } catch (e) { console.warn('Failed to fetch shift orders', e.message); }
          let existingTxTotal = 0;
          try {
            const { data: existingTxs } = await _sb.from('shift_transactions')
              .select('amount')
              .eq('shift_id', openShift.id);
            (existingTxs || []).forEach(function(t) { existingTxTotal += Number(t.amount) || 0; });
          } catch (e) { console.warn('Failed to fetch existing txs', e.message); }
          currentCash = openingCash + cashSales - existingTxTotal;
        } else {
          // No open shift — use the cash_register setting as-is
          currentCash = Number(await getSetting('cash_register')) || 0;
        }

        if (paidAmount > currentCash) {
          throw new Error('Недостаточно денег в кассе для оплаты поставки. Текущий остаток: ' + currentCash + ', сумма поставки: ' + paidAmount);
        }
        const newCash = currentCash - paidAmount;
        await saveSettingsToDB({ cash_register: String(newCash) });
        cashRegisterDeducted = true;

        // Record a shift_transaction for the open shift
        if (openShift) {
          try {
            const txId = 'stx_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4);
            await dbInsert('shift_transactions', {
              id: txId,
              shift_id: openShift.id,
              waiter_id: openShift.waiter_id,
              waiter_name: openShift.waiter_name,
              type: 'supply_payment',
              amount: paidAmount,
              delivery_id: id,
              supplier_name: supplierName,
              account_id: data.account_id,
              comment: 'Поставка №' + (number || '') + (supplierName ? ' — ' + supplierName : '')
            });
            recordedShiftTxId = txId;
          } catch (txErr) {
            console.warn('Failed to record shift_transaction for delivery', txErr.message);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to deduct cash_register for delivery', e.message);
      // Re-throw if it's a "not enough cash" error so the user sees it
      if (e.message && e.message.indexOf('Недостаточно денег') !== -1) throw e;
    }
  }

  return { id: id, number: number, total: total, cash_register_deducted: cashRegisterDeducted, shift_tx_id: recordedShiftTxId };
}

// Delete a delivery and all its items
async function deleteDelivery(deliveryId) {
  const items = await dbSelect('delivery_items', { delivery_id: deliveryId });
  for (const it of items) {
    try { await dbDelete('delivery_items', it.id); } catch (e) {}
  }
  return await dbDelete('deliveries', deliveryId);
}

/* ---------- Writeoffs (списание товаров со склада) ---------- */
// A writeoff is like an internal sale: items are removed from a warehouse and
// the total amount (with markup) is credited to the warehouse's linked account.
// For cash-register accounts, this adds to cash_register + records a shift_transaction.

// Get the next writeoff number
async function getNextWriteoffNumber() {
  const cur = await getSetting('writeoff_number_seq');
  let n = parseInt(cur, 10);
  if (isNaN(n)) n = 1;
  await saveSettingsToDB({ writeoff_number_seq: String(n + 1) });
  return n;
}

// Get all writeoffs with their items
async function getAllWriteoffs() {
  const writeoffs = await dbSelect('writeoffs');
  const items = await dbSelect('writeoff_items');
  const itemsByWriteoff = {};
  items.forEach(function(it) {
    if (!itemsByWriteoff[it.writeoff_id]) itemsByWriteoff[it.writeoff_id] = [];
    itemsByWriteoff[it.writeoff_id].push({
      id: it.id,
      menu_item_id: it.menu_item_id || '',
      name: it.name,
      pack: it.pack || '',
      quantity: Number(it.quantity) || 0,
      unit: it.unit || 'шт',
      unit_price: Number(it.unit_price) || 0,
      markup: Number(it.markup) || 0,
      total_price: Number(it.total_price) || 0,
      sort: Number(it.sort) || 0
    });
  });
  const result = writeoffs.map(function(w) {
    return Object.assign({}, w, {
      items: (itemsByWriteoff[w.id] || []).sort(function(a, b) { return a.sort - b.sort; })
    });
  });
  result.sort(function(a, b) {
    return new Date(b.writeoff_date || 0) - new Date(a.writeoff_date || 0);
  });
  return result;
}

// Get a single writeoff with items
async function getWriteoff(writeoffId) {
  const writeoffs = await dbSelect('writeoffs', { id: writeoffId });
  if (writeoffs.length === 0) throw new Error('Списание не найдено');
  const writeoff = writeoffs[0];
  const items = await dbSelect('writeoff_items', { writeoff_id: writeoffId });
  items.sort(function(a, b) { return (Number(a.sort) || 0) - (Number(b.sort) || 0); });
  writeoff.items = items;
  return writeoff;
}

// Save a writeoff: create header + items, credit the account, record shift_transaction
async function saveWriteoff(data) {
  const id = data.id || 'wof_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4);

  // Look up warehouse + account names
  let warehouseName = data.warehouse_name || '';
  let warehouseId = data.warehouse_id || '';
  if (warehouseId && !warehouseName) {
    const whs = await dbSelect('warehouses', { id: warehouseId });
    if (whs.length > 0) warehouseName = whs[0].name;
  }
  let accountName = data.account_name || '';
  let accountId = data.account_id || '';
  // If no account specified, try to find it from the warehouse
  if (!accountId && warehouseId) {
    const whs = await dbSelect('warehouses', { id: warehouseId });
    if (whs.length > 0 && whs[0].account_id) {
      accountId = whs[0].account_id;
    }
  }
  if (accountId && !accountName) {
    const accs = await dbSelect('accounts', { id: accountId });
    if (accs.length > 0) accountName = accs[0].name;
  }

  // Calculate total from items
  const items = Array.isArray(data.items) ? data.items : [];
  const total = items.reduce(function(s, it) {
    return s + (Number(it.total_price) || 0);
  }, 0);

  // Determine if this is a new writeoff
  const existing = await dbSelect('writeoffs', { id: id });
  let number = data.number;
  if (!number && existing.length === 0) {
    number = await getNextWriteoffNumber();
  } else if (!number && existing.length > 0) {
    number = existing[0].number;
  }

  const now = new Date().toISOString();
  const record = {
    number: number,
    writeoff_date: data.writeoff_date || now,
    warehouse_id: warehouseId,
    warehouse_name: warehouseName,
    account_id: accountId,
    account_name: accountName,
    total_amount: total,
    comment: data.comment || ''
  };

  if (existing.length > 0) {
    await dbUpdate('writeoffs', id, record);
    // Delete old items
    const oldItems = await dbSelect('writeoff_items', { writeoff_id: id });
    for (const oi of oldItems) {
      try { await dbDelete('writeoff_items', oi.id); } catch (e) {}
    }
  } else {
    record.id = id;
    record.created_at = now;
    await dbInsert('writeoffs', record);
  }

  // Insert items
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.name && !it.menu_item_id) continue;
    const itemId = 'woi_' + Date.now().toString(36) + '_' + i + '_' + Math.random().toString(36).substr(2, 4);
    await dbInsert('writeoff_items', {
      id: itemId,
      writeoff_id: id,
      menu_item_id: it.menu_item_id || '',
      name: it.name || '',
      pack: it.pack || '',
      quantity: Number(it.quantity) || 0,
      unit: it.unit || 'шт',
      unit_price: Number(it.unit_price) || 0,
      markup: Math.round(Number(it.markup) || 0),
      total_price: Number(it.total_price) || 0,
      sort: i,
      created_at: now
    });
  }

  // ===== Credit the linked account =====
  // If the account is the cash register, add total to cash_register + record shift_transaction.
  // For non-cash accounts, the balance is computed dynamically (initial + writeoffs - deliveries).
  let cashRegisterCredited = false;
  let recordedShiftTxId = null;
  if (total > 0 && accountId) {
    try {
      const accs = await dbSelect('accounts', { id: accountId });
      const acc = accs.length > 0 ? accs[0] : null;
      if (acc && acc.is_cash_register === true) {
        // Find the most-recently-opened shift
        let openShift = null;
        try {
          const { data: openShifts } = await _sb.from('shifts')
            .select('*')
            .eq('status', 'open')
            .order('opened_at', { ascending: false })
            .limit(1);
          if (openShifts && openShifts.length > 0) openShift = openShifts[0];
        } catch (e) { console.warn('Failed to find open shift for writeoff tx', e.message); }

        // Compute live cash
        let currentCash;
        if (openShift) {
          const openingCash = Number(openShift.opening_cash) || 0;
          let cashSales = 0;
          try {
            const { data: shiftOrders } = await _sb
              .from('orders')
              .select('total,payment_method')
              .eq('waiter_id', openShift.waiter_id)
              .eq('status', 'completed')
              .gte('completed_at', openShift.opened_at);
            (shiftOrders || []).forEach(function(o) {
              if (o.payment_method === 'cash') cashSales += Number(o.total) || 0;
            });
          } catch (e) { console.warn('Failed to fetch shift orders', e.message); }
          let existingTxTotal = 0;
          try {
            const { data: existingTxs } = await _sb.from('shift_transactions')
              .select('amount,type')
              .eq('shift_id', openShift.id);
            (existingTxs || []).forEach(function(t) {
              const amt = Number(t.amount) || 0;
              // Deductions subtract, writeoffs (credits) add
              if (t.type === 'incassation' || t.type === 'supply_payment') existingTxTotal += amt;
              else if (t.type === 'writeoff') existingTxTotal -= amt;
            });
          } catch (e) { console.warn('Failed to fetch existing txs', e.message); }
          currentCash = openingCash + cashSales - existingTxTotal;
        } else {
          currentCash = Number(await getSetting('cash_register')) || 0;
        }

        const newCash = currentCash + total;
        await saveSettingsToDB({ cash_register: String(newCash) });
        cashRegisterCredited = true;

        // Record a shift_transaction (type='writeoff', amount is positive = credit)
        if (openShift) {
          try {
            const txId = 'stx_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4);
            await dbInsert('shift_transactions', {
              id: txId,
              shift_id: openShift.id,
              waiter_id: openShift.waiter_id,
              waiter_name: openShift.waiter_name,
              type: 'writeoff',
              amount: total,
              delivery_id: '',
              supplier_name: '',
              account_id: accountId,
              comment: 'Списание №' + (number || '') + (warehouseName ? ' — ' + warehouseName : '')
            });
            recordedShiftTxId = txId;
          } catch (txErr) {
            console.warn('Failed to record shift_transaction for writeoff', txErr.message);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to credit account for writeoff', e.message);
    }
  }

  return { id: id, number: number, total: total, cash_register_credited: cashRegisterCredited, shift_tx_id: recordedShiftTxId };
}

// Delete a writeoff and all its items
async function deleteWriteoff(writeoffId) {
  const items = await dbSelect('writeoff_items', { writeoff_id: writeoffId });
  for (const it of items) {
    try { await dbDelete('writeoff_items', it.id); } catch (e) {}
  }
  return await dbDelete('writeoffs', writeoffId);
}

/* ---------- Menu modifications ---------- */
// Syncs the modifications list for a menu item:
//  - inserts/updates the ones passed in
//  - deletes the ones NOT in the list (i.e. removed in the UI)
async function saveMenuModifications(menuId, modifications) {
  if (!_sb) throw new Error('Supabase not initialized');
  // Get current modifications for this menu item
  const existing = await dbSelect('menu_modifications', { menu_id: menuId });
  const existingIds = existing.map(function(m) { return m.id; });
  const passedIds = modifications.map(function(m) { return m.id; }).filter(Boolean);

  // Delete modifications that are no longer in the list
  const toDelete = existingIds.filter(function(id) { return passedIds.indexOf(id) === -1; });
  for (const id of toDelete) {
    try { await dbDelete('menu_modifications', id); } catch (e) {
      console.warn('Failed to delete modification', id, e.message);
    }
  }

  // Insert / update each passed modification
  for (let i = 0; i < modifications.length; i++) {
    const m = modifications[i];
    const mId = m.id || 'mod_' + Date.now().toString(36) + '_' + i + '_' + Math.random().toString(36).substr(2, 4);
    const record = {
      menu_id: menuId,
      name: (m.name || '').trim(),
      name_translation: m.name_translation || '',
      price: Number(m.price) || 0,
      cost: Number(m.cost) || 0,
      markup: Number(m.markup) || 0,
      sort: i,
      is_active: m.is_active !== false
    };
    if (!record.name) continue; // skip empty
    if (existingIds.indexOf(mId) >= 0) {
      try {
        await dbUpdate('menu_modifications', mId, record);
      } catch (e) {
        // If update failed because row doesn't actually exist (stale id), insert instead
        if (e.message && e.message.indexOf('no rows matched') >= 0) {
          record.id = mId;
          await dbInsert('menu_modifications', record);
        } else {
          throw e;
        }
      }
    } else {
      record.id = mId;
      await dbInsert('menu_modifications', record);
    }
  }
  return { ok: true, count: modifications.length };
}

/* ---------- Stock ---------- */
async function deductStock(items) {
  const stockTracking = String(await getSetting('stock_tracking')) === 'true';
  if (!stockTracking) return;

  for (const it of items) {
    if (!it.menu_item_id) continue;
    const qty = parseInt(it.quantity, 10) || 1;
    // Use negative delta via the atomic helper so it benefits from the same RPC path
    try {
      await dbIncrementStock(it.menu_item_id, -qty);
    } catch (err) {
      console.warn('deductStock failed for', it.menu_item_id, ':', err.message);
    }
  }
}

async function replenishStock(menuItemId, quantity) {
  const qty = parseInt(quantity, 10);
  if (!qty || qty <= 0) throw new Error('Quantity must be a positive integer');
  const result = await dbIncrementStock(menuItemId, qty);
  console.log('replenishStock: itemId=', menuItemId, 'qty=', qty, 'newStock=', result.stock);
  return result;
}

async function getStockReport(warehouseId) {
  // Use cached settings from APP_DATA if available (avoids 2 extra DB queries)
  let stockTracking, threshold;
  if (typeof APP_DATA !== 'undefined' && APP_DATA && APP_DATA.settings) {
    stockTracking = String(APP_DATA.settings.stock_tracking) === 'true';
    threshold = Number(APP_DATA.settings.stock_threshold) || 5;
  } else {
    stockTracking = String(await getSetting('stock_tracking')) === 'true';
    threshold = Number(await getSetting('stock_threshold')) || 5;
  }

  // Load ALL data in parallel — writeoffs/writeoff_items have .catch() fallback
  const [allMenu, categories, allItemsResult, allDeliveries, allDeliveryItems, allWriteoffs, allWriteoffItems] = await Promise.all([
    dbSelect('menu'),
    dbSelect('categories'),
    _sb.from('order_items').select('menu_item_id, quantity, order_id, created_at'),
    dbSelect('deliveries'),
    dbSelect('delivery_items'),
    dbSelect('writeoffs').catch(function(e) { console.warn('writeoffs load failed in getStockReport:', e.message); return []; }),
    dbSelect('writeoff_items').catch(function(e) { console.warn('writeoff_items load failed in getStockReport:', e.message); return []; })
  ]);
  const allItems = allItemsResult.data || [];

  // Only show items that have a price > 0 — items with price 0/null are
  // likely category headers (e.g. "вареники", "вторые блюда") that shouldn't
  // appear in the stock table.
  const menu = allMenu.filter(function(m) {
    return (m.is_active === true || m.is_active === 'true') &&
           Number(m.price) > 0;
  });

  const catById = {};
  categories.forEach(function(c) { catById[c.id] = c; });

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const consumption = {};
  allItems.forEach(function(it) {
    const mid = it.menu_item_id;
    if (!mid) return;
    const created = new Date(it.created_at);
    const qty = Number(it.quantity) || 1;
    if (!consumption[mid]) consumption[mid] = { day: 0, week: 0, month: 0, total: 0 };
    consumption[mid].total += qty;
    if (created >= dayAgo) consumption[mid].day += qty;
    if (created >= weekAgo) consumption[mid].week += qty;
    if (created >= monthAgo) consumption[mid].month += qty;
  });

  // ===== Per-warehouse filtering =====
  // If warehouseId is provided, only consider deliveries that went to that warehouse.
  // The "stock" shown will be the sum of quantities received at that warehouse.
  let filteredDeliveryIds = null;
  if (warehouseId) {
    filteredDeliveryIds = new Set(
      allDeliveries.filter(function(d) { return d.warehouse_id === warehouseId; })
        .map(function(d) { return d.id; })
    );
  }
  // deliveryStats: per menu_item_id → { count, total, qty }
  const deliveryStats = {};
  // whStock: per menu_item_id → total quantity received at the selected warehouse
  const whStock = {};
  // deliveryOnlyItems: items that appear in deliveries.
  // When a specific warehouse is selected, ALL delivery items are aggregated by NAME
  // (ignoring menu_item_id) — this ensures items on non-menu warehouses (e.g. supplies)
  // are never mixed with the restaurant menu, even if their names happen to match.
  // When NO warehouse filter (all warehouses), only items WITHOUT menu_item_id go here.
  const deliveryOnlyItems = {};
  allDeliveryItems.forEach(function(dit) {
    // Skip this item if it doesn't belong to a delivery at the selected warehouse
    if (filteredDeliveryIds && !filteredDeliveryIds.has(dit.delivery_id)) return;
    const mid = dit.menu_item_id;
    const itemName = String(dit.name || '').trim();
    // When warehouse filter is active, aggregate EVERYTHING by name (ignore menu_item_id)
    // so items on this warehouse are independent from the restaurant menu.
    if (warehouseId) {
      if (!itemName) return;
      const key = itemName.toLowerCase();
      if (!deliveryOnlyItems[key]) {
        deliveryOnlyItems[key] = {
          name: itemName,
          qty: 0,
          total: 0,
          count: 0,
          pack: String(dit.pack || ''),
          unit_price: Number(dit.unit_price) || 0,
          markup: Number(dit.markup) || 0
        };
      }
      deliveryOnlyItems[key].qty += Number(dit.quantity) || 0;
      deliveryOnlyItems[key].total += Number(dit.total_price) || 0;
      deliveryOnlyItems[key].count += 1;
      if (Number(dit.markup) > 0) deliveryOnlyItems[key].markup = Number(dit.markup);
    } else {
      // No warehouse filter — use the original logic:
      // items with menu_item_id go to deliveryStats, others go to deliveryOnlyItems
      if (mid) {
        if (!deliveryStats[mid]) deliveryStats[mid] = { count: 0, total: 0, qty: 0 };
        deliveryStats[mid].count += 1;
        deliveryStats[mid].total += Number(dit.total_price) || 0;
        deliveryStats[mid].qty += Number(dit.quantity) || 0;
        whStock[mid] = (whStock[mid] || 0) + (Number(dit.quantity) || 0);
      } else if (itemName) {
        const key = itemName.toLowerCase();
        if (!deliveryOnlyItems[key]) {
          deliveryOnlyItems[key] = {
            name: itemName,
            qty: 0,
            total: 0,
            count: 0,
            pack: String(dit.pack || ''),
            unit_price: Number(dit.unit_price) || 0,
            markup: Number(dit.markup) || 0
          };
        }
        deliveryOnlyItems[key].qty += Number(dit.quantity) || 0;
        deliveryOnlyItems[key].total += Number(dit.total_price) || 0;
        deliveryOnlyItems[key].count += 1;
        if (Number(dit.markup) > 0) deliveryOnlyItems[key].markup = Number(dit.markup);
      }
    }
  });

  // ===== Subtract writeoffs from stock =====
  // Writeoffs remove items from the warehouse. We need to:
  // 1. Find writeoffs for the selected warehouse (or all warehouses if no filter)
  // 2. For each writeoff item, subtract its quantity from the corresponding item
  let filteredWriteoffIds = null;
  if (warehouseId) {
    filteredWriteoffIds = new Set(
      allWriteoffs.filter(function(w) { return w.warehouse_id === warehouseId; })
        .map(function(w) { return w.id; })
    );
  }
  // writeoffByName: per item name (lowercase) → total quantity written off
  const writeoffByName = {};
  // writeoffByMenuId: per menu_item_id → total quantity written off
  const writeoffByMenuId = {};
  allWriteoffItems.forEach(function(wit) {
    // Skip if warehouse filter is active and this writeoff doesn't belong to the selected warehouse
    if (filteredWriteoffIds && !filteredWriteoffIds.has(wit.writeoff_id)) return;
    const qty = Number(wit.quantity) || 0;
    if (qty <= 0) return;
    const itemName = String(wit.name || '').trim().toLowerCase();
    const mid = wit.menu_item_id;
    if (itemName) writeoffByName[itemName] = (writeoffByName[itemName] || 0) + qty;
    if (mid) writeoffByMenuId[mid] = (writeoffByMenuId[mid] || 0) + qty;
  });
  // Subtract writeoffs from deliveryOnlyItems (by name)
  Object.keys(writeoffByName).forEach(function(name) {
    if (deliveryOnlyItems[name]) {
      deliveryOnlyItems[name].qty -= writeoffByName[name];
      if (deliveryOnlyItems[name].qty < 0) deliveryOnlyItems[name].qty = 0;
    }
  });
  // Subtract writeoffs from whStock (by menu_item_id) — for the "all warehouses" view
  Object.keys(writeoffByMenuId).forEach(function(mid) {
    if (whStock[mid]) {
      whStock[mid] -= writeoffByMenuId[mid];
      if (whStock[mid] < 0) whStock[mid] = 0;
    }
  });

  // Build the items array.
  // - When NO warehouse filter: show all menu items with their global stock (as before)
  // - When warehouse filter IS active: show ONLY items that have deliveries to this
  //   warehouse — both menu items (with menu_item_id) and custom-named items (without).
  //   Items with zero stock at this warehouse are NOT shown (user said "только из этого склада").
  const menuItems = menu.map(function(m) {
    // If warehouse filter is active, use warehouse-specific stock; else global menu.stock
    const stock = warehouseId ? (whStock[m.id] || 0) : (Number(m.stock) || 0);
    const cons = consumption[m.id] || { day: 0, week: 0, month: 0, total: 0 };
    const cost = Number(m.cost) || 0;
    // Look up the category name (use parent → child format if it's a subcategory)
    let categoryName = '';
    if (m.category_id && catById[m.category_id]) {
      const cat = catById[m.category_id];
      if (cat.parent_id && catById[cat.parent_id]) {
        categoryName = catById[cat.parent_id].name + ' → ' + cat.name;
      } else {
        categoryName = cat.name;
      }
    }
    const dStats = deliveryStats[m.id] || { count: 0, total: 0, qty: 0 };
    const itemMarkup = Number(m.markup) || 0;
    // Сумма = остаток × себестоимость × (1 + наценка/100)
    const unitPriceWithMarkup = cost * (1 + itemMarkup / 100);
    return {
      id: m.id,
      name: m.name,
      category_id: m.category_id || '',
      category_name: categoryName,
      sort: Number(m.sort) || 0,
      stock: stock,
      cost: cost,
      markup: itemMarkup,
      stock_value: stock * unitPriceWithMarkup, // остаток × цена с наценкой
      consumed_day: cons.day,
      consumed_week: cons.week,
      consumed_month: cons.month,
      consumed_total: cons.total,
      deliveries_count: dStats.count,
      deliveries_total: dStats.total,
      low_stock: stockTracking && stock <= threshold,
      is_menu_item: true
    };
  });

  // When warehouse filter is active, DON'T show menu items at all —
  // all items on this warehouse are shown as delivery-only items (aggregated by name).
  // This ensures items on non-menu warehouses are never mixed with the restaurant menu.
  const filteredMenuItems = warehouseId
    ? []
    : menuItems;

  // When warehouse filter is active, ALL items are delivery-only (aggregated by name).
  // When no filter, deliveryOnlyArray is empty (deliveryOnlyItems only has items without menu_item_id).
  // Items with stock=0 (after writeoff deductions) are excluded — user said:
  // "если списали полностью товар и его количество стало 0, то показывать его в остатках не нужно"
  const deliveryOnlyArray = warehouseId ? Object.keys(deliveryOnlyItems)
    .filter(function(key) { return deliveryOnlyItems[key].qty > 0; })
    .map(function(key) {
    const d = deliveryOnlyItems[key];
    const dMarkup = d.markup || 0;
    const dUnitPriceWithMarkup = d.unit_price * (1 + dMarkup / 100);
    return {
      id: 'custom_' + key, // synthetic id for sorting/display
      name: d.name,
      category_id: '',
      category_name: 'Поставка (не в меню)',
      sort: 9999, // sort after menu items
      stock: d.qty,
      cost: d.unit_price,
      markup: dMarkup,
      stock_value: d.qty * dUnitPriceWithMarkup, // остаток × цена с наценкой
      consumed_day: 0,
      consumed_week: 0,
      consumed_month: 0,
      consumed_total: 0,
      deliveries_count: d.count,
      deliveries_total: d.total,
      low_stock: false,
      is_menu_item: false,
      pack: d.pack
    };
  }) : [];

  const items = filteredMenuItems.concat(deliveryOnlyArray);
  // Also filter out menu items with stock=0 when warehouse filter is active
  // (they shouldn't show if all their stock was written off)
  const finalItems = warehouseId
    ? items.filter(function(it) { return Number(it.stock) > 0; })
    : items;
  // Sort by sort field, then by name — keeps the order stable across reloads
  finalItems.sort(function(a, b) {
    const sa = Number(a.sort) || 0;
    const sb = Number(b.sort) || 0;
    if (sa !== sb) return sa - sb;
    return String(a.name).localeCompare(String(b.name), 'ru');
  });

  return { stock_tracking: stockTracking, threshold: threshold, items: finalItems, warehouse_id: warehouseId || '' };
}

/* ---------- Auth (login) ---------- */
async function loginWithPassword(userId, password) {
  const users = await dbSelect('users', { id: userId });
  if (users.length === 0) throw new Error('Пользователь не найден');
  const user = users[0];

  const pinValue = String(user.pin || '');
  if (pinValue.length === 0) throw new Error('Пароль не установлен. Задайте пароль в админке.');

  // For waiters/cooks: enforce numeric password
  if (user.role !== 'admin') {
    if (!/^\d+$/.test(password)) throw new Error('Пароль должен состоять только из цифр');
  }

  // Compare: if pin is 64 hex chars → SHA-256 hash, otherwise plaintext
  const isHex64 = /^[a-f0-9]{64}$/.test(pinValue);
  let match = false;
  if (isHex64) {
    match = (hashPassword(user.id, password) === pinValue);
  } else {
    match = (String(password) === pinValue);
  }
  if (!match) throw new Error('Неверный пароль');

  // Update last_login timestamp (fire-and-forget, do not block login)
  try {
    await dbUpdate('users', userId, { last_login: new Date().toISOString() });
  } catch (e) { /* ignore — login should still succeed */ }

  return {
    token: 'session_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 12),
    user: { id: user.id, name: user.name, role: user.role, allowed_warehouses: user.allowed_warehouses || '' },
    expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
  };
}

function hashPassword(userId, password) {
  // Simple hash for compatibility — in Supabase we use plaintext or RLS
  // This is a fallback for hashed passwords migrated from Apps Script
  const raw = (userId || '') + ':' + (password || '');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
}

async function setPassword(userId, newPassword, plaintext) {
  const value = newPassword ? (plaintext ? newPassword : hashPassword(userId, newPassword)) : '';
  await dbUpdate('users', userId, { pin: value });
  return { ok: true };
}

/* ---------- Sound URLs ---------- */
const _soundCache = {};

async function loadSound(name) {
  if (_soundCache[name] !== undefined) return _soundCache[name];
  try {
    let soundUrl = null;
    if (APP_DATA && APP_DATA.settings) {
      soundUrl = APP_DATA.settings['sound_' + name] || null;
    }
    if (soundUrl) {
      const audio = new Audio(soundUrl);
      audio.preload = 'auto';
      _soundCache[name] = audio;
      return audio;
    }
  } catch (e) { console.warn('Failed to load sound', name, e); }
  _soundCache[name] = null;
  return null;
}

async function preloadSounds(names) {
  await Promise.all(names.map(function(n) { return loadSound(n); }));
}

function playCustomSound(name, fallback) {
  const audio = _soundCache[name];
  if (audio) {
    try {
      audio.currentTime = 0;
      const p = audio.play();
      if (p && p.catch) p.catch(function() { if (fallback) fallback(); });
    } catch (e) { if (fallback) fallback(); }
  } else if (fallback) { fallback(); }
}

function notifySound() {
  playCustomSound('waiter_ready', function() {
    beep(880, 150, 0.25);
    setTimeout(function() { beep(1100, 200, 0.25); }, 180);
  });
}

function cookNotifySound() {
  playCustomSound('cook_new_order', function() {
    beep(660, 200, 0.25);
    setTimeout(function() { beep(880, 250, 0.25); }, 220);
  });
}

let _audioCtx = null;
function beep(freq, duration, volume) {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq || 880;
    gain.gain.value = volume || 0.2;
    osc.connect(gain);
    gain.connect(_audioCtx.destination);
    osc.start();
    setTimeout(function() { osc.stop(); }, duration || 200);
  } catch (e) {}
}

/* ---------- Realtime subscriptions ---------- */
function subscribeToOrders(callback) {
  if (!_sb) return;
  const channel = _sb
    .channel('orders-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, function(payload) {
      console.log('Realtime: orders changed', payload);
      if (callback) callback(payload);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, function(payload) {
      console.log('Realtime: order_items changed', payload);
      if (callback) callback(payload);
    })
    .subscribe();
  _realtimeChannels.push(channel);
  return channel;
}

function subscribeToTable(tableName, callback) {
  if (!_sb) return;
  const channel = _sb
    .channel('table-' + tableName + '-' + Date.now())
    .on('postgres_changes', { event: '*', schema: 'public', table: tableName }, function(payload) {
      if (callback) callback(payload);
    })
    .subscribe();
  _realtimeChannels.push(channel);
  return channel;
}

function unsubscribeAll() {
  _realtimeChannels.forEach(function(ch) {
    try { _sb.removeChannel(ch); } catch (e) {}
  });
  _realtimeChannels = [];
}

/* ---------- Modal helpers ---------- */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

/* ---------- Custom confirm dialog ---------- */
// Replaces window.confirm() with a styled in-app modal.
// Usage:  const ok = await confirmDialog('Удалить?', 'Подтвердите удаление', 'Удалить', 'Отмена');
//         if (ok) { ... }
let _confirmDialogPromise = null;
function confirmDialog(message, title, okText, cancelText, okClass) {
  // If a confirm dialog is already open, reject the new one to avoid stacking
  if (_confirmDialogPromise) return _confirmDialogPromise;

  return new Promise(function(resolve) {
    // Remove any existing dialog
    const existing = document.getElementById('confirm-dialog-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'confirm-dialog-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';

    const modal = document.createElement('div');
    modal.style.cssText =
      'background:#fff;border-radius:12px;padding:24px;max-width:420px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.25);';
    let html = '';
    if (title) {
      html += '<h3 style="margin:0 0 8px;font-size:1.1rem;font-weight:700;color:var(--text);">' + escapeHtml(title) + '</h3>';
    }
    html += '<p style="margin:0 0 20px;font-size:1rem;color:var(--text);line-height:1.5;">' + escapeHtml(message) + '</p>';
    html += '<div style="display:flex;gap:8px;justify-content:flex-end;">';
    html += '<button type="button" class="btn btn-outline" id="confirm-dialog-cancel" style="min-width:96px;padding:10px 16px;">' + escapeHtml(cancelText || 'Отмена') + '</button>';
    html += '<button type="button" class="btn ' + (okClass || 'btn-danger') + '" id="confirm-dialog-ok" style="min-width:96px;padding:10px 16px;">' + escapeHtml(okText || 'OK') + '</button>';
    html += '</div>';
    modal.innerHTML = html;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Animate in
    modal.style.transform = 'scale(0.95)';
    modal.style.opacity = '0';
    modal.style.transition = 'transform 0.15s, opacity 0.15s';
    requestAnimationFrame(function() {
      modal.style.transform = 'scale(1)';
      modal.style.opacity = '1';
    });

    function closeDialog(result) {
      modal.style.transform = 'scale(0.95)';
      modal.style.opacity = '0';
      setTimeout(function() {
        overlay.remove();
        _confirmDialogPromise = null;
        resolve(result);
      }, 150);
    }

    document.getElementById('confirm-dialog-ok').onclick = function() { closeDialog(true); };
    document.getElementById('confirm-dialog-cancel').onclick = function() { closeDialog(false); };
    // Close on backdrop click
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeDialog(false);
    });
    // Close on Escape
    const escHandler = function(e) {
      if (e.key === 'Escape') {
        closeDialog(false);
        document.removeEventListener('keydown', escHandler);
      } else if (e.key === 'Enter') {
        closeDialog(true);
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
    // Focus the OK button after a tiny delay
    setTimeout(function() { document.getElementById('confirm-dialog-ok').focus(); }, 100);
  });
}

/* ---------- Format ---------- */
function formatTableLabel(order) {
  if (!order) return '';
  const type = order.table_type || 'numbered';
  const num = order.table_number;
  if (type === 'tab') return String(num || '');
  if (type === 'virtual') return String(num || '');
  return 'Столик №' + num;
}

function formatMoney(amount, currency) {
  const n = Number(amount) || 0;
  let cur = currency;
  if (!cur && typeof APP_DATA !== 'undefined' && APP_DATA && APP_DATA.settings) {
    cur = APP_DATA.settings.currency;
  }
  if (!cur) cur = CONFIG.DEFAULT_CURRENCY;
  // Округляем до целого: если сотые >= 0.5 — в большую, иначе в меньшую
  const rounded = Math.round(n);
  return rounded + ' ' + cur;
}

// Format a markup percentage: 50 -> "50%", 12.5 -> "12.5%"
function formatPercent(value) {
  const n = Number(value) || 0;
  const hasDec = (n % 1) !== 0;
  return (hasDec ? n.toFixed(1) : Math.round(n).toString()) + '%';
}

// Calculate effective markup percentage from cost and price.
// Returns 0 if cost == price (or cost == 0).
function calcMarkupPercent(cost, price) {
  cost = Number(cost) || 0;
  price = Number(price) || 0;
  if (cost === 0 || cost === price) return 0;
  return ((price - cost) / cost) * 100;
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return hh + ':' + mm;
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return dd + '.' + mo + ' ' + hh + ':' + mm;
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return diff + ' сек назад';
  if (diff < 3600) return Math.floor(diff / 60) + ' мин назад';
  if (diff < 86400) return Math.floor(diff / 3600) + ' ч назад';
  return formatDateTime(iso);
}

/* ---------- Toast ---------- */
function showToast(msg, type) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.className = 'toast toast-' + (type || 'info');
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(function() {
    t.classList.add('toast-hide');
    setTimeout(function() { t.remove(); }, 300);
  }, 3000);
}

/* ---------- Wake Lock ---------- */
let _wakeLockSentinel = null;

async function requestWakeLock() {
  try {
    if (!('wakeLock' in navigator)) return;
    if (document.visibilityState !== 'visible') return;
    if (_wakeLockSentinel !== null) return;
    _wakeLockSentinel = await navigator.wakeLock.request('screen');
    _wakeLockSentinel.addEventListener('release', function() { _wakeLockSentinel = null; });
    console.log('Wake Lock acquired');
  } catch (err) { console.warn('Wake Lock failed:', err.message); }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') requestWakeLock();
  });
}

/* ---------- Notifications ---------- */
let _swReady = false;

async function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return false;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return false;
  try {
    await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    _swReady = true;
    return true;
  } catch (err) { console.warn('SW failed:', err.message); return false; }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try { return (await Notification.requestPermission()) === 'granted'; }
  catch (e) { return false; }
}

function showSystemNotification(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    if (_swReady && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'NOTIFY', title: title, body: body, tag: tag || 'restaurant',
        requireInteraction: true, vibrate: true
      });
    } else {
      new Notification(title, { body: body, tag: tag || 'restaurant', requireInteraction: true });
    }
  } catch (e) {}
}

/* ---------- Session ---------- */
const USER_STORAGE_KEY = 'restaurant_session';

function getCurrentSession() {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session || !session.user || !session.token) {
      localStorage.removeItem(USER_STORAGE_KEY);
      return null;
    }
    return session;
  } catch (e) { return null; }
}

function getCurrentUser() {
  const s = getCurrentSession();
  return s ? s.user : null;
}

function setCurrentSession(session) {
  if (session) localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(USER_STORAGE_KEY);
}

async function logoutUser() {
  // If a confirmation function is defined (waiter page), ask before logging out.
  // This prevents accidental logouts from a stray tap on the user chip.
  if (typeof window.confirmLogout === 'function') {
    var ok = await window.confirmLogout();
    if (!ok) return;
  }
  unsubscribeAll();
  setCurrentSession(null);
  location.reload();
}

/* ---------- Button loading state ---------- */
const _loadingButtons = new WeakSet();

async function withLoading(btn, loadingText, action) {
  if (!btn) return action();
  if (btn.disabled) return;
  if (_loadingButtons.has(btn)) return;
  _loadingButtons.add(btn);
  const originalText = btn.innerHTML;
  const originalDisabled = btn.disabled;
  btn.disabled = true;
  btn.classList.add('btn-loading');
  btn.innerHTML = '<span class="btn-spinner"></span> ' + (loadingText || '...');
  const safety = setTimeout(function() {
    if (_loadingButtons.has(btn)) {
      _loadingButtons.delete(btn);
      btn.disabled = originalDisabled;
      btn.classList.remove('btn-loading');
      btn.innerHTML = originalText;
    }
  }, 30000);
  try { return await action(); }
  finally {
    clearTimeout(safety);
    _loadingButtons.delete(btn);
    btn.disabled = originalDisabled;
    btn.classList.remove('btn-loading');
    btn.innerHTML = originalText;
  }
}

/* ---------- Escape ---------- */
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/* ---------- Config check ---------- */
function checkConfig() {
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.indexOf('PASTE_YOUR') === 0) {
    document.body.innerHTML =
      '<div class="config-error"><h1>Не настроено подключение</h1>' +
      '<p>Откройте файл <code>config.js</code> и вставьте URL и anon key вашего Supabase проекта.</p></div>';
    return false;
  }
  return true;
}

/* ---------- Dynamic polling intervals ---------- */
function getPollInterval(settingKey, configKey) {
  let seconds = null;
  if (typeof APP_DATA !== 'undefined' && APP_DATA && APP_DATA.settings) {
    const v = APP_DATA.settings[settingKey];
    if (v) seconds = Number(v);
  }
  if (!seconds || isNaN(seconds) || seconds < 5) {
    seconds = (CONFIG[configKey] || 5000) / 1000;
  }
  if (seconds < 5) seconds = 5;
  return seconds * 1000;
}

/* ---------- Init Supabase on load ---------- */
// Initialize Supabase IMMEDIATELY (not on DOMContentLoaded) so that
// init() in HTML files can use it. The supabase.js library is loaded
// synchronously before common.js, so window.supabase is already available.
if (typeof window !== 'undefined') {
  initSupabase();
}

/* ---------- Compatibility wrappers ---------- */
// These translate old apiGet('action', params) / apiPost('action', body)
// calls from HTML files into the new Supabase direct functions.

async function apiGet(action, params) {
  params = params || {};
  switch (action) {
    case 'getOrders':
      return await getOrders(params.status, params.waiter_id);
    case 'getOrder':
      return await getOrder(params.id);
    case 'getActiveShift':
      return await getActiveShift(params.waiter_id);
    case 'getAllShifts':
      return await getAllShiftsWithTransactions();
    case 'getOrderLogs':
      return { logs: await getOrderLogs(params.order_id) };
    case 'getStockReport':
      return await getStockReport(params && params.warehouse_id);
    case 'getTablesConfig':
      return await getTablesConfig();
    case 'getAllDeliveries':
      return { deliveries: await getAllDeliveries() };
    case 'getDelivery':
      return await getDelivery(params.id);
    case 'getDeliveriesForMenuItem':
      return { deliveries: await getDeliveriesForMenuItem(params.menu_item_id) };
    case 'getDeliveriesForItemName':
      return { deliveries: await getDeliveriesForItemName(params.item_name, params.warehouse_id) };
    case 'getTabs': {
      let tabs = await dbSelect('tabs');
      if (params.status && params.status !== 'all') {
        tabs = tabs.filter(function(t) { return t.status === params.status; });
      }
      // Recalc totals from orders
      const orders = await dbSelect('orders');
      tabs.forEach(function(t) {
        const linked = orders.filter(function(o) {
          return o.tab_id === t.id && o.status === 'completed';
        });
        t.total = linked.reduce(function(s, o) { return s + (Number(o.total) || 0); }, 0);
        t.orders_count = linked.length;
      });
      tabs.sort(function(a, b) {
        if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
        return new Date(b.created_at) - new Date(a.created_at);
      });
      return { tabs: tabs };
    }
    case 'getWaiterDashboard': {
      const waiterId = params.waiter_id;
      // Run all 3 queries IN PARALLEL — saves ~3-4 seconds compared to sequential
      const [ordersData, tablesData, shiftData] = await Promise.all([
        getOrders('accepted', waiterId),
        getTables(waiterId),
        getActiveShift(waiterId)
      ]);
      return {
        orders: ordersData.orders,
        tables: tablesData.tables,
        shift: shiftData.shift,
        current_cash: shiftData.current_cash,
        cook_enabled: shiftData.cook_enabled,
        server_time: new Date().toISOString()
      };
    }
    case 'getAllWriteoffs':
      return { writeoffs: await getAllWriteoffs() };
    case 'getWriteoff':
      return await getWriteoff(params.id);
    default:
      throw new Error('Unknown apiGet action: ' + action);
  }
}

async function apiPost(action, body) {
  body = body || {};
  switch (action) {
    case 'createOrder':
      return await createOrder(body);
    case 'updateOrderStatus':
      return await updateOrderStatus(body.order_id, body.status, body.payment_method, body.cash_amount, body.card_amount);
    case 'updateOrderNote':
      return await dbUpdate('orders', body.order_id, { waiter_note: body.note || '' });
    case 'addItemToOrder':
      return await addItemToOrder(body);
    case 'updateItemQuantity':
      return await updateItemQuantity(body.item_id, body.quantity);
    case 'updateItemComment':
      return await updateItemComment(body.item_id, body.comment);
    case 'removeItemFromOrder':
      return await removeItemFromOrder(body.item_id);
    case 'toggleItemReady':
      return await toggleItemReady(body.item_id, body.is_ready);
    case 'toggleItemServed':
      return await toggleItemServedDB(body.item_id, body.is_served);
    case 'deleteOrder':
      return await deleteOrder(body.order_id);
    case 'cancelOrderWithReason':
      return await cancelOrderWithReasonDB(body.order_id, body.cancel_reason);
    case 'pauseOrder':
      return await pauseOrderDB(body.order_id);
    case 'resumeOrder':
      return await resumeOrderDB(body.order_id);
    case 'openShift':
      return await openShiftDB(body.waiter_id, body.waiter_name, body.opening_cash);
    case 'closeShift':
      return await closeShift(body.waiter_id, body.actual_cash);
    case 'createTab':
      return await dbInsert('tabs', {
        id: 'tab_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6),
        name: body.name || 'Без имени',
        phone: body.phone || '',
        notes: body.notes || '',
        total: 0,
        status: 'open',
        created_at: new Date().toISOString(),
        created_by_waiter_id: body.waiter_id || '',
        created_by_waiter_name: body.waiter_name || ''
      });
    case 'saveSettings':
      return await saveSettingsToDB(body.settings);
    case 'saveCategory': {
      const catId = body.id || 'cat_' + Date.now().toString(36);
      const existing = await dbSelect('categories', { id: catId });
      if (existing.length > 0) {
        return await dbUpdate('categories', catId, {
          parent_id: body.parent_id || '',
          name: body.name,
          name_translation: body.name_translation || '',
          sort: body.sort || 0,
          is_active: body.is_active !== false
        });
      } else {
        return await dbInsert('categories', {
          id: catId,
          parent_id: body.parent_id || '',
          name: body.name,
          name_translation: body.name_translation || '',
          sort: body.sort || 0,
          is_active: body.is_active !== false
        });
      }
    }
    case 'deleteCategory':
      return await dbDelete('categories', body.id);
    case 'saveMenuItem': {
      const mId = body.id || 'm_' + Date.now().toString(36);
      const existing = await dbSelect('menu', { id: mId });
      const hasMods = body.has_modifications === true;
      const record = {
        category_id: body.category_id || '',
        name: body.name,
        name_translation: body.name_translation || '',
        price: Number(body.price) || 0,
        cost: Number(body.cost) || 0,
        markup: Number(body.markup) || 0,
        needs_cooking: body.needs_cooking === true,
        sort: body.sort || 0,
        is_active: body.is_active !== false,
        stock: body.stock !== undefined ? Number(body.stock) : 0,
        has_modifications: hasMods,
        image_url: body.image_url || '',
        description: body.description || ''
      };
      let result;
      if (existing.length > 0) {
        result = await dbUpdate('menu', mId, record);
      } else {
        record.id = mId;
        result = await dbInsert('menu', record);
      }
      // Save modifications if provided (only when has_modifications=true,
      // but we still process the list either way to allow cleanup)
      if (Array.isArray(body.modifications)) {
        await saveMenuModifications(mId, body.modifications);
      }
      return result;
    }
    case 'deleteMenuItem': {
      // First delete all modifications of this menu item
      const mods = await dbSelect('menu_modifications', { menu_id: body.id });
      for (const m of mods) {
        try { await dbDelete('menu_modifications', m.id); } catch (e) {}
      }
      return await dbDelete('menu', body.id);
    }
    case 'saveUser': {
      const uId = body.id || 'u_' + Date.now().toString(36);
      const existing = await dbSelect('users', { id: uId });
      const record = {
        name: body.name,
        role: body.role || 'waiter',
        is_active: body.is_active !== false,
        sort: body.sort || 0,
        phone: body.phone || '',
        email: body.email || '',
        allowed_warehouses: body.allowed_warehouses || ''
      };
      if (existing.length > 0) {
        return await dbUpdate('users', uId, record);
      } else {
        record.id = uId;
        record.pin = '';
        record.created_at = new Date().toISOString();
        return await dbInsert('users', record);
      }
    }
    case 'deleteUser':
      return await dbDelete('users', body.id);
    case 'setPassword':
      return await setPassword(body.user_id, body.new_password, body.plaintext);
    case 'replenishStock':
      return await replenishStock(body.menu_item_id, body.quantity);
    case 'saveTablesConfig':
      return await saveTablesConfig(body);
    case 'saveSupplier':
      return await saveSupplier(body);
    case 'deleteSupplier':
      return await deleteSupplier(body.id);
    case 'saveWarehouse':
      return await saveWarehouse(body);
    case 'deleteWarehouse':
      return await deleteWarehouse(body.id);
    case 'saveAccount':
      return await saveAccount(body);
    case 'deleteAccount':
      return await deleteAccount(body.id);
    case 'waiterTransaction':
      return await waiterTransaction(body);
    case 'getShiftTransactions':
      return await getShiftTransactions(body.shift_id, body.waiter_id);
    case 'getWaiterCurrentCash':
      return await getWaiterCurrentCash(params.waiter_id || body.waiter_id);
    case 'saveDelivery':
      return await saveDelivery(body);
    case 'deleteDelivery':
      return await deleteDelivery(body.id);
    case 'saveWriteoff':
      return await saveWriteoff(body);
    case 'deleteWriteoff':
      return await deleteWriteoff(body.id);
    case 'reorderMenu': {
      const items = body.items || [];
      for (const it of items) {
        await dbUpdate('menu', it.id, { sort: it.sort });
      }
      return { ok: true };
    }
    case 'reorderCategories': {
      const items = body.items || [];
      for (const it of items) {
        await dbUpdate('categories', it.id, { sort: it.sort });
      }
      return { ok: true };
    }
    case 'uploadSound':
      return await saveSettingsToDB({ ['sound_' + body.name]: body.url });
    case 'deleteSound':
      return await saveSettingsToDB({ ['sound_' + body.name]: '' });
    case 'cleanupSessions':
      return { deleted: 0 }; // No sessions in Supabase — using localStorage
    default:
      throw new Error('Unknown apiPost action: ' + action);
  }
}
