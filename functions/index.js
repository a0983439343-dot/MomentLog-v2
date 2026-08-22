const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

const db = getDatabase();
const messaging = getMessaging();

function taipeiParts(date) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(date)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );
}

function getTargetKey(date) {
  const p = taipeiParts(date);

  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: p.hour
  };
}

exports.momentLogReminder = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "Asia/Taipei",
    region: "asia-east1"
  },
  async () => {
    const now = new Date();
    const current = taipeiParts(now);
    const minute = Number(current.minute);

    const roomsSnapshot = await db.ref("rooms").get();

    if (!roomsSnapshot.exists()) {
      return null;
    }

    const rooms = roomsSnapshot.val() || {};
    const jobs = [];

    for (const [roomId, room] of Object.entries(rooms)) {
      const members = room?.members || {};
      const settings = room?.notificationSettings || {};

      for (const uid of Object.keys(members)) {
        const setting = settings[uid];

        if (!setting?.enabled) {
          continue;
        }

        const lead = Math.max(
          0,
          Math.min(
            10,
            Number(setting.minute || 0)
          )
        );

        let target = null;
        let kind = null;

        if (lead === 0 && minute === 0) {
          target = now;
          kind = "hour";
        } else if (
          lead > 0 &&
          minute === 60 - lead
        ) {
          target = new Date(
            now.getTime() + lead * 60 * 1000
          );
          kind = "heads-up";
        } else {
          continue;
        }

        const targetKey = getTargetKey(target);

        const records =
          room?.records?.[targetKey.date]?.[targetKey.hour] || {};

        // 已經完成這個時段的人不需要通知。
        if (records[uid]) {
          continue;
        }

        // 防止相同通知因排程重疊而重複發送。
        const claimRef = db.ref(
          `reminderDeliveries/${roomId}/${kind}/${targetKey.date}_${targetKey.hour}/${uid}`
        );

        const claim = await claimRef.transaction(currentValue => {
          if (currentValue !== null) {
            return;
          }

          return {
            claimedAt: Date.now()
          };
        });

        if (!claim.committed) {
          continue;
        }

        const tokenSnapshot = await db
          .ref(`fcmTokens/${uid}`)
          .get();

        const tokenMap = tokenSnapshot.val() || {};

        const tokens = Object.entries(tokenMap)
          .map(([tokenKey, value]) => ({
            tokenKey,
            token: value?.token
          }))
          .filter(item => Boolean(item.token));

        if (!tokens.length) {
          continue;
        }

        jobs.push(
          sendReminder(
            uid,
            tokens,
            room?.meta?.name || "MomentLog",
            targetKey,
            kind,
            roomId
          )
        );
      }
    }

    await Promise.allSettled(jobs);

    return null;
  }
);

async function sendReminder(
  uid,
  tokens,
  roomName,
  targetKey,
  kind,
  roomId
) {
  const title =
    kind === "heads-up"
      ? "MomentLog｜準備記錄"
      : "MomentLog｜該記錄了";

  const body =
    kind === "heads-up"
      ? `${roomName}：${targetKey.hour}:00 就要記錄了`
      : `${roomName}：現在是 ${targetKey.hour}:00，記得留下這一刻`;

  const response =
    await messaging.sendEachForMulticast({
      tokens: tokens.map(item => item.token),

      data: {
        title,
        body,
        roomId,
        date: targetKey.date,
        hour: targetKey.hour,
        tag:
          `${roomId}-${targetKey.date}-${targetKey.hour}-${kind}`
      }
    });

  const updates = {};

  response.responses.forEach((result, index) => {
    const code = result.error?.code;

    if (
      !result.success &&
      (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      )
    ) {
      updates[
        `fcmTokens/${uid}/${tokens[index].tokenKey}`
      ] = null;
    }
  });

  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
  }
}
