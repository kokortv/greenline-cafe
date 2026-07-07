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
  USERS: 'Users',
  TABS: 'Tabs',
  SHIFTS: 'Shifts'
};

const HEADERS = {
  Settings: ['key', 'value'],
  Categories: ['id', 'parent_id', 'name', 'name_translation', 'sort', 'is_active'],
  Menu: ['id', 'category_id', 'name', 'name_translation', 'price', 'needs_cooking', 'sort', 'is_active'],
  Orders: ['id', 'table_number', 'table_type', 'tab_id', 'guests', 'main_category_id', 'main_category_name', 'status', 'total', 'created_at', 'completed_at', 'waiter_note', 'waiter_id', 'waiter_name', 'cook_id', 'cook_name', 'payment_method'],
  OrderItems: ['id', 'order_id', 'menu_item_id', 'name', 'name_translation', 'category_name', 'category_name_translation', 'price', 'quantity', 'comment', 'is_ready', 'is_served', 'needs_cooking', 'created_at'],
  Users: ['id', 'name', 'role', 'pin', 'is_active', 'sort', 'created_at'],
  Tabs: ['id', 'name', 'phone', 'notes', 'total', 'status', 'created_at', 'closed_at', 'created_by_waiter_id', 'created_by_waiter_name'],
  Shifts: ['id', 'waiter_id', 'waiter_name', 'opened_at', 'closed_at', 'opening_cash', 'orders_count', 'guests_count', 'cash_total', 'card_total', 'status']
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
    ['translation_lang', ''],  // e.g. "English", "ქართული", "Türkçe" — empty = no translation
    // Polling intervals (in seconds). Admin can change these in the UI.
    ['poll_interval_waiter', '20'],  // waiter: refresh active orders + ready alerts
    ['poll_interval_cook', '10'],     // cook: refresh for new orders + readiness
    // Virtual tables — comma-separated names. Appear at the bottom of the
    // waiter's table grid. Orders to these tables are visible to ALL waiters
    // (not isolated). Examples: "Бар", "Терраса", "Гардероб".
    // Each click on a virtual table opens a NEW parallel order — they're
    // never "occupied" in the exclusive sense.
    ['virtual_tables', 'Бар'],
    // Cook enabled — if false, waiters can serve dishes without cook marking them ready
    ['cook_enabled', 'true'],
    // Cash register — current cash amount (editable only in admin)
    ['cash_register', '0']
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

  // Seed default users (waiters + cooks + admin). Passwords are empty by default
  // (admin must set them via the admin UI). The admin user is special: it's
  // the only one who can set passwords for other users.
  const usersSheet = ss.getSheetByName(SHEETS.USERS);
  const now = new Date().toISOString();
  const users = [
    ['u_w1', 'Анна',     'waiter', '', true, 1, now],
    ['u_w2', 'Борис',    'waiter', '', true, 2, now],
    ['u_w3', 'Виктор',   'waiter', '', true, 3, now],
    ['u_c1', 'Повар 1',  'cook',   '', true, 1, now],
    ['u_c2', 'Повар 2',  'cook',   '', true, 2, now],
    ['u_admin', 'Администратор', 'admin', '', true, 0, now]
  ];
  usersSheet.getRange(2, 1, users.length, 7).setValues(users);

  SpreadsheetApp.flush();
  invalidateAllCaches();
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
      ['u_c1', 'Повар 1', 'cook', '', true, 1, now],
      ['u_admin', 'Администратор', 'admin', '', true, 0, now]
    ];
    usersSheet.getRange(2, 1, users.length, 7).setValues(users);
  } else {
    // Ensure admin user exists even if Users sheet was created by older setup()
    const usersData = usersSheet.getDataRange().getValues();
    const hasAdmin = usersData.some(function(row) { return row[2] === 'admin'; });
    if (!hasAdmin) {
      const now = new Date().toISOString();
      usersSheet.appendRow(['u_admin', 'Администратор', 'admin', '', true, 0, now]);
    }
  }

  // For each sheet, ensure all expected columns exist (by name, not just count).
  // Missing columns are appended at the end. Existing columns keep their data.
  [SHEETS.ORDERS, SHEETS.MENU, SHEETS.ORDER_ITEMS, SHEETS.CATEGORIES, SHEETS.SETTINGS, SHEETS.TABS].forEach(function(sheetName) {
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

  // Ensure optional settings exist (added in later versions)
  const settingsSheet = ss.getSheetByName(SHEETS.SETTINGS);
  if (settingsSheet) {
    const settingsData = settingsSheet.getDataRange().getValues();
    const existingKeys = settingsData.map(function(row) { return row[0]; });
    const ensureSetting = function(key, defaultValue) {
      if (existingKeys.indexOf(key) === -1) {
        settingsSheet.appendRow([key, defaultValue]);
      }
    };
    ensureSetting('translation_lang', '');
    ensureSetting('poll_interval_waiter', '20');
    ensureSetting('poll_interval_cook', '10');
    ensureSetting('virtual_tables', 'Бар');
    ensureSetting('cook_enabled', 'true');
    ensureSetting('cash_register', '0');
  }

  // Ensure Tabs sheet exists
  if (!ss.getSheetByName(SHEETS.TABS)) {
    const tabsSheet = ss.insertSheet(SHEETS.TABS);
    tabsSheet.getRange(1, 1, 1, HEADERS.Tabs.length).setValues([HEADERS.Tabs]);
    tabsSheet.setFrozenRows(1);
  }

  // Ensure Shifts sheet exists
  if (!ss.getSheetByName(SHEETS.SHIFTS)) {
    const shiftsSheet = ss.insertSheet(SHEETS.SHIFTS);
    shiftsSheet.getRange(1, 1, 1, HEADERS.Shifts.length).setValues([HEADERS.Shifts]);
    shiftsSheet.setFrozenRows(1);
  }

  SpreadsheetApp.flush();
  invalidateAllCaches();
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

  // Special-case: login is unauthenticated (it GRANTS a token, so it can't
  // require one). Returns a short-lived token + the user record (without pin).
  if (action === 'login') {
    return doLogin(body);
  }

  try {
    let result;
    switch (action) {
      case 'getData':        result = getData(); break;
      case 'getDataVersion': result = getDataVersion(); break;
      case 'getOrders':      result = getOrders(params.status, params.since, { waiter_id: params.waiter_id }); break;
      case 'getOrder':       result = getOrder(params.id); break;
      case 'createOrder':    result = createOrder(body); break;
      case 'updateOrderStatus': result = updateOrderStatus(body); break;
      case 'addItemToOrder': result = addItemToOrder(body); break;
      case 'updateItemQuantity': result = updateItemQuantity(body); break;
      case 'updateItemComment': result = updateItemComment(body); break;
      case 'removeItemFromOrder': result = removeItemFromOrder(body); break;
      case 'toggleItemReady': result = toggleItemReady(body); break;
      case 'toggleItemServed': result = toggleItemServed(body); break;
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
      case 'logout':         result = doLogout(body); break;
      case 'setPassword':    result = setPassword(body); break;
      case 'changePassword': result = changePassword(body); break;
      case 'getTabs':        result = getTabs(body); break;
      case 'createTab':      result = createTab(body); break;
      case 'closeTab':       result = closeTab(body); break;
      case 'getTabOrders':   result = getTabOrders(body.tab_id || params.tab_id); break;
      case 'pauseOrder':     result = pauseOrder(body); break;
      case 'resumeOrder':    result = resumeOrder(body); break;
      case 'cleanupSessions': result = { deleted: cleanupExpiredSessions() }; break;
      case 'openShift':       result = openShift(body); break;
      case 'closeShift':      result = closeShift(body); break;
      case 'getActiveShift':  result = getActiveShift(params); break;
      case 'getShifts':       result = getShifts(body); break;
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

// Cache layer — avoids re-reading the full sheet on every request.
// CacheService is per-user, in-memory on Google's servers, ~50ms access.
// TTL: 5 seconds (long enough to batch rapid polling, short enough to stay fresh).
const CACHE_TTL = 3; // seconds — short enough for real-time, long enough to batch rapid polls

function readSheet(name) {
  // Try cache first
  const cacheKey = 'sheet_' + name;
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through */ }
  }
  // Cache miss — read from sheet
  const sheet = getSheet(name);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  // Only read the used range (not the entire data range)
  const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = data[0];
  const rows = data.slice(1).filter(function(r) { return r[0] !== ''; });
  const result = rows.map(function(r) {
    const obj = {};
    headers.forEach(function(h, i) { obj[h] = r[i]; });
    return obj;
  });
  // Store in cache
  try { cache.put(cacheKey, JSON.stringify(result), CACHE_TTL); } catch (e) {}
  return result;
}

// Invalidate cache for a sheet (call after any write operation)
function invalidateCache(name) {
  const cache = CacheService.getScriptCache();
  cache.remove('sheet_' + name);
}

// Invalidate all caches (call after batch operations)
function invalidateAllCaches() {
  const cache = CacheService.getScriptCache();
  Object.keys(SHEETS).forEach(function(k) {
    cache.remove('sheet_' + SHEETS[k]);
  });
}

function genId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
}

/**
 * Safely delete a row from a sheet. Google Sheets throws
 * "it is not possible to delete all non-frozen rows" when you try to delete
 * the LAST non-frozen row. This helper detects that case and clears the row's
 * content instead of deleting it.
 *
 * @param {Sheet} sheet — the sheet to delete from
 * @param {number} rowIdx — 1-indexed row number to delete
 */
function safeDeleteRow(sheet, rowIdx) {
  if (sheet.getLastRow() <= 1) return; // only header, nothing to delete
  // If this is the only data row (header at row 1, data at row 2), clear content
  if (sheet.getLastRow() === 2 && rowIdx === 2) {
    sheet.getRange(2, 1, 1, sheet.getLastColumn()).clearContent();
  } else {
    sheet.deleteRow(rowIdx);
  }
}

/* ============ GET ENDPOINTS ============ */

function getData() {
  const settings = readSheet(SHEETS.SETTINGS);
  const settingsObj = {};
  // Filter out session keys (don't leak sessions to clients)
  settings.forEach(function(s) {
    if (s.key && s.key.indexOf('session_') !== 0) {
      settingsObj[s.key] = s.value;
    }
  });

  const categories = readSheet(SHEETS.CATEGORIES).filter(function(c) { return c.is_active !== false; });
  const menu = readSheet(SHEETS.MENU).filter(function(m) { return m.is_active !== false; });
  // Return users WITHOUT the pin field (security: never expose password hashes)
  const users = readSheet(SHEETS.USERS)
    .filter(function(u) { return u.is_active !== false; })
    .map(function(u) {
      return {
        id: u.id,
        name: u.name,
        role: u.role,
        is_active: u.is_active,
        sort: u.sort,
        has_password: !!(u.pin !== null && u.pin !== undefined && String(u.pin).length > 0)
      };
    });

  // Compute a simple version hash so clients can skip re-parsing if nothing
  // changed. Based on row counts + last modified time of each sheet.
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const versionParts = [];
  [SHEETS.SETTINGS, SHEETS.CATEGORIES, SHEETS.MENU, SHEETS.USERS].forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (sheet) {
      versionParts.push(name + ':' + sheet.getLastRow() + ':' + sheet.getLastColumn());
    }
  });
  const versionHash = versionParts.join('|');

  return {
    settings: settingsObj,
    categories: categories,
    menu: menu,
    users: users,
    _version: versionHash
  };
}

/**
 * Lightweight endpoint that returns only the version hash (no data).
 * Clients poll this to check if they need to re-fetch full data.
 * Much faster than getData() because it doesn't read row contents.
 */
function getDataVersion() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const versionParts = [];
  [SHEETS.SETTINGS, SHEETS.CATEGORIES, SHEETS.MENU, SHEETS.USERS].forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (sheet) {
      versionParts.push(name + ':' + sheet.getLastRow() + ':' + sheet.getLastColumn());
    }
  });
  return { _version: versionParts.join('|') };
}

function getOrders(status, since) {
  // Optional filters from params: status, since, waiter_id, cook_id
  // Status values: 'accepted', 'paused', 'completed', 'all'
  // Special: 'accepted_only' — strictly accepted (used by cook UI to exclude
  // paused orders from the kitchen queue).
  // For waiters: when status='accepted' (default), return both 'accepted'
  // AND 'paused' (paused = client hasn't paid yet, account on hold — visible
  // to all waiters so they can resume and add more items).
  let orders = readSheet(SHEETS.ORDERS);
  if (status && status !== 'all') {
    if (status === 'accepted_only') {
      orders = orders.filter(function(o) { return o.status === 'accepted'; });
    } else if (status === 'accepted') {
      // Default waiter query — include both accepted and paused
      orders = orders.filter(function(o) { return o.status === 'accepted' || o.status === 'paused'; });
    } else {
      orders = orders.filter(function(o) { return o.status === status; });
    }
  }
  if (since) {
    const sinceTime = new Date(since).getTime();
    orders = orders.filter(function(o) {
      return new Date(o.created_at).getTime() > sinceTime;
    });
  }
  // Filter by waiter (waiter sees only own orders).
  // EXCEPTION: orders for virtual tables ('virtual' type) and tab orders
  // are visible to ALL waiters — so anyone can serve a bar customer or
  // add to a long-running client tab.
  const waiterId = (arguments[2] && arguments[2].waiter_id) ||
                   (typeof arguments[2] === 'string' ? arguments[2] : null);
  if (waiterId) {
    orders = orders.filter(function(o) {
      // Own orders always visible
      if (o.waiter_id === waiterId) return true;
      // Virtual tables and tabs — visible to all
      if (o.table_type === 'virtual' || o.table_type === 'tab') return true;
      // Otherwise — not visible
      return false;
    });
  }
  // Sort newest first
  orders.sort(function(a, b) {
    return new Date(b.created_at) - new Date(a.created_at);
  });

  // LIMIT the number of orders returned to keep responses fast.
  // For active/paused orders — no limit needed (typically <50).
  // For completed/all — limit to last 200 to avoid huge payloads.
  if (status === 'all' || status === 'completed') {
    orders = orders.slice(0, 200);
  }

  // Attach items — OPTIMIZED: only read items for the orders we're returning.
  // Previously we read ALL OrderItems (including completed orders from months
  // ago) and filtered in memory — slow with thousands of rows.
  // Now we collect the order IDs we need, then read OrderItems once and
  // attach only matching ones.
  const orderIds = {};
  orders.forEach(function(o) { orderIds[o.id] = true; });
  const allItems = readSheet(SHEETS.ORDER_ITEMS);
  // Group items by order_id in a single pass
  const itemsByOrder = {};
  for (let i = 0; i < allItems.length; i++) {
    const it = allItems[i];
    const oid = it.order_id;
    if (orderIds[oid]) {
      if (!itemsByOrder[oid]) itemsByOrder[oid] = [];
      itemsByOrder[oid].push(it);
    }
  }
  orders.forEach(function(o) {
    o.items = itemsByOrder[o.id] || [];
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
    // Determine table type. Default to 'numbered' for backward compat.
    // 'virtual' = Бар/С собой — visible to all waiters, no isolation
    // 'tab'     = linked to an open client tab (long-running account)
    // 'numbered'= regular numbered table — isolated per waiter
    const tableType = body.table_type || 'numbered';

    // For numbered tables only: check it's not occupied by another waiter
    if (tableType === 'numbered') {
      const existingOrders = readSheet(SHEETS.ORDERS);
      const conflicting = existingOrders.find(function(o) {
        return Number(o.table_number) === Number(body.table_number) &&
               o.status === 'accepted' &&
               (!o.table_type || o.table_type === 'numbered') &&
               o.waiter_id && body.waiter_id &&
               o.waiter_id !== body.waiter_id;
      });
      if (conflicting) {
        throw new Error('Столик №' + body.table_number + ' уже занят другим официантом (' + (conflicting.waiter_name || 'без имени') + ')');
      }
    }

    // For tab orders: verify the tab exists and is open
    if (tableType === 'tab') {
      if (!body.tab_id) throw new Error('Не указан tab_id для заказа на счёт');
      const tabs = readSheet(SHEETS.TABS);
      const tab = tabs.find(function(t) { return t.id === body.tab_id; });
      if (!tab) throw new Error('Счёт не найден');
      if (tab.status !== 'open') throw new Error('Счёт уже закрыт');
    }

    const orderId = genId('ord');
    const now = new Date();
    const items = body.items || [];
    let total = 0;
    items.forEach(function(it) {
      total += (Number(it.price) || 0) * (Number(it.quantity) || 1);
    });

    // Build order row by reading actual headers (column-order-agnostic)
    const sheet = getSheet(SHEETS.ORDERS);
    const orderHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const orderRow = new Array(orderHeaders.length).fill('');
    orderHeaders.forEach(function(h, idx) {
      switch (h) {
        case 'id':                 orderRow[idx] = orderId; break;
        case 'table_number':       orderRow[idx] = body.table_number || ''; break;
        case 'table_type':         orderRow[idx] = tableType; break;
        case 'tab_id':             orderRow[idx] = body.tab_id || ''; break;
        case 'guests':             orderRow[idx] = body.guests || 1; break;
        case 'main_category_id':   orderRow[idx] = body.main_category_id || ''; break;
        case 'main_category_name': orderRow[idx] = body.main_category_name || ''; break;
        case 'status':             orderRow[idx] = 'accepted'; break;
        case 'total':              orderRow[idx] = total; break;
        case 'created_at':         orderRow[idx] = now.toISOString(); break;
        case 'completed_at':       orderRow[idx] = ''; break;
        case 'waiter_note':        orderRow[idx] = body.waiter_note || ''; break;
        case 'waiter_id':          orderRow[idx] = body.waiter_id || ''; break;
        case 'waiter_name':        orderRow[idx] = body.waiter_name || ''; break;
        case 'cook_id':            orderRow[idx] = ''; break;
        case 'cook_name':          orderRow[idx] = ''; break;
        case 'payment_method':     orderRow[idx] = ''; break;
        default:                   orderRow[idx] = ''; break;
      }
    });
    sheet.appendRow(orderRow);

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
          case 'is_served':      row[idx] = false; break;
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
    invalidateAllCaches();
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
    invalidateAllCaches();
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
        case 'is_served':      row[idx] = false; break;
        case 'needs_cooking':  row[idx] = body.needs_cooking === true || body.needs_cooking === 'true'; break;
        case 'created_at':     row[idx] = now.toISOString(); break;
        default:               row[idx] = ''; break;
      }
    });
    itemsSheet.appendRow(row);
    recalcOrderTotal(body.order_id);
    SpreadsheetApp.flush();
    invalidateAllCaches();
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
      invalidateAllCaches();
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
      invalidateAllCaches();
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
      safeDeleteRow(sheet, rowIndex);
      recalcOrderTotal(orderId);
      SpreadsheetApp.flush();
      invalidateAllCaches();
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
      if (String(data[i][idCol]) === String(body.item_id)) {
        data[i][readyCol] = body.is_ready === true || body.is_ready === 'true';
        orderId = data[i][headers.indexOf('order_id')];
        break;
      }
    }
    if (orderId) {
      sheet.getRange(1, 1, data.length, headers.length).setValues(data);
      SpreadsheetApp.flush();
      invalidateAllCaches();
      return getOrder(orderId);
    }
    throw new Error('Item not found');
  } finally {
    lock.releaseLock();
  }
}

/* Toggle "served" status — waiter marks an item as delivered to the table.
 * Works for ALL items (cooking and non-cooking alike). For non-cooking items
 * (water, bread) the waiter can mark them served right away. For cooking
 * items, they should be ready first (but we don't enforce this — the waiter
 * may serve partially). */
function toggleItemServed(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet(SHEETS.ORDER_ITEMS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const servedCol = headers.indexOf('is_served');
    const readyCol = headers.indexOf('is_ready');
    const needsCookingCol = headers.indexOf('needs_cooking');
    if (servedCol < 0) throw new Error('Column "is_served" not found. Run migrate() first.');
    // Check if cook is enabled — if not, waiters can serve anything directly
    const cookEnabled = getSetting('cook_enabled') !== 'false';
    let orderId = null;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === String(body.item_id)) {
        const newServed = body.is_served === true || body.is_served === 'true';
        data[i][servedCol] = newServed;
        // Auto-mark as ready when:
        // 1. Item doesn't need cooking (water, bread) — always
        // 2. Cook is disabled — for any item (waiter serves directly)
        if (newServed && readyCol >= 0) {
          const needsCooking = needsCookingCol >= 0 && (data[i][needsCookingCol] === true || data[i][needsCookingCol] === 'true');
          if (!needsCooking || !cookEnabled) {
            data[i][readyCol] = true;
          }
        }
        orderId = data[i][headers.indexOf('order_id')];
        break;
      }
    }
    if (orderId) {
      sheet.getRange(1, 1, data.length, headers.length).setValues(data);
      SpreadsheetApp.flush();
      invalidateAllCaches();
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
    const targetId = String(body.order_id);

    // Delete order row (compare as strings to avoid type mismatch)
    const ordersData = ordersSheet.getDataRange().getValues();
    const orderHeaders = ordersData[0];
    const orderIdCol = orderHeaders.indexOf('id');
    let orderRow = -1;
    for (let i = 1; i < ordersData.length; i++) {
      if (String(ordersData[i][orderIdCol]) === targetId) {
        orderRow = i + 1;
        break;
      }
    }
    if (orderRow > 0) safeDeleteRow(ordersSheet, orderRow);

    // Delete all items for this order (may be multiple rows).
    // Iterate in reverse so row indices stay valid. Use safeDeleteRow to
    // handle the case where this is the last data row.
    const itemsData = itemsSheet.getDataRange().getValues();
    const itemHeaders = itemsData[0];
    const itemOrderIdCol = itemHeaders.indexOf('order_id');
    // Collect rows to delete (1-indexed) in reverse order
    const rowsToDelete = [];
    for (let i = itemsData.length - 1; i >= 1; i--) {
      if (String(itemsData[i][itemOrderIdCol]) === targetId) {
        rowsToDelete.push(i + 1);
      }
    }
    // Delete in reverse order (already reversed since we iterated backwards)
    rowsToDelete.forEach(function(r) {
      safeDeleteRow(itemsSheet, r);
    });

    SpreadsheetApp.flush();
    invalidateAllCaches();
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
  invalidateAllCaches();
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
  invalidateAllCaches();
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
    safeDeleteRow(sheet, rowIndex);
    SpreadsheetApp.flush();
    invalidateAllCaches();
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
      // name_translation may or may not exist as a column (depends on when setup/migrate ran)
      const ntCol = headers.indexOf('name_translation');
      if (ntCol >= 0) data[i][ntCol] = body.name_translation || '';
      data[i][headers.indexOf('price')] = Number(body.price) || 0;
      data[i][headers.indexOf('needs_cooking')] = body.needs_cooking === true || body.needs_cooking === 'true';
      data[i][headers.indexOf('sort')] = body.sort || 0;
      data[i][headers.indexOf('is_active')] = body.is_active !== false;
      found = true;
      break;
    }
  }
  if (!found) {
    // Build row by header name to be column-order-agnostic.
    // The Menu sheet may have been created with an older setup() that didn't
    // include name_translation (added later by migrate()). Reading headers
    // and writing by name avoids the column-shift bug.
    const headersNow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const row = new Array(headersNow.length).fill('');
    headersNow.forEach(function(h, idx) {
      switch (h) {
        case 'id':               row[idx] = id; break;
        case 'category_id':      row[idx] = body.category_id || ''; break;
        case 'name':             row[idx] = body.name; break;
        case 'name_translation': row[idx] = body.name_translation || ''; break;
        case 'price':            row[idx] = Number(body.price) || 0; break;
        case 'needs_cooking':    row[idx] = body.needs_cooking === true || body.needs_cooking === 'true'; break;
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
  invalidateAllCaches();
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
    safeDeleteRow(sheet, rowIndex);
    SpreadsheetApp.flush();
    invalidateAllCaches();
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
    invalidateAllCaches();
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
    invalidateAllCaches();
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
    invalidateAllCaches();
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
    // Build row by header name (column-order-agnostic)
    const headersNow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const row = new Array(headersNow.length).fill('');
    headersNow.forEach(function(h, idx) {
      switch (h) {
        case 'id':         row[idx] = id; break;
        case 'name':       row[idx] = body.name; break;
        case 'role':       row[idx] = body.role || 'waiter'; break;
        case 'pin':        row[idx] = body.pin || ''; break;
        case 'is_active':  row[idx] = body.is_active !== false; break;
        case 'sort':       row[idx] = body.sort || 0; break;
        case 'created_at': row[idx] = new Date().toISOString(); break;
        default:           row[idx] = ''; break;
      }
    });
    sheet.appendRow(row);
  } else {
    sheet.getRange(1, 1, data.length, headers.length).setValues(data);
  }
  SpreadsheetApp.flush();
  invalidateAllCaches();
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
    safeDeleteRow(sheet, rowIndex);
    SpreadsheetApp.flush();
    invalidateAllCaches();
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
  // Numbered tables (1..N) — isolated per waiter
  for (let i = 1; i <= tableCount; i++) {
    // Only consider numbered-table orders (exclude virtual/tab) when checking
    // occupancy of a numbered table.
    const occ = orders.find(function(o) {
      return Number(o.table_number) === i &&
             (!o.table_type || o.table_type === 'numbered');
    });
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
    tables.push({ table: i, type: 'numbered', status: status, waiter_name: waiterName });
  }
  // Virtual tables (Бар, С собой, etc.) — visible to all waiters, not isolated
  const virtualTablesSetting = getSetting('virtual_tables') || '';
  const virtualNames = virtualTablesSetting.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
  virtualNames.forEach(function(name) {
    // Count active orders for this virtual table name
    const activeCount = orders.filter(function(o) {
      return o.table_type === 'virtual' && o.table_number === name;
    }).length;
    tables.push({
      table: name,
      type: 'virtual',
      status: activeCount > 0 ? 'active' : 'free',
      active_count: activeCount,
      waiter_name: ''  // virtual tables are shared, no single owner
    });
  });
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
// Saves the URL for a sound (e.g. "/sounds/cook_new_order.mp3").
// The client will load the audio directly from this URL.
// Body: { name: 'cook_new_order', url: '/sounds/cook_new_order.mp3' }
function uploadSound(body) {
  if (!body.name || !body.url) throw new Error('Missing name or url');
  const settings = {};
  settings['sound_' + body.name] = body.url;
  // Clean up legacy _mime entries if any
  settings['sound_' + body.name + '_mime'] = '';
  saveSettings({ settings: settings });
  return { ok: true, name: body.name, url: body.url };
}

/**
 * Returns the raw base64-encoded sound for the given name.
 * Used by clients via ?action=getSound&name=cook_new_order
 */
function getSound(name) {
  // Sounds are now stored as URLs (e.g. "/sounds/cook_new_order.mp3") in
  // Settings under key "sound_<name>". The client fetches them directly
  // from the URL — no need to proxy through Apps Script.
  // This endpoint is kept for backward compat — returns the URL as JSON.
  if (!name) return jsonOut({ error: 'Missing name' });
  const key = 'sound_' + name;
  const url = getSetting(key);
  if (!url) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'not found' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService
    .createTextOutput(JSON.stringify({ url: url }))
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
  // Delete in reverse order — use safeDeleteRow to avoid the "last non-frozen row" error
  toDelete.reverse().forEach(function(r) { safeDeleteRow(sheet, r); });
  SpreadsheetApp.flush();
  invalidateAllCaches();
  return { ok: true };
}

/* ============ AUTHENTICATION ============ */

/**
 * Hash a password using SHA-256. Returns a hex string.
 * Salt is the user's id (so identical passwords at different users hash differently).
 */
function hashPassword(userId, password) {
  const raw = (userId || '') + ':' + (password || '');
  const rawBytes = Utilities.newBlob(raw).getBytes();
  const hashed = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, rawBytes);
  return hashed.map(function(b) {
    const v = (b + 256) % 256;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

/**
 * Generate a random session token (64 hex chars).
 */
function generateToken() {
  const bytes = [];
  for (let i = 0; i < 32; i++) bytes.push(Math.floor(Math.random() * 256));
  return bytes.map(function(b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}

/**
 * Login: verify user_id + password, return a session token.
 * Body: { user_id, password }
 * Response: { token, user: {id, name, role}, expires_at }
 */
function doLogin(body) {
  // Clean up expired sessions on each login (keeps the Settings sheet tidy)
  cleanupExpiredSessions();
  if (!body || !body.user_id || !body.password) {
    return jsonOut({ success: false, error: 'Missing user_id or password' });
  }
  const users = readSheet(SHEETS.USERS);
  const user = users.find(function(u) { return u.id === body.user_id && u.is_active !== false; });
  if (!user) {
    return jsonOut({ success: false, error: 'Пользователь не найден' });
  }
  // If user has no password set yet, reject
  // Check if password is set (handle both string and number types — Google
  // Sheets may store "1234" as a number, in which case !user.pin would be
  // true for 0)
  const pinValue = String(user.pin || '');
  if (pinValue.length === 0) {
    return jsonOut({ success: false, error: 'Пароль не установлен. Задайте пароль в колонке pin листа Users.' });
  }
  // For waiters and cooks: enforce numeric-only passwords (PINs)
  // Admin can use any password (letters, symbols, etc.)
  if (user.role !== 'admin') {
    if (!/^\d+$/.test(body.password)) {
      return jsonOut({ success: false, error: 'Пароль должен состоять только из цифр' });
    }
  }
  // Password verification:
  // - If pin is 64 hex chars → it's a SHA-256 hash, compare with hash of entered password
  // - Otherwise → treat pin as plaintext password, compare directly
  // This way admin can either set passwords via the UI (hashed) OR type
  // plaintext passwords directly into the Users sheet (simpler).
  const entered = body.password;
  const stored = String(user.pin);
  const isHex64 = /^[a-f0-9]{64}$/.test(stored);
  let match = false;
  if (isHex64) {
    match = (hashPassword(user.id, entered) === stored);
  } else {
    match = (entered === stored);
  }
  if (!match) {
    return jsonOut({ success: false, error: 'Неверный пароль' });
  }

  // Generate session token
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000); // 12 hours

  // Store session in Settings sheet under key "session_<token>" -> JSON
  const sessionData = {
    token: token,
    user_id: user.id,
    user_name: user.name,
    user_role: user.role,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString()
  };
  const settingsSheet = getSheet(SHEETS.SETTINGS);
  settingsSheet.appendRow(['session_' + token, JSON.stringify(sessionData)]);

  SpreadsheetApp.flush();
  invalidateAllCaches();

  return jsonOut({
    success: true,
    data: {
      token: token,
      user: { id: user.id, name: user.name, role: user.role },
      expires_at: expiresAt.toISOString()
    }
  });
}

/**
 * Verify a session token. Returns the user record (without pin) or null.
 */
function verifyToken(token) {
  if (!token) return null;
  const settings = readSheet(SHEETS.SETTINGS);
  const row = settings.find(function(s) { return s.key === 'session_' + token; });
  if (!row) return null;
  let session;
  try { session = JSON.parse(row.value); } catch (e) { return null; }
  if (!session || !session.expires_at) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    // Expired — clean up
    deleteSession(token);
    return null;
  }
  return session;
}

/**
 * Delete a session token (logout).
 */
function deleteSession(token) {
  if (!token) return;
  const sheet = getSheet(SHEETS.SETTINGS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const keyCol = headers.indexOf('key');
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][keyCol] === 'session_' + token) {
      safeDeleteRow(sheet, i + 1);
    }
  }
  SpreadsheetApp.flush();
  invalidateAllCaches();
}

/**
 * Logout endpoint.
 */
function doLogout(body) {
  if (body && body.token) deleteSession(body.token);
  return { ok: true };
}

/**
 * Set password for a user. Only admin (or the user themselves if they know
 * their current password) can do this. For simplicity, we allow admin to set
 * passwords directly (admin authenticates separately, see admin login).
 * Body: { user_id, new_password, admin_token? }
 */
function setPassword(body) {
  if (!body || !body.user_id) throw new Error('Missing user_id');
  // Verify admin token if provided. If not provided, allow only if target user
  // is admin themselves (bootstrap: admin can set own password without auth).
  if (body.admin_token) {
    const session = verifyToken(body.admin_token);
    if (!session || session.user_role !== 'admin') {
      throw new Error('Недостаточно прав');
    }
  }
  // If no admin_token, only allow setting password for admin user (bootstrap)
  // For other users, admin_token is required.
  const users = readSheet(SHEETS.USERS);
  const targetUser = users.find(function(u) { return u.id === body.user_id; });
  if (!targetUser) throw new Error('User not found');
  if (!body.admin_token && targetUser.role !== 'admin') {
    throw new Error('Недостаточно прав: нужен admin_token');
  }
  const sheet = getSheet(SHEETS.USERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  const pinCol = headers.indexOf('pin');
  if (pinCol < 0) throw new Error('Column "pin" not found in Users sheet. Run migrate() first.');
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === body.user_id) {
      // Allow setting empty password (which disables password login)
      // By default passwords are hashed (SHA-256, salted with user_id).
      // If body.plaintext is true, store the password as-is — this way the
      // admin can read and edit passwords directly in the Users sheet.
      let storedValue = '';
      if (body.new_password) {
        storedValue = body.plaintext ? body.new_password : hashPassword(body.user_id, body.new_password);
      }
      data[i][pinCol] = storedValue;
      sheet.getRange(1, 1, data.length, headers.length).setValues(data);
      SpreadsheetApp.flush();
      invalidateAllCaches();
      return { ok: true };
    }
  }
  throw new Error('User not found');
}

/**
 * Change own password. Body: { user_id, old_password, new_password }
 */
function changePassword(body) {
  if (!body || !body.user_id || !body.new_password) throw new Error('Missing fields');
  const users = readSheet(SHEETS.USERS);
  const user = users.find(function(u) { return u.id === body.user_id; });
  if (!user) throw new Error('User not found');

  // If user already has a password, require old_password to match
  if (user.pin) {
    if (!body.old_password) throw new Error('Введите старый пароль');
    const oldHash = hashPassword(body.user_id, body.old_password);
    if (oldHash !== user.pin) throw new Error('Неверный старый пароль');
  }
  return setPassword({ user_id: body.user_id, new_password: body.new_password });
}

/* ============ TABS (open client accounts) ============ */

/**
 * List all tabs. Optional filter: status ('open' / 'closed' / 'all').
 */
function getTabs(body) {
  // If the Tabs sheet doesn't exist (user deleted it), return empty list
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEETS.TABS)) {
    return { tabs: [] };
  }
  let tabs = readSheet(SHEETS.TABS);
  const status = body && body.status ? body.status : 'open';
  if (status !== 'all') {
    tabs = tabs.filter(function(t) { return t.status === status; });
  }
  // Recalculate total from linked orders (in case orders changed)
  const orders = readSheet(SHEETS.ORDERS).filter(function(o) {
    return o.tab_id && o.status === 'completed';
  });
  tabs.forEach(function(t) {
    const linked = orders.filter(function(o) { return o.tab_id === t.id; });
    const calcTotal = linked.reduce(function(s, o) { return s + (Number(o.total) || 0); }, 0);
    // Use calculated total (more accurate than stored)
    t.total = calcTotal;
    t.orders_count = linked.length;
  });
  // Sort: open first, then by created_at descending
  tabs.sort(function(a, b) {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    return new Date(b.created_at) - new Date(a.created_at);
  });
  return { tabs: tabs };
}

/**
 * Create a new open tab.
 * Body: { name, phone, notes, waiter_id, waiter_name }
 */
function createTab(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const id = genId('tab');
    const now = new Date().toISOString();
    const sheet = getSheet(SHEETS.TABS);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const row = new Array(headers.length).fill('');
    headers.forEach(function(h, idx) {
      switch (h) {
        case 'id':                     row[idx] = id; break;
        case 'name':                   row[idx] = body.name || 'Без имени'; break;
        case 'phone':                  row[idx] = body.phone || ''; break;
        case 'notes':                  row[idx] = body.notes || ''; break;
        case 'total':                  row[idx] = 0; break;
        case 'status':                 row[idx] = 'open'; break;
        case 'created_at':             row[idx] = now; break;
        case 'closed_at':              row[idx] = ''; break;
        case 'created_by_waiter_id':   row[idx] = body.waiter_id || ''; break;
        case 'created_by_waiter_name': row[idx] = body.waiter_name || ''; break;
        default:                       row[idx] = ''; break;
      }
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    invalidateAllCaches();
    return { id: id };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Close a tab (mark as paid). Body: { tab_id, payment_method }
 * All linked orders are marked as 'completed' (they were already, but
 * in case some were still 'accepted' we complete them now).
 */
function closeTab(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!body || !body.tab_id) throw new Error('Missing tab_id');
    const sheet = getSheet(SHEETS.TABS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const statusCol = headers.indexOf('status');
    const closedAtCol = headers.indexOf('closed_at');
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (data[i][idCol] === body.tab_id) {
        data[i][statusCol] = 'closed';
        data[i][closedAtCol] = new Date().toISOString();
        found = true;
        break;
      }
    }
    if (!found) throw new Error('Tab not found');
    sheet.getRange(1, 1, data.length, headers.length).setValues(data);

    // Complete any still-accepted orders for this tab
    const ordersSheet = getSheet(SHEETS.ORDERS);
    const ordersData = ordersSheet.getDataRange().getValues();
    const ordersHeaders = ordersData[0];
    const orderIdCol = ordersHeaders.indexOf('id');
    const orderTabIdCol = ordersHeaders.indexOf('tab_id');
    const orderStatusCol = ordersHeaders.indexOf('status');
    const orderPayCol = ordersHeaders.indexOf('payment_method');
    const orderCompletedCol = ordersHeaders.indexOf('completed_at');
    for (let i = 1; i < ordersData.length; i++) {
      if (ordersData[i][orderTabIdCol] === body.tab_id && ordersData[i][orderStatusCol] === 'accepted') {
        ordersData[i][orderStatusCol] = 'completed';
        ordersData[i][orderCompletedCol] = new Date().toISOString();
        if (orderPayCol >= 0) ordersData[i][orderPayCol] = body.payment_method || '';
      }
    }
    ordersSheet.getRange(1, 1, ordersData.length, ordersHeaders.length).setValues(ordersData);

    SpreadsheetApp.flush();
    invalidateAllCaches();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Get all orders linked to a tab.
 */
function getTabOrders(tabId) {
  const orders = readSheet(SHEETS.ORDERS).filter(function(o) { return o.tab_id === tabId; });
  const items = readSheet(SHEETS.ORDER_ITEMS);
  orders.forEach(function(o) {
    o.items = items.filter(function(it) { return it.order_id === o.id; });
  });
  orders.sort(function(a, b) { return new Date(a.created_at) - new Date(b.created_at); });
  return { orders: orders };
}

/* ============ PAUSE / RESUME ORDER (for virtual tables) ============ */

/**
 * Pause an order. Used for virtual table orders where the client hasn't paid
 * yet but the order should be put on hold (e.g. hotel guest will pay later).
 * Order becomes visible to ALL waiters, can be resumed and added to.
 */
function pauseOrder(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!body || !body.order_id) throw new Error('Missing order_id');
    const sheet = getSheet(SHEETS.ORDERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const statusCol = headers.indexOf('status');
    for (let i = 1; i < data.length; i++) {
      if (data[i][idCol] === body.order_id) {
        // Only accept → paused transition (don't pause completed orders)
        if (data[i][statusCol] !== 'accepted') {
          throw new Error('Можно поставить на паузу только активный заказ (текущий статус: ' + data[i][statusCol] + ')');
        }
        data[i][statusCol] = 'paused';
        sheet.getRange(1, 1, data.length, headers.length).setValues(data);
        SpreadsheetApp.flush();
        invalidateAllCaches();
        return getOrder(body.order_id);
      }
    }
    throw new Error('Order not found');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Resume a paused order — bring it back to 'accepted' so the kitchen can
 * continue preparing and the waiter can add more items.
 */
function resumeOrder(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!body || !body.order_id) throw new Error('Missing order_id');
    const sheet = getSheet(SHEETS.ORDERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const statusCol = headers.indexOf('status');
    for (let i = 1; i < data.length; i++) {
      if (data[i][idCol] === body.order_id) {
        if (data[i][statusCol] !== 'paused') {
          throw new Error('Можно возобновить только приостановленный заказ');
        }
        data[i][statusCol] = 'accepted';
        sheet.getRange(1, 1, data.length, headers.length).setValues(data);
        SpreadsheetApp.flush();
        invalidateAllCaches();
        return getOrder(body.order_id);
      }
    }
    throw new Error('Order not found');
  } finally {
    lock.releaseLock();
  }
}

/* ============ SESSION CLEANUP ============ */
/**
 * Removes expired session entries from the Settings sheet.
 * Sessions are stored as rows with key = "session_<token>" and value = JSON
 * with an expires_at field. This function deletes any session whose
 * expires_at is in the past.
 *
 * Called automatically on each login. Can also be run manually from the
 * Apps Script editor.
 */
function cleanupExpiredSessions() {
  try {
    const sheet = getSheet(SHEETS.SETTINGS);
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return 0;
    const headers = data[0];
    const keyCol = headers.indexOf('key');
    const valCol = headers.indexOf('value');
    if (keyCol < 0 || valCol < 0) return 0;
    const now = Date.now();
    const rowsToDelete = [];
    for (let i = 1; i < data.length; i++) {
      const key = String(data[i][keyCol] || '');
      if (key.indexOf('session_') === 0) {
        try {
          const session = JSON.parse(data[i][valCol]);
          if (session && session.expires_at) {
            if (new Date(session.expires_at).getTime() < now) {
              rowsToDelete.push(i + 1); // 1-indexed row number
            }
          } else {
            // Malformed session — delete it too
            rowsToDelete.push(i + 1);
          }
        } catch (e) {
          // Can't parse — delete
          rowsToDelete.push(i + 1);
        }
      }
    }
    // Delete rows in reverse order (so indices don't shift)
    // Use safeDeleteRow to avoid the "last non-frozen row" error
    rowsToDelete.reverse().forEach(function(r) {
      safeDeleteRow(sheet, r);
    });
    if (rowsToDelete.length > 0) {
      SpreadsheetApp.flush();
      invalidateAllCaches();
    }
    return rowsToDelete.length;
  } catch (e) {
    console.error('cleanupExpiredSessions error:', e);
    return 0;
  }
}

/* ============ SHIFTS (waiter work sessions + cash register) ============ */

function openShift(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!body || !body.waiter_id) throw new Error('Missing waiter_id');
    // Check if waiter already has an open shift
    const shifts = readSheet(SHEETS.SHIFTS);
    const existing = shifts.find(function(s) {
      return s.waiter_id === body.waiter_id && s.status === 'open';
    });
    if (existing) {
      throw new Error('У вас уже открыта смена');
    }
    const id = genId('shift');
    const now = new Date().toISOString();
    const openingCash = Number(getSetting('cash_register')) || 0;
    const sheet = getSheet(SHEETS.SHIFTS);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const row = new Array(headers.length).fill('');
    headers.forEach(function(h, idx) {
      switch (h) {
        case 'id':           row[idx] = id; break;
        case 'waiter_id':    row[idx] = body.waiter_id; break;
        case 'waiter_name':  row[idx] = body.waiter_name || ''; break;
        case 'opened_at':    row[idx] = now; break;
        case 'closed_at':    row[idx] = ''; break;
        case 'opening_cash': row[idx] = openingCash; break;
        case 'orders_count': row[idx] = 0; break;
        case 'guests_count': row[idx] = 0; break;
        case 'cash_total':   row[idx] = 0; break;
        case 'card_total':   row[idx] = 0; break;
        case 'status':       row[idx] = 'open'; break;
        default:             row[idx] = ''; break;
      }
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    invalidateAllCaches();
    return {
      id: id,
      waiter_id: body.waiter_id,
      waiter_name: body.waiter_name || '',
      opened_at: now,
      opening_cash: openingCash,
      status: 'open',
      current_cash: openingCash
    };
  } finally {
    lock.releaseLock();
  }
}

function closeShift(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!body || !body.waiter_id) throw new Error('Missing waiter_id');
    const sheet = getSheet(SHEETS.SHIFTS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const waiterIdCol = headers.indexOf('waiter_id');
    const statusCol = headers.indexOf('status');
    const openedAtCol = headers.indexOf('opened_at');
    const closedAtCol = headers.indexOf('closed_at');
    const cashTotalCol = headers.indexOf('cash_total');
    const cardTotalCol = headers.indexOf('card_total');
    const ordersCountCol = headers.indexOf('orders_count');
    const guestsCountCol = headers.indexOf('guests_count');
    const openingCashCol = headers.indexOf('opening_cash');

    let shiftRow = -1;
    let shiftId = null;
    let openedAt = null;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][waiterIdCol]) === String(body.waiter_id) && data[i][statusCol] === 'open') {
        shiftRow = i + 1;
        shiftId = data[i][0];
        openedAt = data[i][openedAtCol];
        break;
      }
    }
    if (shiftRow < 0) throw new Error('Нет открытой смены');

    // Calculate stats from completed orders by this waiter between openedAt and now
    const orders = readSheet(SHEETS.ORDERS).filter(function(o) {
      return o.waiter_id === body.waiter_id &&
             o.status === 'completed' &&
             o.completed_at &&
             new Date(o.completed_at).getTime() >= new Date(openedAt).getTime();
    });
    let cashTotal = 0, cardTotal = 0, guestsCount = 0;
    orders.forEach(function(o) {
      const total = Number(o.total) || 0;
      if (o.payment_method === 'cash') cashTotal += total;
      else if (o.payment_method === 'card') cardTotal += total;
      guestsCount += Number(o.guests) || 0;
    });

    const now = new Date().toISOString();
    data[shiftRow - 1][closedAtCol] = now;
    data[shiftRow - 1][statusCol] = 'closed';
    data[shiftRow - 1][cashTotalCol] = cashTotal;
    data[shiftRow - 1][cardTotalCol] = cardTotal;
    data[shiftRow - 1][ordersCountCol] = orders.length;
    data[shiftRow - 1][guestsCountCol] = guestsCount;
    sheet.getRange(1, 1, data.length, headers.length).setValues(data);

    // Add cash earnings to the cash register
    const currentCash = Number(getSetting('cash_register')) || 0;
    saveSettings({ settings: { cash_register: String(currentCash + cashTotal) } });

    SpreadsheetApp.flush();
    invalidateAllCaches();

    const openingCash = Number(data[shiftRow - 1][openingCashCol]) || 0;
    return {
      id: shiftId,
      opened_at: openedAt,
      closed_at: now,
      opening_cash: openingCash,
      orders_count: orders.length,
      guests_count: guestsCount,
      cash_total: cashTotal,
      card_total: cardTotal,
      final_cash: openingCash + cashTotal,
      status: 'closed'
    };
  } finally {
    lock.releaseLock();
  }
}

function getActiveShift(params) {
  const waiterId = params.waiter_id;
  if (!waiterId) return { shift: null };
  const shifts = readSheet(SHEETS.SHIFTS);
  const shift = shifts.find(function(s) {
    return s.waiter_id === waiterId && s.status === 'open';
  });
  if (!shift) return { shift: null, current_cash: Number(getSetting('cash_register')) || 0 };
  return {
    shift: shift,
    current_cash: Number(getSetting('cash_register')) || 0,
    cook_enabled: getSetting('cook_enabled') !== 'false'
  };
}

function getShifts(body) {
  let shifts = readSheet(SHEETS.SHIFTS);
  // Filter by waiter_id if provided
  if (body && body.waiter_id) {
    shifts = shifts.filter(function(s) { return s.waiter_id === body.waiter_id; });
  }
  // Filter by status if provided
  if (body && body.status && body.status !== 'all') {
    shifts = shifts.filter(function(s) { return s.status === body.status; });
  }
  // Sort newest first
  shifts.sort(function(a, b) {
    return new Date(b.opened_at) - new Date(a.opened_at);
  });
  return { shifts: shifts };
}
