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
  const [settings, categories, menu, users, modifications] = await Promise.all([
    dbSelect('settings'),
    dbSelect('categories'),
    dbSelect('menu'),
    dbSelect('users'),
    dbSelect('menu_modifications')
  ]);

  // Filter active items on client side
  const activeCategories = categories.filter(function(c) { return c.is_active === true || c.is_active === 'true'; });
  const activeMenu = menu.filter(function(m) { return m.is_active === true || m.is_active === 'true'; });
  const activeUsers = users.filter(function(u) { return u.is_active === true || u.is_active === 'true'; });
  const activeModifications = modifications.filter(function(m) { return m.is_active === true || m.is_active === 'true'; });

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
      modifications: modsByMenu[m.id] || []
    });
  });

  APP_DATA = {
    settings: settingsObj,
    categories: activeCategories,
    menu: menuWithMods,
    modifications: activeModifications,
    users: activeUsers.map(function(u) {
      return {
        id: u.id,
        name: u.name,
        role: u.role,
        is_active: u.is_active,
        sort: u.sort,
        has_password: !!(u.pin && String(u.pin).length > 0)
      };
    })
  };

  return APP_DATA;
}

async function loadAppDataForce() {
  return loadAppData(true);
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

  const { data: orders, error: orderError } = await orderQuery;
  if (orderError) {
    console.error('getOrders error:', orderError);
    throw new Error(orderError.message);
  }

  // Fetch items for these orders
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
      price: Number(it.price) || 0,
      quantity: Number(it.quantity) || 1,
      comment: it.comment || '',
      is_ready: it.is_ready === true,
      is_served: it.is_served === true,
      needs_cooking: it.needs_cooking === true,
      created_at: it.created_at
    });
  });

  // Attach items to orders
  const result = (orders || []).map(function(o) {
    o.items = itemsByOrder[o.id] || [];
    return o;
  });

  return { orders: orders, server_time: new Date().toISOString() };
}

async function getOrder(id) {
  // Query order and items separately (avoid join issues)
  const { data: orderData, error: orderError } = await _sb
    .from('orders')
    .select('*')
    .eq('id', id)
    .single();
  if (orderError) throw new Error(orderError.message);

  const { data: itemsData, error: itemsError } = await _sb
    .from('order_items')
    .select('*')
    .eq('order_id', id);
  if (itemsError) console.error('getOrder items error:', itemsError);

  const data = orderData;
  data.items = (itemsData || []).map(function(it) {
    return {
      id: it.id,
      order_id: it.order_id,
      menu_item_id: it.menu_item_id || '',
      name: it.name,
      name_translation: it.name_translation || '',
      category_name: it.category_name || '',
      category_name_translation: it.category_name_translation || '',
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

  return await getOrder(orderId);
}

async function updateOrderStatus(orderId, status, paymentMethod) {
  const updates = { status: status };
  if (status === 'completed') {
    updates.completed_at = new Date().toISOString();
    if (paymentMethod) updates.payment_method = paymentMethod;
  }
  await dbUpdate('orders', orderId, updates);
  return await getOrder(orderId);
}

async function addItemToOrder(itemData) {
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
  await dbDelete('order_items', itemId);
  await recalcOrderTotalDB(orderId);
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
  // Delete items first
  await _sb.from('order_items').delete().eq('order_id', orderId);
  await dbDelete('orders', orderId);
  return { ok: true };
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
  const tableCount = Number(await getSetting('table_count')) || 20;
  const { data: orders } = await _sb
    .from('orders')
    .select('table_number, waiter_id, waiter_name, table_type')
    .eq('status', 'accepted');

  const tables = [];
  const activeOrders = orders || [];

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
  const virtualTablesSetting = await getSetting('virtual_tables') || '';
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

async function closeShift(waiterId) {
  const shifts = await dbSelect('shifts', { waiter_id: waiterId, status: 'open' });
  if (shifts.length === 0) throw new Error('Нет открытой смены');
  const shift = shifts[0];

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

  const now = new Date().toISOString();
  await dbUpdate('shifts', shift.id, {
    closed_at: now,
    status: 'closed',
    cash_total: cashTotal,
    card_total: cardTotal,
    orders_count: (orders || []).length,
    guests_count: guestsCount
  });

  // Add cash to register
  const currentCash = Number(await getSetting('cash_register')) || 0;
  await saveSettingsToDB({ cash_register: String(currentCash + cashTotal) });

  const openingCash = Number(shift.opening_cash) || 0;
  return {
    id: shift.id,
    opened_at: shift.opened_at,
    closed_at: now,
    opening_cash: openingCash,
    orders_count: (orders || []).length,
    guests_count: guestsCount,
    cash_total: cashTotal,
    card_total: cardTotal,
    final_cash: openingCash + cashTotal,
    status: 'closed'
  };
}

async function getActiveShift(waiterId) {
  const shifts = await dbSelect('shifts', { waiter_id: waiterId, status: 'open' });
  const shift = shifts.length > 0 ? shifts[0] : null;
  const currentCash = Number(await getSetting('cash_register')) || 0;
  const cookEnabled = String(await getSetting('cook_enabled')) !== 'false';
  return { shift: shift, current_cash: currentCash, cook_enabled: cookEnabled };
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

async function getStockReport() {
  const stockTracking = String(await getSetting('stock_tracking')) === 'true';
  const threshold = Number(await getSetting('stock_threshold')) || 5;
  const allMenu = await dbSelect('menu');
  const menu = allMenu.filter(function(m) { return m.is_active === true || m.is_active === 'true'; });

  // Get all order items for consumption calculation
  const { data: allItems } = await _sb
    .from('order_items')
    .select('menu_item_id, quantity, order_id, created_at');

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const consumption = {};
  (allItems || []).forEach(function(it) {
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

  const items = menu.map(function(m) {
    const stock = Number(m.stock) || 0;
    const cons = consumption[m.id] || { day: 0, week: 0, month: 0, total: 0 };
    return {
      id: m.id,
      name: m.name,
      sort: Number(m.sort) || 0,
      stock: stock,
      consumed_day: cons.day,
      consumed_week: cons.week,
      consumed_month: cons.month,
      consumed_total: cons.total,
      low_stock: stockTracking && stock <= threshold
    };
  });
  // Sort by sort field, then by name — keeps the order stable across reloads
  // (otherwise PostgreSQL may return rows in different physical order after updates)
  items.sort(function(a, b) {
    const sa = Number(a.sort) || 0;
    const sb = Number(b.sort) || 0;
    if (sa !== sb) return sa - sb;
    return String(a.name).localeCompare(String(b.name), 'ru');
  });

  return { stock_tracking: stockTracking, threshold: threshold, items: items };
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

  return {
    token: 'session_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 12),
    user: { id: user.id, name: user.name, role: user.role },
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
  const hasDec = (n % 1) !== 0;
  const formatted = hasDec ? n.toFixed(2) : Math.round(n).toString();
  return formatted + ' ' + cur;
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
    case 'getStockReport':
      return await getStockReport();
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
      const cookEnabled = String(await getSetting('cook_enabled')) !== 'false';
      // Orders
      const ordersData = await getOrders('accepted', waiterId);
      // Tables
      const tablesData = await getTables(waiterId);
      // Shift
      const shiftData = await getActiveShift(waiterId);
      return {
        orders: ordersData.orders,
        tables: tablesData.tables,
        shift: shiftData.shift,
        current_cash: shiftData.current_cash,
        cook_enabled: cookEnabled,
        server_time: new Date().toISOString()
      };
    }
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
      return await updateOrderStatus(body.order_id, body.status, body.payment_method);
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
    case 'pauseOrder':
      return await pauseOrderDB(body.order_id);
    case 'resumeOrder':
      return await resumeOrderDB(body.order_id);
    case 'openShift':
      return await openShiftDB(body.waiter_id, body.waiter_name, body.opening_cash);
    case 'closeShift':
      return await closeShift(body.waiter_id);
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
        has_modifications: hasMods
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
        sort: body.sort || 0
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
