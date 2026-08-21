const {onSchedule} = require("firebase-functions/v2/scheduler");
const {initializeApp} = require("firebase-admin/app");
const {getDatabase} = require("firebase-admin/database");
const {getMessaging} = require("firebase-admin/messaging");

initializeApp();

const db = getDatabase();
const messaging = getMessaging();

function parts(date) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date)
      .filter(p => p.type !== "literal")
      .map(p => [p.type, p.value])
  );
}

function targetKey(date) {
  const p = parts(date);
  return {date: `${p.year}-${p.month}-${p.day}`, hour: p.hour};
}

exports.momentLogReminder = onSchedule(
  {schedule: "every 1 minutes", timeZone: "Asia/Taipei", region: "asia-east1"},
  async () => {
    const now = new Date();
    const p = parts(now);
    const minute = Number(p.minute);

    let target;
    let kind;

    if (minute === 0) {
      target = now;
      kind = "hour";
    } else if (minute === 50) {
      target = new Date(now.getTime() + 60 * 60 * 1000);
      kind = "heads-up";
    } else {
      return null;
    }

    const key = targetKey(target);
    const roomsSnap = await db.ref("rooms").get();
    if (!roomsSnap.exists()) return null;

    const rooms = roomsSnap.val() || {};
    const sends = [];

    for (const [roomId, room] of Object.entries(rooms)) {
      const members = room?.members || {};
      const records = room?.records?.[key.date]?.[key.hour] || {};
      const settings = room?.notificationSettings || {};

      for (const uid of Object.keys(members)) {
        if (!settings[uid]?.enabled || records[uid]) continue;

        const claimRef = db.ref(
          `reminderDeliveries/${roomId}/${kind}/${key.date}_${key.hour}/${uid}`
        );

        const claim = await claimRef.transaction(current => {
          if (current !== null) return;
          return {claimedAt: Date.now()};
        });

        if (!claim.committed) continue;

        const tokenSnap = await db.ref(`fcmTokens/${uid}`).get();
        const tokenMap = tokenSnap.val() || {};
        const entries = Object.entries(tokenMap)
          .map(([tokenKey, value]) => ({tokenKey, token: value?.token}))
          .filter(x => x.token);

        if (!entries.length) continue;

        sends.push(sendToUser(
          roomId, uid, entries,
          room?.meta?.name || "MomentLog", key, kind
        ));
      }
    }

    await Promise.allSettled(sends);
    return null;
  }
);

async function sendToUser(roomId, uid, entries, roomName, key, kind) {
  const title = kind === "heads-up"
    ? "MomentLog｜準備記錄"
    : "MomentLog｜該記錄了";

  const body = kind === "heads-up"
    ? `${roomName}：${key.hour}:00 就要記錄了`
    : `${roomName}：現在是 ${key.hour}:00，記得留下這一刻`;

  const response = await messaging.sendEachForMulticast({
    tokens: entries.map(x => x.token),
    data: {
      title,
      body,
      roomId,
      date: key.date,
      hour: key.hour,
      tag: `${roomId}-${key.date}-${key.hour}-${kind}`
    }
  });

  const updates = {};
  response.responses.forEach((result, index) => {
    const code = result.error?.code;
    if (!result.success &&
        (code === "messaging/registration-token-not-registered" ||
         code === "messaging/invalid-registration-token")) {
      updates[`fcmTokens/${uid}/${entries[index].tokenKey}`] = null;
    }
  });

  if (Object.keys(updates).length) {
    await db.ref().update(updates);
  }
}
