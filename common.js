/**
 * Common utilities shared by all pages.
 */

/* ---------- API ---------- */
async function apiGet(action, params) {
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set('action', action);
  if (params) {
    Object.keys(params).forEach(function(k) {
      if (params[k] !== undefined && params[k] !== null) {
        url.searchParams.set(k, params[k]);
      }
    });
  }
  const res = await fetch(url.toString(), { method: 'GET' });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'API error');
  return json.data;
}

async function apiPost(action, payload) {
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action: action }, payload))
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'API error');
  return json.data;
}

/* ---------- Format ---------- */
function formatMoney(amount, currency) {
  const n = Number(amount) || 0;
  // Resolve currency: explicit param → APP_DATA.settings.currency → CONFIG default
  let cur = currency;
  if (!cur && typeof APP_DATA !== 'undefined' && APP_DATA && APP_DATA.settings) {
    cur = APP_DATA.settings.currency;
  }
  if (!cur) cur = CONFIG.DEFAULT_CURRENCY;
  // Round to integer if no decimals needed
  const hasDec = (n % 1) !== 0;
  const formatted = hasDec ? n.toFixed(2) : Math.round(n).toString();
  return formatted + ' ' + cur;
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

/* ---------- Data loader ---------- */
// Use var (not let) so APP_DATA is accessible as a global across scripts
// and as a property of window (some code paths check window.APP_DATA).
var APP_DATA = null;
async function loadAppData(force) {
  if (APP_DATA && !force) return APP_DATA;
  APP_DATA = await apiGet('getData');
  return APP_DATA;
}

/* ---------- Toast / notifications ---------- */
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

/* ---------- Sound (simple beep via WebAudio) ---------- */
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
  } catch (e) { /* ignore */ }
}

function notifySound() {
  // Plays the "ready" notification for the waiter.
  // If a custom sound is loaded, uses it; otherwise falls back to beep.
  playCustomSound('waiter_ready', function() {
    beep(880, 150, 0.25);
    setTimeout(function() { beep(1100, 200, 0.25); }, 180);
  });
}

function cookNotifySound() {
  // Plays the "new order" notification for the cook.
  playCustomSound('cook_new_order', function() {
    beep(660, 200, 0.25);
    setTimeout(function() { beep(880, 250, 0.25); }, 220);
  });
}

/* ---------- Custom sounds (loaded from server, cached in memory) ---------- */
const _soundCache = {}; // name -> HTMLAudioElement (or null if not found)

async function preloadSounds(names) {
  // names: ['cook_new_order', 'waiter_ready']
  await Promise.all(names.map(function(n) { return loadSound(n); }));
}

async function loadSound(name) {
  if (_soundCache[name] !== undefined) return _soundCache[name];
  try {
    const url = CONFIG.API_URL + '?action=getSound&name=' + encodeURIComponent(name);
    const res = await fetch(url);
    const json = await res.json();
    if (json && json.data) {
      // Decode base64 into a Blob and create an object URL
      const byteChars = atob(json.data);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: json.mime || 'audio/mp3' });
      const objUrl = URL.createObjectURL(blob);
      const audio = new Audio(objUrl);
      audio.preload = 'auto';
      _soundCache[name] = audio;
      return audio;
    }
  } catch (e) {
    console.warn('Failed to load sound', name, e);
  }
  _soundCache[name] = null;
  return null;
}

function playCustomSound(name, fallback) {
  const audio = _soundCache[name];
  if (audio) {
    try {
      audio.currentTime = 0;
      const p = audio.play();
      if (p && p.catch) {
        p.catch(function() {
          // Autoplay blocked — fall back to beep
          if (fallback) fallback();
        });
      }
    } catch (e) {
      if (fallback) fallback();
    }
  } else if (fallback) {
    fallback();
  }
}

/* ---------- Current user (login) ---------- */
// Session token + user info are stored in localStorage.
// The token is verified by the server on each request (sent as a param).
const USER_STORAGE_KEY = 'restaurant_session';
const OLD_USER_STORAGE_KEY = 'restaurant_current_user'; // legacy key, cleaned up

function getCurrentSession() {
  try {
    // Clean up legacy key from older versions
    if (localStorage.getItem(OLD_USER_STORAGE_KEY)) {
      localStorage.removeItem(OLD_USER_STORAGE_KEY);
    }
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    // Validate structure
    if (!session || !session.user || !session.token) {
      localStorage.removeItem(USER_STORAGE_KEY);
      return null;
    }
    return session;
  } catch (e) {
    try { localStorage.removeItem(USER_STORAGE_KEY); } catch (_) {}
    return null;
  }
}

function getCurrentUser() {
  const session = getCurrentSession();
  return session ? session.user : null;
}

function getCurrentToken() {
  const session = getCurrentSession();
  return session ? session.token : null;
}

function setCurrentSession(session) {
  if (session) {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(USER_STORAGE_KEY);
  }
}

async function logoutUser() {
  const token = getCurrentToken();
  if (token) {
    try { await apiPost('logout', { token: token }); } catch (e) { /* ignore */ }
  }
  setCurrentSession(null);
  location.reload();
}

/* Login: returns session {token, user, expires_at} or throws Error */
async function loginWithPassword(userId, password) {
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'login', user_id: userId, password: password })
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Ошибка входа');
  return json.data;
}

/* ---------- Notifications (system-level, work when tab is hidden) ---------- */
// Uses the Notifications API + a service worker so that alerts fire even when
// the user has switched to another tab/app. On iOS, requires the page to be
// added to Home Screen (PWA mode).
//
// Workflow:
//   1. requestNotificationPermission() — ask user once (returns Promise<boolean>)
//   2. showSystemNotification(title, body, tag) — fires a notification via SW

let _swReady = false;

async function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    _swReady = true;
    console.log('Service Worker registered for notifications');
    return true;
  } catch (err) {
    console.warn('SW registration failed:', err);
    return false;
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch (e) {
    return false;
  }
}

function showSystemNotification(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    if (_swReady && navigator.serviceWorker.controller) {
      // Use service worker so it works when tab is hidden
      navigator.serviceWorker.controller.postMessage({
        type: 'NOTIFY',
        title: title,
        body: body,
        tag: tag || 'restaurant',
        requireInteraction: true,
        vibrate: true
      });
    } else {
      // Fallback: plain Notification (only works when tab is focused)
      new Notification(title, { body: body, tag: tag || 'restaurant', requireInteraction: true });
    }
  } catch (e) {
    console.warn('Notification failed:', e);
  }
}

/* ---------- Dynamic polling intervals ---------- */
// Reads interval (in seconds) from APP_DATA.settings, falls back to CONFIG defaults.
// Returns milliseconds (for use with setInterval).
//
// Settings keys (set in admin UI):
//   poll_interval_waiter — refresh rate for waiter (active orders + ready alerts)
//   poll_interval_cook   — refresh rate for cook (new orders + readiness)
//
// Minimum 5 seconds enforced (to prevent abuse / quota burn).
function getPollInterval(settingKey, configKey) {
  let seconds = null;
  if (typeof APP_DATA !== 'undefined' && APP_DATA && APP_DATA.settings) {
    const v = APP_DATA.settings[settingKey];
    if (v) seconds = Number(v);
  }
  if (!seconds || isNaN(seconds) || seconds < 5) {
    seconds = (CONFIG[configKey] || 15000) / 1000;
  }
  if (seconds < 5) seconds = 5;
  return seconds * 1000;
}

/* ---------- Wake Lock (keep screen awake) ---------- */
// Uses the Screen Wake Lock API to prevent the screen from turning off while
// the page is open. Supported in Chrome/Edge Android (84+), Safari iOS (16.4+).
// On unsupported browsers (older Safari, desktop Firefox without flag) this
// silently does nothing — the page still works, just may sleep normally.
//
// The wake lock is RELEASED when the tab is hidden, minimized, or navigated
// away. We re-acquire it on visibilitychange.
let _wakeLockSentinel = null;

async function requestWakeLock() {
  try {
    if (!('wakeLock' in navigator)) return;
    // Don't request if the page is hidden — would fail
    if (document.visibilityState !== 'visible') return;
    // Don't double-acquire
    if (_wakeLockSentinel !== null) return;
    _wakeLockSentinel = await navigator.wakeLock.request('screen');
    _wakeLockSentinel.addEventListener('release', function() {
      _wakeLockSentinel = null;
    });
    console.log('Wake Lock acquired — screen will stay awake');
  } catch (err) {
    // Not fatal — fall back to normal screen behavior
    console.warn('Wake Lock request failed:', err.message);
  }
}

function releaseWakeLock() {
  if (_wakeLockSentinel !== null) {
    try { _wakeLockSentinel.release(); } catch (e) {}
    _wakeLockSentinel = null;
  }
}

// Re-acquire on visibility change (e.g. user switches back to the tab)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      requestWakeLock();
    }
  });
}

/* ---------- Config check ---------- */
function checkConfig() {
  if (!CONFIG.API_URL || CONFIG.API_URL.indexOf('PASTE_YOUR') === 0) {
    document.body.innerHTML = '' +
      '<div class="config-error">' +
      '<h1>Не настроено подключение</h1>' +
      '<p>Откройте файл <code>config.js</code> и вставьте URL вашего развернутого Google Apps Script Web App.</p>' +
      '<p>Подробная инструкция — в файле <code>README.md</code>.</p>' +
      '</div>';
    return false;
  }
  return true;
}

/* ---------- Button loading state ---------- */
const _loadingButtons = new WeakSet();

/**
 * Wraps an async action with a button loading state.
 * Disables the button, shows a spinner text, runs the action, then restores.
 * Prevents double-clicks (button stays disabled until the action completes).
 *
 * Usage from HTML:
 *   <button onclick="withLoading(this, 'Готово...', () => myAsyncFunc())">Сохранить</button>
 *
 * Or for buttons that already have an onclick handler, you can wrap the call:
 *   onclick="withLoading(this, 'Принимаем...', () => acceptOrder())"
 *
 * If called on a button that's already loading, it's a no-op.
 */
async function withLoading(btn, loadingText, action) {
  if (!btn) return action();
  // If button is disabled (already loading) — ignore the click
  if (btn.disabled) return;
  // Block re-entry by tagging the button
  if (_loadingButtons.has(btn)) return;
  _loadingButtons.add(btn);

  const originalText = btn.innerHTML;
  const originalDisabled = btn.disabled;
  btn.disabled = true;
  btn.classList.add('btn-loading');
  btn.innerHTML = '<span class="btn-spinner"></span> ' + (loadingText || '...');

  // Safety net: re-enable after 30s no matter what
  const safety = setTimeout(function() {
    if (_loadingButtons.has(btn)) {
      _loadingButtons.delete(btn);
      btn.disabled = originalDisabled;
      btn.classList.remove('btn-loading');
      btn.innerHTML = originalText;
    }
  }, 30000);

  try {
    return await action();
  } finally {
    clearTimeout(safety);
    _loadingButtons.delete(btn);
    btn.disabled = originalDisabled;
    btn.classList.remove('btn-loading');
    btn.innerHTML = originalText;
  }
}

/* Simple debounce — prevents a function from being called more than once
   within the given delay. Useful for inputs and rapid clicks. */
function debounce(fn, delay) {
  let t = null;
  return function() {
    const ctx = this, args = arguments;
    if (t) clearTimeout(t);
    t = setTimeout(function() { fn.apply(ctx, args); }, delay);
  };
}

/* ---------- Escape ---------- */
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
