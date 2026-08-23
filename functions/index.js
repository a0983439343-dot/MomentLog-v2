const {
  onSchedule
} = require(
  "firebase-functions/v2/scheduler"
);

const {
  initializeApp
} = require(
  "firebase-admin/app"
);

const {
  getDatabase
} = require(
  "firebase-admin/database"
);

const {
  getMessaging
} = require(
  "firebase-admin/messaging"
);

initializeApp();

const db =
  getDatabase();

const messaging =
  getMessaging();

const TIME_ZONE =
  "Asia/Taipei";

function getTimeParts(date) {

  return Object.fromEntries(
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }
    )
    .formatToParts(date)
    .filter(
      part =>
        part.type !== "literal"
    )
    .map(
      part =>
        [part.type, part.value]
    )
  );
}

function getTarget(
  date
) {

  const parts =
    getTimeParts(date);

  return {
    date:
      `${parts.year}-${parts.month}-${parts.day}`,

    hour:
      parts.hour
  };
}

exports.momentLogReminder =
  onSchedule(
    {
      schedule:
        "every 1 minutes",

      timeZone:
        TIME_ZONE,

      region:
        "asia-east1"
    },

    async () => {

      const now =
        new Date();

      const current =
        getTimeParts(now);

      const minute =
        Number(current.minute);

      let targetDate =
        now;

      let kind =
        "";

      if (
        minute === 0
      ) {

        kind =
          "hour";

      } else if (
        minute === 50
      ) {

        kind =
          "heads-up";

        targetDate =
          new Date(
            now.getTime() +
            10 * 60 * 1000
          );

      } else {

        return null;
      }

      const target =
        getTarget(
          targetDate
        );

      const roomsSnapshot =
        await db
          .ref("rooms")
          .get();

      if (
        !roomsSnapshot.exists()
      ) {

        return null;
      }

      const rooms =
        roomsSnapshot.val() || {};

      const tasks = [];

      for (
        const [
          roomId,
          room
        ]
        of Object.entries(rooms)
      ) {

        if (
          !room ||
          !room.meta ||
          !room.members
        ) {
          continue;
        }

        const members =
          room.members || {};

        const records =
          room.records?.[
            target.date
          ]?.[
            target.hour
          ] || {};

        const settings =
          room.notificationSettings ||
          {};

        for (
          const uid
          of Object.keys(members)
        ) {

          if (
            settings?.[uid]?.enabled !==
            true
          ) {
            continue;
          }

          if (
            records?.[uid]
          ) {
            continue;
          }

          const deliveryRef =
            db.ref(
              [
                "reminderDeliveries",
                roomId,
                kind,
                `${target.date}_${target.hour}`,
                uid
              ].join("/")
            );

          const claim =
            await deliveryRef.transaction(
              currentValue => {

                if (
                  currentValue !== null
                ) {
                  return;
                }

                return {
                  claimedAt:
                    Date.now()
                };
              }
            );

          if (
            !claim.committed
          ) {
            continue;
          }

          const tokenSnapshot =
            await db
              .ref(
                `fcmTokens/${uid}`
              )
              .get();

          if (
            !tokenSnapshot.exists()
          ) {
            continue;
          }

          const tokenMap =
            tokenSnapshot.val() ||
            {};

          const tokens =
            Object.entries(
              tokenMap
            )
            .map(
              ([tokenKey, data]) => ({
                tokenKey,
                token:
                  data?.token || ""
              })
            )
            .filter(
              item =>
                Boolean(item.token)
            );

          if (
            !tokens.length
          ) {
            continue;
          }

          tasks.push(
            sendReminder(
              roomId,
              uid,
              tokens,
              room?.meta?.name ||
                "MomentLog",
              target,
              kind
            )
          );
        }
      }

      await Promise.allSettled(
        tasks
      );

      return null;
    }
  );


async function sendReminder(
  roomId,
  uid,
  tokens,
  roomName,
  target,
  kind
) {

  const title =
    kind === "heads-up"
      ? "⏰ MomentLog 提醒"
      : "🔔 MomentLog 提醒";

  const body =
    kind === "heads-up"
      ? `${roomName}：10 分鐘後 ${target.hour}:00 要記錄了`
      : `${roomName}：現在 ${target.hour}:00，記錄一下吧！`;

  const response =
    await messaging
      .sendEachForMulticast({
        tokens:
          tokens.map(
            item =>
              item.token
          ),

        data: {
          title,
          body,

          roomId,
          date:
            target.date,

          hour:
            target.hour,

          kind,

          tag:
            `${roomId}_${target.date}_${target.hour}_${kind}`
        }
      });

  const invalidUpdates = {};

  response.responses
    .forEach(
      (result, index) => {

        if (
          result.success
        ) {
          return;
        }

        const code =
          result.error?.code;

        if (
          code ===
            "messaging/registration-token-not-registered" ||
          code ===
            "messaging/invalid-registration-token"
        ) {

          invalidUpdates[
            `fcmTokens/${uid}/${tokens[index].tokenKey}`
          ] = null;
        }
      }
    );

  if (
    Object.keys(
      invalidUpdates
    ).length
  ) {

    await db
      .ref()
      .update(
        invalidUpdates
      );
  }
}
