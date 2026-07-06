/**
 * Service Worker for the Restaurant app.
 * Listens for 'push' messages from the page (via postMessage) and shows
 * a system notification even when the page is in the background.
 *
 * IMPORTANT: This service worker only relays messages from the page itself —
 * it does NOT receive push messages from a remote server (that would require
 * VAPID keys and a push service, which Apps Script cannot do directly).
 *
 * What this DOES enable:
 *   - Page calls navigator.serviceWorker.controller.postMessage({...})
 *   - SW receives it and calls self.registration.showNotification()
 *   - Notification appears in the OS even if the browser tab is hidden
 *
 * Limitations:
 *   - Won't fire if the browser itself is closed (only when tab is hidden)
 *   - On iOS requires the page to be installed as a PWA (Add to Home Screen)
 */

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', function(event) {
  const data = event.data || {};
  if (data.type === 'NOTIFY') {
    const title = data.title || 'Уведомление';
    const options = {
      body: data.body || '',
      icon: data.icon || '',
      tag: data.tag || 'restaurant',
      requireInteraction: data.requireInteraction !== false, // keep visible until user dismisses
      vibrate: data.vibrate ? [200, 100, 200] : undefined
    };
    self.registration.showNotification(title, options);
  }
});

// Click on notification → focus the tab
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(function(clientList) {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
