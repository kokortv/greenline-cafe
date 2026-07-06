/**
 * CONFIG — PASTE YOUR DEPLOYED GOOGLE APPS SCRIPT WEB APP URL HERE
 *
 * After deploying your Apps Script as a Web App (see README.md),
 * copy the URL (looks like https://script.google.com/macros/s/AKfyc.../exec)
 * and paste it below.
 */
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxmy-3d1hX1K32lPXgkPmuZxt0Xts1Jp_OJxcSg4T0zAIaqUsqBgOJvV7RNsz8aN_qW/exec',

  // Default polling intervals (ms). These are FALLBACKS used only when
  // the corresponding settings are not set in the Google Sheet.
  // Admin can change them in the UI (Settings tab) — those values override
  // these defaults at runtime via getPollInterval() in common.js.
  POLL_ORDERS: 20000,     // waiter fallback (20s)
  POLL_BADGE: 20000,      // waiter fallback (20s)
  POLL_COOK: 10000,       // cook fallback (10s)

  // Default currency symbol if not set in admin settings
  DEFAULT_CURRENCY: '₽'
};

// Make sure we warn if the URL was not set
if (typeof window !== 'undefined' && CONFIG.API_URL.indexOf('PASTE_YOUR') === 0) {
  console.warn('CONFIG.API_URL is not set! Open config.js and paste your Apps Script Web App URL.');
}
