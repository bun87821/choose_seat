# 員工旅遊自助選位

兩個獨立分頁，共用同一個網站與資料庫：

| 路徑 | 用途 |
| --- | --- |
| `/` | 新莊棒球場 B1、B2 區共 71 席劃位 |
| `/lunch` | 0807 午餐（饗 A JOY）194 位座位選位＋停車折抵車號登記 |

兩頁最上方都有分頁切換列，可互相跳轉。

## 棒球賽劃位（`/`）

- B1：12–14 排 4–12 號；15 排 5–12 號；16 排 5–14 號，共 45 席
- B2：14 排 7–12 號；15–16 排 5–14 號，共 26 席
- 可一次選擇多席，支援攜伴
- 確認前提醒座位數須與報名人數相符
- 座位即時同步並防止重複劃位
- 所有人皆可逐席取消座位後重新選位
- 公開座位名單與 CSV 下載
- PostgreSQL 永久保存資料

## 午餐座位（`/lunch`）

依 `0807午餐 鄭婉芃(台積電)194位座位圖` 建立，邏輯與棒球賽劃位相同。

- R 區 25 桌共 108 位、B 區 20 桌共 86 位，合計 45 桌 194 位
- 每桌顯示桌號與可安排人數（座位圖上的米字號數字），桌內位子逐一點選
- 可展開餐廳平面圖（`public/lunch-floorplan.jpg`）對照桌號位置
- **嬰兒座椅**：所有圓桌，加上 R 區中間的 R17、R27、R13、R23 共 22 桌可放嬰兒座椅，桌號旁以 🍼 標記，選位區上方也有說明，座位 CSV 另有「可放嬰兒座椅」欄位
- 一樣可一次選多個位子、即時同步、任何人都能取消後重選
- **停車折抵車號登記**：填姓名＋車號即可登記，名單公開並可下載 CSV 提供給餐廳折抵停車費；車號會自動轉成大寫、去除空白，同一車號不會重複登記
- 桌位資料集中在 `lib/lunch-tables.ts`，前端與 API 共用同一份定義

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
- 座位不綁定瀏覽器；所有使用者都可以取消任一座位後重新選位。

## 專案結構

```text
app/
  api/reservations/route.ts        # 棒球賽劃位 API
  api/lunch-reservations/route.ts  # 午餐選位 API
  api/parking/route.ts             # 停車折抵車號 API
  seat-picker.tsx                  # 棒球賽選位介面
  lunch/page.tsx                   # 午餐分頁
  lunch/lunch-picker.tsx           # 午餐選位與車號登記介面
  globals.css                      # 樣式
lib/
  db.ts                            # PostgreSQL 連線與資料表初始化
  lunch-tables.ts                  # 午餐桌號與每桌人數定義
  plate.ts                         # 車號正規化與格式檢查
public/
  lunch-floorplan.jpg              # 午餐座位平面圖
railway.json                       # Railway 建置與啟動設定
```

資料表（第一次請求時自動建立）：`reservations`、`lunch_reservations`、`parking_plates`。
