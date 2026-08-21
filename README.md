# MomentLog

Firebase 多人雲端版。

## 已完成
- Firebase Anonymous Authentication
- Realtime Database 多人房間
- 每位使用者 UID 分層的每小時紀錄
- 今日 / 昨日時間軸
- 六種主題
- Firebase Storage 媒體上傳介面
- Firebase Cloud Messaging Web Push 前端
- Taipei 時區日期與整點
- GitHub Pages / HTTPS 相容

## Firebase
1. Authentication → Sign-in method → Anonymous → Enable
2. Realtime Database → Rules → 貼上 `database.rules.json`
3. Storage → 建立 bucket → Rules → 貼上 `storage.rules`
4. Cloud Messaging → Web Push certificates → 取得 VAPID public key
5. 把 VAPID public key 填到 `index.html`
6. GitHub Pages 必須使用 HTTPS 才能使用 Web FCM。

Cloud Storage 目前需要 Blaze 方案；Cloud Functions 的排程也需要可計費方案。若尚未升級，文字/房間功能可以先測，媒體與後台排程先不要測。

不要把 Firebase Admin service account 私鑰提交到 GitHub。
