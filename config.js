/**
 * CONFIG — Supabase connection settings
 *
 * 1. Create a project at supabase.com
 * 2. Go to Settings → API
 * 3. Copy "Project URL" and "anon public" key
 * 4. Paste them below
 */
const CONFIG = {
  SUPABASE_URL: 'https://hsqtujhzuiufweqkored.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_DLGWsyPClY2Krat7TGSsZg_9shyCrLh',

  // Polling intervals (ms) — used as fallback if realtime fails
  POLL_ORDERS: 5000,
  POLL_BADGE: 5000,
  POLL_COOK: 5000,

  DEFAULT_CURRENCY: '₽'
};

if (typeof window !== 'undefined' && CONFIG.SUPABASE_URL.indexOf('PASTE_YOUR') === 0) {
  console.warn('CONFIG.SUPABASE_URL is not set! Open config.js and paste your Supabase URL and anon key.');
}
