/**
 * Restaurant Order Management System - Google Apps Script Backend
 * Backend for waiter/cook/admin HTML application
 * Data is stored in Google Sheets
 */

const SHEETS = {
  SETTINGS: 'Settings',
  CATEGORIES: 'Categories',
  MENU: 'Menu',
  ORDERS: 'Orders',
  ORDER_ITEMS: 'OrderItems',
  USERS: 'Users'
};

const HEADERS = {
  Settings: ['key', 'value'],
  Categories: ['id', 'parent_id', 'name', 'name_translation', 'sort', 'is_active'],
  Menu: ['id', 'category_id', 'name', 'name_translation', 'price', 'needs_cooking', 'sort', 'is_active'],
  Orders: ['id', 'table_number', 'guests', 'main_category_id', 'main_category_name', 'status', 'total', 'created_at', 'completed_at', 'waiter_note', 'waiter_id', 'waiter_name', 'cook_id', 'cook_name', 'payment_method'],
  OrderItems: ['id', 'order_id', 'menu_item_id', 'name', 'name_translation', 'category_name', 'category_name_translation', 'price', 'quantity', 'comment', 'is_ready', 'needs_cooking', 'created_at'],
  Users: ['id', 'name', 'role', 'pin', 'is_active', 'sort', 'created_at']
};

/**
 * One-time setup: creates sheets and seeds default data.
 * Run this once from the Apps Script editor before deploying.
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function(key) {
    const name = SHEETS[key];
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }
    sheet.clear();
    sheet.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
    sheet.setFrozenRows(1);
  });

  // Seed settings
  const settingsSheet = ss.getSheetByName(SHEETS.SETTINGS);
  const settings = [
    ['currency', '₽'],
    ['table_count', '20'],
    ['restaurant_name', 'Мой Ресторан'],
    ['tax_percent', '0'],
    ['sound_notifications', 'true'],
    ['translation_lang', '']  // e.g. "English", "ქართული", "Türkçe" — empty = no translation
  ];
  settingsSheet.getRange(2, 1, settings.length, 2).setValues(settings);

  // Seed main categories
  const catSheet = ss.getSheetByName(SHEETS.CATEGORIES);
  const cats = [
    ['c1', '', 'Завтрак', 1, true],
    ['c2', '', 'Обед', 2, true],
    ['c3', '', 'Ужин', 3, true],
    ['c4', '', 'Бар', 4, true],
    // Subcategories for Завтрак
    ['s1', 'c1', 'Яичницы и омлеты', 1, true],
    ['s2', 'c1', 'Каши', 2, true],
    ['s3', 'c1', 'Сладкое', 3, true],
    // Subcategories for Обед
    ['s4', 'c2', 'Первые блюда', 1, true],
    ['s5', 'c2', 'Горячее', 2, true],
    ['s6', 'c2', 'Закуски', 3, true],
    ['s7', 'c2', 'Салаты', 4, true],
    // Subcategories for Ужин
    ['s8', 'c3', 'Горячее', 1, true],
    ['s9', 'c3', 'Закуски', 2, true],
    ['s10', 'c3', 'Салаты', 3, true],
    ['s11', 'c3', 'Десерты', 4, true],
    // Subcategories for Бар
    ['s12', 'c4', 'Алкоголь', 1, true],
    ['s13', 'c4', 'Безалкогольные', 2, true],
    ['s14', 'c4', 'Снеки', 3, true]
  ];
  catSheet.getRange(2, 1, cats.length, 5).setValues(cats);

  // Seed sample menu items
  // Columns: id, category_id, name, name_translation, price, needs_cooking, sort, is_active
  const menuSheet = ss.getSheetByName(SHEETS.MENU);
  const menu = [
    ['m1', 's1', 'Яичница с ветчиной', 'Eggs with ham', 280, true, 1, true],
    ['m2', 's1', 'Омлет с сыром', 'Cheese omelette', 250, true, 2, true],
    ['m3', 's2', 'Овсяная каша', 'Oatmeal', 180, true, 1, true],
    ['m4', 's2', 'Гречневая каша', 'Buckwheat porridge', 180, true, 2, true],
    ['m5', 's3', 'Сырники', 'Cottage cheese pancakes', 320, true, 1, true],
    ['m6', 's3', 'Блинчики с медом', 'Pancakes with honey', 220, true, 2, true],
    ['m7', 's4', 'Борщ', 'Borscht', 290, true, 1, true],
    ['m8', 's4', 'Куриный суп', 'Chicken soup', 270, true, 2, true],
    ['m9', 's5', 'Стейк рибай', 'Ribeye steak', 1200, true, 1, true],
    ['m10', 's5', 'Куриная грудка гриль', 'Grilled chicken breast', 540, true, 2, true],
    ['m11', 's6', 'Брускетта', 'Bruschetta', 320, true, 1, true],
    ['m12', 's7', 'Цезарь с курицей', 'Caesar with chicken', 420, true, 1, true],
    ['m13', 's7', 'Греческий салат', 'Greek salad', 380, true, 2, true],
    ['m14', 's8', 'Лосось на гриле', 'Grilled salmon', 980, true, 1, true],
    ['m15', 's9', 'Карпаччо', 'Carpaccio', 560, true, 1, true],
    ['m16', 's11', 'Тирамису', 'Tiramisu', 340, true, 1, true],
    ['m17', 's12', 'Вино красное (бокал)', 'Red wine (glass)', 380, false, 1, true],
    ['m18', 's12', 'Пиво разливное 0.5', 'Draft beer 0.5', 280, false, 2, true],
    ['m19', 's13', 'Кола 0.5', 'Cola 0.5', 180, false, 1, true],
    ['m20', 's13', 'Вода минеральная 0.5', 'Mineral water 0.5', 120, false, 2, true],
    ['m21', 's14', 'Орешки', 'Nuts', 150, false, 1, true],
    ['m22', 's14', 'Чипсы', 'Chips', 160, false, 2, true],
    ['m23', 's5', 'Хлеб (багет)', 'Bread (baguette)', 60, false, 3, true]
  ];
  menuSheet.getRange(2, 1, menu.length, 8).setValues(menu);

  // Seed default users (waiters + cooks)
  const usersSheet = ss.getSheetByName(SHEETS.USERS);
  const now = new Date().toISOString();
  const users = [
    ['u_w1', 'Анна',     'waiter', '', true, 1, now],
    ['u_w2', 'Борис',    'waiter', '', true, 2, now],
    ['u_w3', 'Виктор',   'waiter', '', true, 3, now],
    ['u_c1', 'Повар 1',  'cook',   '', true, 1, now],
    ['u_c2', 'Повар 2',  'cook',   '', true, 2, now]
  ];
  usersSheet.getRange(2, 1, users.length, 7).setValues(users);

  SpreadsheetApp.flush();
  return 'Setup complete. Sheets created and seeded with default data.';
}

/**
 * Migration: ensures existing sheets have the latest headers.
 * Safe to run multiple times. Use this if you already ran setup() before
 * Users / waiter_id columns were introduced.
 */
function migrate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Ensure Users sheet exists
  let usersSheet = ss.getSheetByName(SHEETS.USERS);
  if (!usersSheet) {
    usersSheet = ss.insertSheet(SHEETS.USERS);
    usersSheet.getRange(1, 1, 1, HEADERS.Users.length).setValues([HEADERS.Users]);
    usersSheet.setFrozenRows(1);
    const now = new Date().toISOString();
    const users = [
      ['u_w1', 'Анна', 'waiter', '', true, 1, now],
      ['u_c1', 'Повар 1', 'cook', '', true, 1, now]
    ];
    usersSheet.getRange(2, 1, users.length, 7).setValues(users);
  }

  // For each sheet, ensure all expected columns exist (by name, not just count).
  // Missing columns are appended at the end. Existing columns keep their data.
  [SHEETS.ORDERS, SHEETS.MENU, SHEETS.ORDER_ITEMS, SHEETS.CATEGORIES, SHEETS.SETTINGS].forEach(function(sheetName) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;  // skip if sheet doesn't exist yet
    const lastCol = sheet.getLastColumn();
    if (lastCol < 1) return;
    const existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const needed = HEADERS[sheetName];

    // Special handling: if "name_translation" needs to be inserted between "name" and "price"
    // in the Menu sheet (rather than appended at the end), we do it properly.
    // For simplicity, we APPEND missing columns at the end. The readSheet() function
    // returns objects keyed by header name, so column position doesn't matter to clients.
    needed.forEach(function(h) {
      if (existingHeaders.indexOf(h) === -1) {
        // Append this column
        const newColIdx = sheet.getLastColumn() + 1;
        sheet.getRange(1, newColIdx).setValue(h);
        // Fill empty values for existing data rows
        if (sheet.getLastRow() > 1) {
          sheet.getRange(2, newColIdx, sheet.getLastRow() - 1, 1).setValue('');
        }
      }
    });
  });

  // Ensure translation_lang setting exists
  const settingsSheet = ss.getSheetByName(SHEETS.SETTINGS);
  if (settingsSheet) {
    const settingsData = settingsSheet.getDataRange().getValues();
    const hasTranslationLang = settingsData.some(function(row) { return row[0] === 'translation_lang'; });
    if (!hasTranslationLang) {
      settingsSheet.appendRow(['translation_lang', '']);
    }
  }

  SpreadsheetApp.flush();
  return 'Migration complete.';
}

/* ============ HTTP HANDLERS ============ */

function doGet(e) {
  return handleRequest(e.parameter, null);
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ success: false, error: 'Invalid JSON body: ' + err.message });
  }
  return handleRequest(body, body);
}

function handleRequest(params, body) {
  const action = params.action;

  // Special-case: getSound returns raw base64 (no JSON wrapper) so the client
  // can fetch and decode it directly into a Blob.
  if (action === 'getSound') {
    return getSound(params.name);
  }

  try {
    let result;
    switch (action) {
      case 'getData':        result = getData(); break;
      case 'getOrders':      result = getOrders(params.status, params.since, { waiter_id: params.waiter_id }); break;
      case 'getOrder':       result = getOrder(params.id); break;
      case 'createOrder':    result = createOrder(body); break;
      case 'updateOrderStatus': result = updateOrderStatus(body); break;
      case 'addItemToOrder': result = addItemToOrder(body); break;
      case 'updateItemQuantity': result = updateItemQuantity(body); break;
      case 'updateItemComment': result = updateItemComment(body); break;
      case 'removeItemFromOrder': result = removeItemFromOrder(body); break;
      case 'toggleItemReady': result = toggleItemReady(body); break;
      case 'deleteOrder':    result = deleteOrder(body); break;
      case 'saveSettings':   result = saveSettings(body); break;
      case 'saveCategory':   result = saveCategory(body); break;
      case 'deleteCategory': result = deleteCategory(body); break;
      case 'saveMenuItem':   result = saveMenuItem(body); break;
      case 'deleteMenuItem': result = deleteMenuItem(body); break;
      case 'updateOrder':    result = updateOrder(body); break;
      case 'reorderMenu':    result = reorderMenu(body); break;
      case 'reorderCategories': result = reorderCategories(body); break;
      case 'saveUser':       result = saveUser(body); break;
      case 'deleteUser':     result = deleteUser(body); break;
      case 'getTables':      result = getTables(body); break;
      case 'uploadSound':    result = uploadSound(body); break;
      case 'deleteSound':    result = deleteSound(body); break;
      case 'ping':           result = { ok: true, time: new Date().toISOString() }; break;
      default: throw new Error('Unknown action: ' + action);
    }
    return jsonOut({ success: true, data: result });
  } catch (err) {
    return jsonOut({ success: false, error: err.message, stack: err.stack });
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============ HELPERS ============ */

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name + '. Run setup() first.');
  return sheet;
}

function readSheet(name) {
  const sheet = getSheet(name);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  const rows = data.slice(1).filter(function(r) { return r[0] !== ''; });
  return rows.map(function(r) {
    const obj = {};
    headers.forEach(function(h, i) { obj[h] = r[i]; });
    return obj;
  });
}

function genId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
}

/* ============ GET ENDPOINTS ============ */

function getData() {
  const settings = readSheet(SHEETS.SETTINGS);
  const settingsObj = {};
  settings.forEach(function(s) { settingsObj[s.key] = s.value; });

  const categories = readSheet(SHEETS.CATEGORIES).filter(function(c) { return c.is_active !== false; });
  const menu = readSheet(SHEETS.MENU).filter(function(m) { return m.is_active !== false; });
  const users = readSheet(SHEETS.USERS).filter(function(u) { return u.is_active !== false; });

  return {
    settings: settingsObj,
    categories: categories,
    menu: menu,
    users: users
  };
}

function getOrders(status, since) {
  // Optional filters from params: status, since, waiter_id, cook_id
  // (waiter_id is used by waiter UI to see only own orders)
  let orders = readSheet(SHEETS.ORDERS);
  if (status && status !== 'all') {
    orders = orders.filter(function(o) { return o.status === status; });
  }
  if (since) {
    const sinceTime = new Date(since).getTime();
    orders = orders.filter(function(o) {
      return new Date(o.created_at).getTime() > sinceTime;
    });
  }
  // Filter by waiter (waiter sees only own orders)
  // arguments may come through params (doGet) or body (doPost)
  const waiterId = (arguments[2] && arguments[2].waiter_id) ||
                   (typeof arguments[2] === 'string' ? arguments[2] : null);
  if (waiterId) {
    orders = orders.filter(function(o) { return o.waiter_id === waiterId; });
  }
  // Sort newest first
  orders.sort(function(a, b) {
    return new Date(b.created_at) - new Date(a.created_at);
  });

  // Attach items
  const items = readSheet(SHEETS.ORDER_ITEMS);
  orders.forEach(function(o) {
    o.items = items.filter(function(it) { return it.order_id === o.id; });
  });

  return { orders: orders, server_time: new Date().toISOString() };
}

function getOrder(id) {
  const orders = readSheet(SHEETS.ORDERS);
  const order = orders.find(function(o) { return o.id === id; });
  if (!order) throw new Error('Order not found: ' + id);
  const items = readSheet(SHEETS.ORDER_ITEMS).filter(function(it) { return it.order_id === id; });
  order.items = items;
  return order;
}

/* ============ ORDER MUTATIONS ============ */

function createOrder(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Verify the table is not already occupied by another waiter's active order
    const existingOrders = readSheet(SHEETS.ORDERS);
    const conflicting = existingOrders.find(function(o) {
      return Number(o.table_number) === Number(body.table_number) &&
             o.status === 'accepted' &&
             o.waiter_id && body.waiter_id &&
             o.waiter_id !== body.waiter_id;
    });
    if (conflicting) {
      throw new Error('Столик №' + body.table_number + ' уже занят другим официантом (' + (conflicting.waiter_name || 'без имени') + ')');
    }

    const orderId = genId('ord');
    const now = new Date();
    const items = body.items || [];
    let total = 0;
    items.forEach(function(it) {
      total += (Number(it.price) || 0) * (Number(it.quantity) || 1);
    });

    const sheet = getSheet(SHEETS.ORDERS);
    sheet.appendRow([
      orderId,
      body.table_number,
      body.guests,
      body.main_category_id,
      body.main_category_name || '',
      'accepted',
      total,
      now.toISOString(),
      '',
      body.waiter_note || '',
      body.waiter_id || '',
      body.waiter_name || '',
      '',   // cook_id (assigned later, optional)
      '',   // cook_name
      ''    // payment_method (filled when order is completed)
    ]);

    const itemsSheet = getSheet(SHEETS.ORDER_ITEMS);
    // Read the actual headers from the sheet so we write values to the correct
    // columns regardless of column order (migrate() may have appended new
    // columns at the end, not in the "logical" order).
    const itemsHeaders = itemsSheet.getRange(1, 1, 1, itemsSheet.getLastColumn()).getValues()[0];
    const itemRows = items.map(function(it) {
      const itemId = genId('it');
      const row = new Array(itemsHeaders.length).fill('');
      itemsHeaders.forEach(function(h, idx) {
        switch (h) {
          case 'id':             row[idx] = itemId; break;
          case 'order_id':       row[idx] = orderId; break;
          case 'menu_item_id':   row[idx] = it.menu_item_id; break;
          case 'name':           row[idx] = it.name; break;
          case 'name_translation': row[idx] = it.name_translation || ''; break;
          case 'category_name':  row[idx] = it.category_name || ''; break;
          case 'category_name_translation': row[idx] = it.category_name_translation || ''; break;
          case 'price':          row[idx] = it.price; break;
          case 'quantity':       row[idx] = it.quantity; break;
          case 'comment':        row[idx] = it.comment || ''; break;
          case 'is_ready':       row[idx] = false; break;
          case 'needs_cooking':  row[idx] = it.needs_cooking === true || it.needs_cooking === 'true'; break;
          case 'created_at':     row[idx] = now.toISOString(); break;
          default:               row[idx] = ''; break;
        }
      });
      return row;
    });
    if (itemRows.length > 0) {
      itemsSheet.getRange(itemsSheet.getLastRow() + 1, 1, itemRows.length, itemsHeaders.length).setValues(itemRows);
    }

    SpreadsheetApp.flush();
    return getOrder(orderId);
  } finally {
    lock.releaseLock();
  }
}

function updateOrderStatus(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet(SHEETS.ORDERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const statusCol = headers.indexOf('status');
    const completedCol = headers.indexOf('completed_at');
    const payCol = headers.indexOf('payment_method');
    for (let i = 1; i < data.length; i++) {
      if (data[i][idCol] === body.order_id) {
        data[i][statusCol] = body.status;
        if (body.status === 'completed') {
          data[i][completedCol] = new Date().toISOString();
          // Save payment method if provided (cash / card)
          if (payCol >= 0 && body.payment_method) {
            data[i][payCol] = body.payment_method;
          }
        } else {
          data[i][completedCol] = '';
          // Clear payment method if order is reopened
          if (payCol >= 0) data[i][payCol] = '';
        }
        break;
      }
    }
    sheet.getRange(1, 1, data.length, headers.length).setValues(data);
    SpreadsheetApp.flush();
    return getOrder(body.order_id);
  } finally {
    lock.releaseLock();
  }
}

function addItemToOrder(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const itemId = genId('it');
    const now = new Date();
    const itemsSheet = getSheet(SHEETS.ORDER_ITEMS);
    // Read actual headers to be column-order-agnostic
    const itemsHeaders = itemsSheet.getRange(1, 1, 1, itemsSheet.getLastColumn()).getValues()[0];
    const row = new Array(itemsHeaders.length).fill('');
    itemsHeaders.forEach(function(h, idx) {
      switch (h) {
        case 'id':             row[idx] = itemId; break;
        case 'order_id':       row[idx] = body.order_id; break;
        case 'menu_item_id':   row[idx] = body.menu_item_id; break;
        case 'name':           row[idx] = body.name; break;
        case 'name_translation': row[idx] = body.name_translation || ''; break;
        case 'category_name':  row[idx] = body.category_name || ''; break;
        case 'category_name_translation': row[idx] = body.category_name_translation || ''; break;
        case 'price':          row[idx] = body.price; break;
        case 'quantity':       row[idx] = body.quantity; break;
        case 'comment':        row[idx] = body.comment || ''; break;
        case 'is_ready':       row[idx] = false; break;
        case 'needs_cooking':  row[idx] = body.needs_cooking === true || body.needs_cooking === 'true'; break;
        case 'created_at':     row[idx] = now.toISOString(); break;
        default:               row[idx] = ''; break;
      }
    });
    itemsSheet.appendRow(row);
    recalcOrderTotal(body.order_id);
    SpreadsheetApp.flush();
    return getOrder(body.order_id);
  } finally {
    lock.releaseLock();
  }
}

function updateItemQuantity(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet(SHEETS.ORDER_ITEMS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const qtyCol = headers.indexOf('quantity');
    let orderId = null;
    for (let i = 1; i < data.length; i++) {
      if (data[i][idCol] === body.item_id) {
        data[i][qtyCol] = body.quantity;
        orderId = data[i][headers.indexOf('order_id')];
        break;
      }
    }
    if (orderId) {
      sheet.getRange(1, 1, data.length, headers.length).setValues(data);
      recalcOrderTotal(orderId);
      SpreadsheetApp.flush();
      return getOrder(orderId);
    }
    throw new Error('Item not found');
  } finally {
    lock.releaseLock();
  }
}

function updateItemComment(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet(SHEETS.ORDER_ITEMS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const commentCol = headers.indexOf('comment');
    let orderId = null;
    for (let i = 1; i < data.length; i++) {
      if (data[i][idCol] === body.item_id) {
        data[i][commentCol] = body.comment || '';
        orderId = data[i][headers.indexOf('order_id')];
        break;
      }
    }
    if (orderId) {
      sheet.getRange(1, 1, data.length, headers.length).setValues(data);
      SpreadsheetApp.flush();
      return getOrder(orderId);
    }
    throw new Error('Item not found');
  } finally {
    lock.releaseLock();
  }
}

function removeItemFromOrder(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet(SHEETS.ORDER_ITEMS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const orderIdCol = headers.indexOf('order_id');
    let orderId = null;
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][idCol] === body.item_id) {
        orderId = data[i][orderIdCol];
        rowIndex = i + 1;
        break;
      }
    }
    if (rowIndex > 0) {
      sheet.deleteRow(rowIndex);
      recalcOrderTotal(orderId);
      SpreadsheetApp.flush();
      return getOrder(orderId);
    }
    throw new Error('Item not found');
  } finally {
    lock.releaseLock();
  }
}

function toggleItemReady(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet(SHEETS.ORDER_ITEMS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const readyCol = headers.indexOf('is_ready');
    let orderId = null;
    for (let i = 1; i < data.length; i++) {
      if (data[i][idCol] === body.item_id) {
        data[i][readyCol] = body.is_ready === true || body.is_ready === 'true';
        orderId = data[i][headers.indexOf('order_id')];
        break;
      }
    }
    if (orderId) {
      sheet.getRange(1, 1, data.length, headers.length).setValues(data);
      SpreadsheetApp.flush();
      return getOrder(orderId);
    }
    throw new Error('Item not found');
  } finally {
    lock.releaseLock();
  }
}

function deleteOrder(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ordersSheet = getSheet(SHEETS.ORDERS);
    const itemsSheet = getSheet(SHEETS.ORDER_ITEMS);

    // Delete order row
    const ordersData = ordersSheet.getDataRange().getValues();
    const orderHeaders = ordersData[0];
    const orderIdCol = orderHeaders.indexOf('id');
    let orderRow = -1;
    for (let i = 1; i < ordersData.length; i++) {
      if (ordersData[i][orderIdCol] === body.order_id) {
        orderRow = i + 1;
        break;
      }
    }
    if (orderRow > 0) ordersSheet.deleteRow(orderRow);

    // Delete all items for this order (may be multiple rows)
    const itemsData = itemsSheet.getDataRange().getValues();
    const itemHeaders = itemsData[0];
    const itemOrderIdCol = itemHeaders.indexOf('order_id');
    for (let i = itemsData.length - 1; i >= 1; i--) {
      if (itemsData[i][itemOrderIdCol] === body.order_id) {
        itemsSheet.deleteRow(i + 1);
      }
    }
    SpreadsheetApp.flush();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function recalcOrderTotal(orderId) {
  const orders = readSheet(SHEETS.ORDERS);
  const items = readSheet(SHEETS.ORDER_ITEMS).filter(function(it) { return it.order_id === orderId; });
  let total = 0;
  items.forEach(function(it) {
    total += (Number(it.price) || 0) * (Number(it.quantity) || 1);
  });

  const sheet = getSheet(SHEETS.ORDERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  const totalCol = headers.indexOf('total');
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === orderId) {
      data[i][totalCol] = total;
      break;
    }
  }
  sheet.getRange(1, 1, data.length, headers.length).setValues(data);
}

/* ============ ADMIN: SETTINGS ============ */

function saveSettings(body) {
  const sheet = getSheet(SHEETS.SETTINGS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const keyCol = headers.indexOf('key');
  const valCol = headers.indexOf('value');
  const settings = body.settings || {};
  Object.keys(settings).forEach(function(key) {
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (data[i][keyCol] === key) {
        data[i][valCol] = settings[key];
        found = true;
        break;
      }
    }
    if (!found) {
      sheet.appendRow([key, settings[key]]);
    }
  });
  sheet.getRange(1, 1, data.length, headers.length).setValues(data);
  SpreadsheetApp.flush();
  return getData().settings;
}

/* ============ ADMIN: CATEGORIES ============ */

function saveCategory(body) {
  const sheet = getSheet(SHEETS.CATEGORIES);
  const id = body.id || genId('cat');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === id) {
      data[i][headers.indexOf('parent_id')] = body.parent_id || '';
      data[i][headers.indexOf('name')] = body.name;
      if (headers.indexOf('name_translation') >= 0) {
        data[i][headers.indexOf('name_translation')] = body.name_translation || '';
      }
      data[i][headers.indexOf('sort')] = body.sort || 0;
      data[i][headers.indexOf('is_active')] = body.is_active !== false;
      found = true;
      break;
    }
  }
  if (!found) {
    // Build row by header name to be column-order-agnostic
    const headersNow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const row = new Array(headersNow.length).fill('');
    headersNow.forEach(function(h, idx) {
      switch (h) {
        case 'id':               row[idx] = id; break;
        case 'parent_id':        row[idx] = body.parent_id || ''; break;
        case 'name':             row[idx] = body.name; break;
        case 'name_translation': row[idx] = body.name_translation || ''; break;
        case 'sort':             row[idx] = body.sort || 0; break;
        case 'is_active':        row[idx] = body.is_active !== false; break;
        default:                 row[idx] = ''; break;
      }
    });
    sheet.appendRow(row);
  } else {
    sheet.getRange(1, 1, data.length, headers.length).setValues(data);
  }
  SpreadsheetApp.flush();
  return { id: id };
}

function deleteCategory(body) {
  const sheet = getSheet(SHEETS.CATEGORIES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === body.id) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex > 0) {
    sheet.deleteRow(rowIndex);
    SpreadsheetApp.flush();
  }
  return { ok: true };
}

/* ============ ADMIN: MENU ============ */

function saveMenuItem(body) {
  const sheet = getSheet(SHEETS.MENU);
  const id = body.id || genId('m');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === id) {
      data[i][headers.indexOf('category_id')] = body.category_id || '';
      data[i][headers.indexOf('name')] = body.name;
      data[i][headers.indexOf('name_translation')] = body.name_translation || '';
      data[i][headers.indexOf('price')] = Number(body.price) || 0;
      data[i][headers.indexOf('needs_cooking')] = body.needs_cooking === true || body.needs_cooking === 'true';
      data[i][headers.indexOf('sort')] = body.sort || 0;
      data[i][headers.indexOf('is_active')] = body.is_active !== false;
      found = true;
      break;
    }
  }
  if (!found) {
    sheet.appendRow([id, body.category_id || '', body.name, body.name_translation || '',
      Number(body.price) || 0,
      body.needs_cooking === true || body.needs_cooking === 'true',
      body.sort || 0, body.is_active !== false]);
  } else {
    sheet.getRange(1, 1, data.length, headers.length).setValues(data);
  }
  SpreadsheetApp.flush();
  return { id: id };
}

function deleteMenuItem(body) {
  const sheet = getSheet(SHEETS.MENU);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === body.id) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex > 0) {
    sheet.deleteRow(rowIndex);
    SpreadsheetApp.flush();
  }
  return { ok: true };
}

/* ============ ADMIN: ORDER EDIT ============ */

function updateOrder(body) {
  // Used by admin to modify any field of an order
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet(SHEETS.ORDERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    for (let i = 1; i < data.length; i++) {
      if (data[i][idCol] === body.order_id) {
        if (body.table_number !== undefined) data[i][headers.indexOf('table_number')] = body.table_number;
        if (body.guests !== undefined) data[i][headers.indexOf('guests')] = body.guests;
        if (body.status !== undefined) {
          data[i][headers.indexOf('status')] = body.status;
          if (body.status === 'completed') {
            data[i][headers.indexOf('completed_at')] = new Date().toISOString();
          }
        }
        if (body.waiter_note !== undefined) data[i][headers.indexOf('waiter_note')] = body.waiter_note;
        break;
      }
    }
    sheet.getRange(1, 1, data.length, headers.length).setValues(data);
    SpreadsheetApp.flush();
    return getOrder(body.order_id);
  } finally {
    lock.releaseLock();
  }
}

/* ============ ADMIN: REORDER (DRAG & DROP) ============ */

/**
 * Reorder menu items.
 * body.items = [{ id: '...', sort: 0 }, { id: '...', sort: 1 }, ...]
 */
function reorderMenu(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet(SHEETS.MENU);
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { ok: true };
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const sortCol = headers.indexOf('sort');
    const items = body.items || [];
    const sortMap = {};
    items.forEach(function(it) { sortMap[it.id] = Number(it.sort) || 0; });
    for (let i = 1; i < data.length; i++) {
      const id = data[i][idCol];
      if (sortMap[id] !== undefined) {
        data[i][sortCol] = sortMap[id];
      }
    }
    sheet.getRange(1, 1, data.length, headers.length).setValues(data);
    SpreadsheetApp.flush();
    return { ok: true, updated: items.length };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Reorder categories.
 * body.items = [{ id: '...', sort: 0 }, ...]
 */
function reorderCategories(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet(SHEETS.CATEGORIES);
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { ok: true };
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const sortCol = headers.indexOf('sort');
    const items = body.items || [];
    const sortMap = {};
    items.forEach(function(it) { sortMap[it.id] = Number(it.sort) || 0; });
    for (let i = 1; i < data.length; i++) {
      const id = data[i][idCol];
      if (sortMap[id] !== undefined) {
        data[i][sortCol] = sortMap[id];
      }
    }
    sheet.getRange(1, 1, data.length, headers.length).setValues(data);
    SpreadsheetApp.flush();
    return { ok: true, updated: items.length };
  } finally {
    lock.releaseLock();
  }
}

/* ============ USERS (STAFF) ============ */

function saveUser(body) {
  const sheet = getSheet(SHEETS.USERS);
  const id = body.id || genId('u');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === id) {
      data[i][headers.indexOf('name')] = body.name;
      data[i][headers.indexOf('role')] = body.role || 'waiter';
      data[i][headers.indexOf('pin')] = body.pin || '';
      data[i][headers.indexOf('is_active')] = body.is_active !== false;
      data[i][headers.indexOf('sort')] = body.sort || 0;
      found = true;
      break;
    }
  }
  if (!found) {
    sheet.appendRow([
      id,
      body.name,
      body.role || 'waiter',
      body.pin || '',
      body.is_active !== false,
      body.sort || 0,
      new Date().toISOString()
    ]);
  } else {
    sheet.getRange(1, 1, data.length, headers.length).setValues(data);
  }
  SpreadsheetApp.flush();
  return { id: id };
}

function deleteUser(body) {
  const sheet = getSheet(SHEETS.USERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === body.id) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex > 0) {
    sheet.deleteRow(rowIndex);
    SpreadsheetApp.flush();
  }
  return { ok: true };
}

/**
 * Returns the list of tables with their occupation status.
 * If waiter_id is provided, marks tables as 'mine' / 'other' / 'free'.
 * Response: [{ table: 1, status: 'free' | 'mine' | 'other', waiter_name: 'Anna' }]
 */
function getTables(body) {
  const tableCount = Number(getSetting('table_count')) || 20;
  const orders = readSheet(SHEETS.ORDERS).filter(function(o) {
    return o.status === 'accepted';
  });
  const tables = [];
  for (let i = 1; i <= tableCount; i++) {
    const occ = orders.find(function(o) { return Number(o.table_number) === i; });
    let status = 'free';
    let waiterName = '';
    if (occ) {
      waiterName = occ.waiter_name || '';
      if (body && body.waiter_id && occ.waiter_id === body.waiter_id) {
        status = 'mine';
      } else {
        status = 'other';
      }
    }
    tables.push({ table: i, status: status, waiter_name: waiterName });
  }
  return { tables: tables };
}

function getSetting(key) {
  const settings = readSheet(SHEETS.SETTINGS);
  const s = settings.find(function(x) { return x.key === key; });
  return s ? s.value : null;
}

/* ============ SOUNDS ============ */

/**
 * Stores a sound as base64 in the Settings sheet under keys:
 *   sound_cook_new_order    — played for cook when a new order arrives
 *   sound_waiter_ready      — played for waiter when a dish becomes ready
 * Body: { name: 'cook_new_order' | 'waiter_ready', data: '<base64>', mime: 'audio/mp3' }
 */
function uploadSound(body) {
  if (!body.name || !body.data) throw new Error('Missing name or data');
  if (body.data.length > 800000) {
    throw new Error('Sound file too large (max ~600KB after base64). Use a shorter MP3/WAV.');
  }
  const settings = {};
  settings['sound_' + body.name] = body.data;
  settings['sound_' + body.name + '_mime'] = body.mime || 'audio/mp3';
  // Reuse saveSettings
  saveSettings({ settings: settings });
  return { ok: true, name: body.name, size: body.data.length };
}

/**
 * Returns the raw base64-encoded sound for the given name.
 * Used by clients via ?action=getSound&name=cook_new_order
 */
function getSound(name) {
  if (!name) return jsonOut({ error: 'Missing name' });
  const key = 'sound_' + name;
  const mimeKey = key + '_mime';
  const data = getSetting(key);
  const mime = getSetting(mimeKey) || 'audio/mp3';
  if (!data) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'not found' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // Return as plain text base64 — client will decode
  return ContentService
    .createTextOutput(JSON.stringify({ data: data, mime: mime }))
    .setMimeType(ContentService.MimeType.JSON);
}

function deleteSound(body) {
  const key = 'sound_' + body.name;
  const mimeKey = key + '_mime';
  const sheet = getSheet(SHEETS.SETTINGS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const keyCol = headers.indexOf('key');
  let toDelete = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][keyCol] === key || data[i][keyCol] === mimeKey) {
      toDelete.push(i + 1);
    }
  }
  // Delete in reverse order
  toDelete.reverse().forEach(function(r) { sheet.deleteRow(r); });
  SpreadsheetApp.flush();
  return { ok: true };
}
