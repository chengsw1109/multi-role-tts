# 線上預約系統（連動 Google 日曆）

零相依套件的預約模組：訪客挑日期與時段、送出後直接在 Google 日曆建立活動；取消時同步刪除該活動。可用時段會即時扣掉日曆上「已忙碌」的時間，因此你在 Google 日曆手動新增的行程也會自動擋掉預約。

## 啟動

```powershell
npm run booking
```

開啟 <http://localhost:3100>。未設定 Google 憑證時仍可運作，預約只會記錄在 `booking/data/bookings.json`，方便先試流程。

## 設定

把 `booking/.env.example` 複製成專案根目錄的 `.env` 再修改。常用項目：

| 變數 | 說明 | 預設 |
| --- | --- | --- |
| `BOOKING_PORT` | 服務埠號 | `3100` |
| `BOOKING_TIMEZONE` | 營業時間所用時區 | `Asia/Taipei` |
| `BOOKING_SLOT_MINUTES` | 每個時段長度（分鐘） | `30` |
| `BOOKING_BUFFER_MINUTES` | 時段前後保留的緩衝 | `0` |
| `BOOKING_LEAD_MINUTES` | 至少要提前多久預約 | `120` |
| `BOOKING_MAX_DAYS_AHEAD` | 最多可預約幾天內 | `30` |
| `BOOKING_HOURS` | 營業時間 | `1-5:09:00-12:00,13:30-18:00` |
| `GOOGLE_CALENDAR_ID` | 要寫入的日曆 ID | `primary` |

`BOOKING_HOURS` 格式為 `週幾:時段`，週日是 `0`、週六是 `6`；多個時段用逗號、多組設定用分號，例如：

```
BOOKING_HOURS=1-5:09:00-12:00,13:30-18:00; 6:10:00-14:00
```

## 連接 Google 日曆

兩種方式擇一，程式會自動偵測（OAuth 優先）。

### 方式一：OAuth（建議）

個人 Gmail 帳號適用，而且能把預約者自動加為與會者、由 Google 寄出邀請信。

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 建立專案，啟用 **Google Calendar API**。
2. 建立 OAuth 用戶端 ID（類型選「桌面應用程式」），取得 Client ID 與 Client Secret。
3. 用 [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) 或自建流程，以 `https://www.googleapis.com/auth/calendar` 範圍取得 **refresh token**（記得在 Playground 設定中勾選使用自己的用戶端憑證）。
4. 填入 `.env`：

   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REFRESH_TOKEN=...
   GOOGLE_CALENDAR_ID=primary
   ```

### 方式二：服務帳戶

適合公司共用日曆，不需要人工授權。

1. 在同一個專案建立服務帳戶並下載 JSON 金鑰。
2. 在 Google 日曆的「與特定使用者共用」加入該服務帳戶的 email，權限給「變更活動」。
3. 填入 `.env`（私鑰的換行以 `\n` 表示）：

   ```
   GOOGLE_SERVICE_ACCOUNT_EMAIL=bot@專案.iam.gserviceaccount.com
   GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n
   GOOGLE_CALENDAR_ID=你的日曆ID@group.calendar.google.com
   ```

服務帳戶未開啟網域委派時無法邀請與會者，因此預約者的 email 只會寫在活動說明中，不會收到 Google 的邀請信。

## API

| 方法與路徑 | 用途 |
| --- | --- |
| `GET /api/settings` | 取得時段長度、可預約日期範圍、營業日 |
| `GET /api/availability?date=YYYY-MM-DD` | 該日所有時段與是否可預約 |
| `POST /api/bookings` | 建立預約（`date`、`time`、`name`、`email`、`phone`、`note`） |
| `DELETE /api/bookings?id=&token=` | 用預約編號與管理碼取消 |

送出預約時會重新檢查一次時段，避免兩人同時搶同一格。建立成功後回傳的取消連結包含隨機管理碼，只有拿到連結的人能取消。若日曆同步失敗，預約仍會保留在本機並回傳警告，不會讓使用者以為預約失敗。

## 已知限制

- 預約資料存在單一 JSON 檔，適合單一程序執行；要多台機器同時服務需改接資料庫。
- 沒有管理後台與寄信功能；通知信目前依賴 Google 日曆的邀請（OAuth 模式）。
- 沒有身分驗證，取消僅靠管理碼；對外開放前建議加上速率限制與反機器人機制。
