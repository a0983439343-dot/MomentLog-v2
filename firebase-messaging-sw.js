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

messaging.onBackgroundMessage(function(payload) {

  const data =
    payload && payload.data
      ? payload.data
      : {};

  const notification =
    payload && payload.notification
      ? payload.notification
      : {};

  const title =
    data.title ||
    notification.title ||
    "MomentLog";

  const body =
    data.body ||
    notification.body ||
    "該記錄了！";

  const tag =
    data.tag ||
    "momentlog";

  const url =
    data.url ||
    "./";

  self.registration.showNotification(
    title,
    {
      body: body,

      icon: "./icon-192.png",

      badge: "./icon-192.png",

      tag: tag,

      renotify: true,

      data: {
        url: url
      }
    }
  );

});

self.addEventListener(
  "notificationclick",
  function(event) {

    event.notification.close();

    const url =
      event.notification &&
      event.notification.data &&
      event.notification.data.url
        ? event.notification.data.url
        : "./";

    const targetUrl =
      new URL(
        url,
        self.location.origin
      ).href;

    event.waitUntil(

      clients
        .matchAll({
          type: "window",
          includeUncontrolled: true
        })
        .then(
          function(clientList) {

            for (
              const client
              of clientList
            ) {

              if (
                client.url === targetUrl &&
                "focus" in client
              ) {

                return client.focus();

              }

            }

            for (
              const client
              of clientList
            ) {

              if (
                "focus" in client
              ) {

                return client.focus();

              }

            }

            if (
              "openWindow" in clients
            ) {

              return clients.openWindow(
                targetUrl
              );

            }

            return undefined;

          }
        )

    );

  }
);
