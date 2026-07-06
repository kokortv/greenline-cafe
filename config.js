/**
 * CONFIG — PASTE YOUR DEPLOYED GOOGLE APPS SCRIPT WEB APP URL HERE
 *
 * After deploying your Apps Script as a Web App (see README.md),
 * copy the URL (looks like https://script.google.com/macros/s/AKfyc.../exec)
 * and paste it below.
 */
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxmy-3d1hX1K32lPXgkPmuZxt0Xts1Jp_OJxcSg4T0zAIaqUsqBgOJvV7RNsz8aN_qW/exec',

  // Polling intervals (ms) for real-time updates
  POLL_ORDERS: 3000,      // waiter: order items ready status
  POLL_BADGE: 3000,       // waiter: active orders + ready items refresh
  POLL_COOK: 3000,        // cook: new orders + ready status

  // Default currency symbol if not set in admin settings
  DEFAULT_CURRENCY: '₽'
};

// Make sure we warn if the URL was not set
if (typeof window !== 'undefined' && CONFIG.API_URL.indexOf('PASTE_YOUR') === 0) {
  console.warn('CONFIG.API_URL is not set! Open config.js and paste your Apps Script Web App URL.');
}
