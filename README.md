# 小水力發電示範獎勵審查系統

GitHub Pages 前端搭配 Firebase Authentication 與 Realtime Database，提供：

- 三大評分項目、每項五個子項及五級距快速評分。
- 依案件設定不同大項配分，自動計算大項與總分。
- 管理員自由新增委員並產生隨機專屬填報網址。
- 委員評分即時儲存、案件平均、70 分及格判定與排名。
- 管理員可排除特定委員成績後重新計算。
- 管理頁保留 Google 雲端表單備用入口。

## 安全設計

公開儲存庫不包含管理權杖或 Firebase 初始資料檔。存取由 Firebase 匿名驗證、不可猜測的網址權杖及 Realtime Database Rules 共同限制。

## 維護

- 網頁設定：`firebase-config.js`
- 資料庫規則：`database.rules.json`
- 主程式：`app.js`

