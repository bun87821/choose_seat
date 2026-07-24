# 員工旅遊棒球座位劃位

新莊棒球場 B1、B2 區共 71 席的自助劃位網站，介面類似電影選位。

## 功能

- B1：12–16 排、每排 4–12 號，共 45 席
- B2：14 排 7–12 號；15–16 排 5–14 號，共 26 席
- 可一次選擇多席，支援攜伴
- 確認前提醒座位數須與報名人數相符
- 座位即時同步並防止重複劃位
- 可逐席取消
- 公開座位名單與 CSV 下載
- PostgreSQL 永久保存資料

## 本機執行

需求：Node.js 22+、PostgreSQL。

```bash
cp .env.example .env.local
npm install
npm run dev
```

把 `.env.local` 裡的 `DATABASE_URL` 改成自己的 PostgreSQL 連線字串。資料表會在第一次請求時自動建立，不需手動執行 migration。

## 部署到 Railway

1. 在 GitHub 建立空白 Repository，把本專案推上去。
2. Railway 選擇 **New Project → Deploy from GitHub repo**。
3. 在同一個 Railway Project 新增 **PostgreSQL** service。
4. 到網站 service 的 **Variables**，加入：

   ```text
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   ```

   如果 PostgreSQL service 名稱不是 `Postgres`，請把參照名稱改成實際名稱。
5. 重新部署網站 service。
6. 到 **Settings → Networking → Generate Domain** 取得公開網址。

Railway 會依照 `railway.json` 執行：

```text
npm run build
npm run start
```

## 重要說明

- 原本 ChatGPT Sites 網站的劃位資料不會自動移轉到 Railway。
- 網站會公開姓名、座位與備註，請只把連結提供給預期的使用者。
- 每位使用者的取消權限以瀏覽器內的隨機識別碼判斷；清除瀏覽器資料或換裝置後，無法自行取消原座位。

## 專案結構

```text
app/
  api/reservations/route.ts  # 劃位 API
  seat-picker.tsx            # 選位介面
  globals.css                # 樣式
lib/
  db.ts                      # PostgreSQL 連線與資料表初始化
railway.json                 # Railway 建置與啟動設定
```
