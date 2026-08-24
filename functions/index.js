const {
  onSchedule
} = require(
  "firebase-functions/v2/scheduler"
);

const {
  onValueWritten
} = require(
  "firebase-functions/v2/database"
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

const ADMIN_UID =
  "nJdwA4Heqrbtqdt1atbiOsVi7r23";


function getTimeParts(
  date
){

  return Object.fromEntries(
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          TIME_ZONE,

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",

        hour:
          "2-digit",

        minute:
          "2-digit",

        second:
          "2-digit",

        hourCycle:
          "h23"
      }
    )
      .formatToParts(
        date
      )
      .filter(
        part =>
          part.type !==
          "literal"
      )
      .map(
        part =>
          [
            part.type,
            part.value
          ]
      )
  );

}


function getTarget(
  date
){

  const parts =
    getTimeParts(
      date
    );

  return {

    date:
      `${parts.year}-${parts.month}-${parts.day}`,

    hour:
      parts.hour

  };

}


/* =========================================================
   每小時 MomentLog 提醒
========================================================= */

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
        getTimeParts(
          now
        );

      const minute =
        Number(
          current.minute
        );

      let targetDate =
        now;

      let kind =
        "";

      if(
        minute === 0
      ){

        kind =
          "hour";

      }else if(
        minute === 50
      ){

        kind =
          "heads-up";

        targetDate =
          new Date(
            now.getTime() +
            10 *
            60 *
            1000
          );

      }else{

        return null;

      }


      const target =
        getTarget(
          targetDate
        );


      const roomsSnapshot =
        await db
          .ref(
            "rooms"
          )
          .get();


      if(
        !roomsSnapshot.exists()
      ){

        return null;

      }


      const rooms =
        roomsSnapshot.val() ||
        {};

      const tasks =
        [];


      for(
        const [
          roomId,
          room
        ]
        of Object.entries(
          rooms
        )
      ){

        if(
          !room ||
          !room.meta ||
          !room.members
        ){

          continue;

        }


        const members =
          room.members ||
          {};


        const records =
          room.records?.[
            target.date
          ]?.[
            target.hour
          ] ||
          {};


        const settings =
          room.notificationSettings ||
          {};


        for(
          const uid
          of Object.keys(
            members
          )
        ){

          if(
            settings?.[
              uid
            ]?.enabled !==
            true
          ){

            continue;

          }


          if(
            records?.[uid]
          ){

            continue;

          }


          /*
            先確認 token 存在，
            避免沒有 token 時就先 claim，
            導致之後永遠不再嘗試。
          */

          const tokenSnapshot =
            await db
              .ref(
                `fcmTokens/${uid}`
              )
              .get();


          if(
            !tokenSnapshot.exists()
          ){

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
              (
                [
                  tokenKey,
                  data
                ]
              ) => ({

                tokenKey,

                token:
                  data?.token ||
                  ""

              })
            )
            .filter(
              item =>
                Boolean(
                  item.token
                )
            );


          if(
            !tokens.length
          ){

            continue;

          }


          /*
            用 transaction 防止排程重疊
            時同一個使用者收到重複提醒。

            Cloud Scheduler / Functions
            官方也提醒排程可能重疊執行，
            所以這裡保留 transaction。
          */

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

                if(
                  currentValue !==
                  null
                ){

                  return;

                }


                return {

                  claimedAt:
                    Date.now(),

                  date:
                    target.date,

                  hour:
                    target.hour,

                  kind

                };

              }
            );


          if(
            !claim.committed
          ){

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
              kind,
              deliveryRef
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


/* =========================================================
   發送 Reminder
========================================================= */

async function sendReminder(
  roomId,
  uid,
  tokens,
  roomName,
  target,
  kind,
  deliveryRef
){

  const title =
    kind ===
    "heads-up"

      ? "⏰ MomentLog 提醒"

      : "🔔 MomentLog 提醒";


  const body =
    kind ===
    "heads-up"

      ? `${roomName}：10 分鐘後 ${target.hour}:00 要記錄了`

      : `${roomName}：現在 ${target.hour}:00，記錄一下吧！`;


  try{

    const response =
      await messaging
        .sendEachForMulticast({

          tokens:
            tokens.map(
              item =>
                item.token
            ),

          notification: {

            title,

            body

          },

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


    await cleanupInvalidTokens(
      uid,
      tokens,
      response
    );


    /*
      記錄實際發送結果。
      不刪 reminderDelivery，避免同一次排程重複送。
    */

    await deliveryRef.update({

      sentAt:
        Date.now(),

      successCount:
        response.successCount,

      failureCount:
        response.failureCount

    });


    return response;

  }catch(error){

    console.error(
      "sendReminder failed:",
      {
        roomId,
        uid,
        kind,
        error
      }
    );


    /*
      如果整批發送完全失敗，
      解除 claim，讓下一次排程還有機會重試。
    */

    try{

      await deliveryRef.remove();

    }catch(
      cleanupError
    ){

      console.warn(
        "delivery claim cleanup failed:",
        cleanupError
      );

    }


    throw error;

  }

}


/* =========================================================
   Admin 全站廣播
========================================================= */

exports.momentLogBroadcast =
  onValueWritten(
    {
      ref:
        "/system/broadcast",

      region:
        "asia-east1"
    },

    async event => {

      /*
        onValueWritten 的 event.data
        是 Change：

        event.data.before
        event.data.after
      */

      const before =
        event.data.before;

      const snapshot =
        event.data.after;


      /*
        /system/broadcast 被刪除
        就不發送。
      */

      if(
        !snapshot.exists()
      ){

        return null;

      }


      /*
        如果這次寫入沒有讓內容變化，
        直接忽略。
      */

      if(
        before.exists() &&
        JSON.stringify(
          before.val()
        ) ===
        JSON.stringify(
          snapshot.val()
        )
      ){

        return null;

      }


      const broadcast =
        snapshot.val() ||
        {};


      /*
        Cloud Function 再驗證一次 Admin。
        不能只相信 admin.html。
      */

      if(
        broadcast.senderUid !==
        ADMIN_UID
      ){

        console.error(
          "Rejected broadcast:",
          broadcast.senderUid
        );

        return null;

      }


      const text =
        typeof broadcast.text ===
        "string"

          ? broadcast.text.trim()

          : "";


      if(
        !text
      ){

        console.error(
          "Broadcast text is empty."
        );

        return null;

      }


      const timestamp =
        Number(
          broadcast.timestamp ||
          0
        );


      if(
        !Number.isFinite(
          timestamp
        ) ||
        timestamp <= 0
      ){

        console.error(
          "Broadcast timestamp is invalid."
        );

        return null;

      }


      const title =
        "📢 MomentLog 全站公告";


      /*
        取得所有 FCM token。
      */

      const tokenSnapshot =
        await db
          .ref(
            "fcmTokens"
          )
          .get();


      if(
        !tokenSnapshot.exists()
      ){

        console.log(
          "No FCM tokens found."
        );

        return null;

      }


      const tokenRoot =
        tokenSnapshot.val() ||
        {};


      const tokenRecords =
        [];


      /*
        目前資料格式：

        fcmTokens
          uid
            tokenKey
              token
      */

      for(
        const [
          uid,
          tokenMapValue
        ]
        of Object.entries(
          tokenRoot
        )
      ){

        if(
          !tokenMapValue ||
          typeof tokenMapValue !==
            "object"
        ){

          continue;

        }


        for(
          const [
            tokenKey,
            tokenData
          ]
          of Object.entries(
            tokenMapValue
          )
        ){

          const token =
            tokenData?.token ||
            "";


          if(
            !token
          ){

            continue;

          }


          tokenRecords.push({

            uid,

            tokenKey,

            token

          });

        }

      }


      if(
        !tokenRecords.length
      ){

        console.log(
          "No valid FCM tokens found."
        );

        return null;

      }


      /*
        FCM multicast 每批最多 500 個 token。
      */

      const chunkSize =
        500;


      /*
        使用單一 broadcast timestamp
        作為這次廣播的 tag。
      */

      const broadcastTag =
        `broadcast_${timestamp}`;


      for(
        let start = 0;
        start < tokenRecords.length;
        start += chunkSize
      ){

        const chunk =
          tokenRecords.slice(
            start,
            start + chunkSize
          );


        const response =
          await messaging
            .sendEachForMulticast({

              tokens:
                chunk.map(
                  item =>
                    item.token
                ),

              notification: {

                title,

                body:
                  text

              },

              data: {

                title,

                body:
                  text,

                kind:
                  "broadcast",

                timestamp:
                  String(
                    timestamp
                  ),

                tag:
                  broadcastTag

              }

            });


        const invalidUpdates =
          {};


        response.responses
          .forEach(
            (
              result,
              index
            ) => {

              if(
                result.success
              ){

                return;

              }


              const errorCode =
                result.error?.code;


              if(
                errorCode ===
                  "messaging/registration-token-not-registered" ||

                errorCode ===
                  "messaging/invalid-registration-token"
              ){

                const item =
                  chunk[index];


                invalidUpdates[
                  `fcmTokens/${item.uid}/${item.tokenKey}`
                ] =
                  null;

              }

            }
          );


        if(
          Object.keys(
            invalidUpdates
          ).length
        ){

          await db
            .ref()
            .update(
              invalidUpdates
            );

        }


        console.log(
          "Broadcast batch:",
          {
            start,
            count:
              chunk.length,

            success:
              response.successCount,

            failure:
              response.failureCount
          }
        );

      }


      console.log(
        `Broadcast sent to ${tokenRecords.length} token(s).`
      );


      return null;

    }
  );


/* =========================================================
   共用：清理失效 Token
========================================================= */

async function cleanupInvalidTokens(
  uid,
  tokens,
  response
){

  const invalidUpdates =
    {};


  response.responses
    .forEach(
      (
        result,
        index
      ) => {

        if(
          result.success
        ){

          return;

        }


        const code =
          result.error?.code;


        if(
          code ===
            "messaging/registration-token-not-registered" ||

          code ===
            "messaging/invalid-registration-token"
        ){

          invalidUpdates[
            `fcmTokens/${uid}/${tokens[index].tokenKey}`
          ] =
            null;

        }

      }
    );


  if(
    Object.keys(
      invalidUpdates
    ).length
  ){

    await db
      .ref()
      .update(
        invalidUpdates
      );

  }

}
