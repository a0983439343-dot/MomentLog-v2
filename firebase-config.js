importScripts(
  "https://www.gstatic.com/firebasejs/12.17.0/firebase-app-compat.js"
);

importScripts(
  "https://www.gstatic.com/firebasejs/12.17.0/firebase-messaging-compat.js"
);

firebase.initializeApp({
  apiKey: "AIzaSyBCMPxNB58yeF5zUxQmSlL_MjSGN8VR7YY",
  authDomain: "momentlog-afcbf.firebaseapp.com",
  databaseURL: "https://momentlog-afcbf-default-rtdb.firebaseio.com",
  projectId: "momentlog-afcbf",
  storageBucket: "momentlog-afcbf.firebasestorage.app",
  messagingSenderId: "585186639693",
  appId: "1:585186639693:web:9161128d29688044950104",
  measurementId: "G-9QP570QV5X"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title =
    payload?.data?.title ||
    payload?.notification?.title ||
    "MomentLog";

  const body =
    payload?.data?.body ||
    payload?.notification?.body ||
    "該記錄了！";

  self.registration.showNotification(
    title,
    {
      body,
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      tag:
        payload?.data?.tag ||
        "momentlog-reminder",
      data: {
        url: "./"
      }
    }
  );
});

self.addEventListener(
  "notificationclick",
  (event) => {

    event.notification.close();

    const targetUrl =
      new URL(
        event.notification?.data?.url || "./",
        self.location.origin
      ).href;

    event.waitUntil(
      clients
        .matchAll({
          type: "window",
          includeUncontrolled: true
        })
        .then((clientList) => {

          for (const client of clientList) {
            if ("focus" in client) {
              return client.focus();
            }
          }

          if ("openWindow" in clients) {
            return clients.openWindow(
              targetUrl
            );
          }

          return undefined;
        })
    );
  }
);
