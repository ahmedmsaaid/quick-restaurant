// Scripts for firebase-app and firebase-messaging
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// Initialize Firebase App in Service Worker
firebase.initializeApp({
  apiKey: "AIzaSyCN_48C-NUsmB3McZAwpt2CIWF390mFtFg",
  authDomain: "quick-c535b.firebaseapp.com",
  projectId: "quick-c535b",
  storageBucket: "quick-c535b.firebasestorage.app",
  messagingSenderId: "634389575709",
  appId: "1:634389575709:web:8b5132643fd9b838edaef4",
  measurementId: "G-N0CJ0SYPYP"
});

const messaging = firebase.messaging();

// Handle Background Push Messages from FCM
messaging.onBackgroundMessage((payload) => {
  console.log('🔔 [firebase-messaging-sw.js] Received background message:', payload);
  
  const title = payload.notification?.title || payload.data?.title || payload.data?.Title || 'طلب جديد في المطعم!';
  const body = payload.notification?.body || payload.data?.body || payload.data?.Body || 'لديك طلب جديد في القائمة!';
  const icon = payload.notification?.image || payload.data?.icon || 'assets/images/home_logo.png';

  const notificationOptions = {
    body: body,
    icon: icon,
    badge: 'assets/images/home_logo.png',
    data: payload.data || {},
    tag: payload.data?.orderId ? `order-${payload.data.orderId}` : 'quick-notification',
    renotify: true,
    vibrate: [200, 100, 200, 100, 200]
  };

  return self.registration.showNotification(title, notificationOptions);
});

// Handle clicking on desktop push notification
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing window if open
      for (const client of windowClients) {
        if ('focus' in client) {
          client.postMessage({
            type: 'FCM_NOTIFICATION_CLICK',
            data: event.notification.data
          });
          return client.focus();
        }
      }
      // If no window is open, open a new one
      if (clients.openWindow) {
        return clients.openWindow('./index.html');
      }
    })
  );
});
