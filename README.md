# 魂魂的掃街地圖

## 部署到 Netlify（約 5 分鐘）

> 注意：Netlify 的「拖曳資料夾上傳」不會建置後端 function，請用下面兩種方式之一。

### 方式 A：GitHub（推薦）
1. 把這個資料夾推到一個 GitHub repo
2. Netlify → Add new project → Import from Git → 選這個 repo（設定全部用預設即可）
3. Project configuration → Environment variables → 新增 `EDIT_PASSWORD` = 你的編輯密碼
4. 重新 Deploy 一次

### 方式 B：Netlify CLI
```
npm install
npx netlify-cli login
npx netlify-cli deploy --prod
```
然後一樣到後台設定 `EDIT_PASSWORD`，再 deploy 一次。

資料存在 Netlify Blobs（免費、免設定）。任何人都能看地圖，只有輸入密碼的人能記錄。

## 修改村里名稱
`mapdata.js` 裡的 `villages` 陣列，改 `name` 即可（改名後舊紀錄會對不上，建議開始記錄前先改好）。
望安的四個小島（西坪、東坪、西吉、東吉）是依地理位置推測的，原圖沒標名字，請自行確認。

## 本機預覽
直接 `python3 -m http.server` 開啟會進入「本機模式」（資料只存在瀏覽器）。

## 3D 版說明
- 拖曳旋轉、滾輪/雙指縮放，點村里會飛過去並插上紅色標記
- 右上角：🌙 日夜切換（晚上掃過的村里會亮燈）、名 顯示名稱、⟲ 回全景
- 掃越多次，村里地塊越高、房子越多
- 使用 Three.js（MIT，已放在 vendor/）與 Google Fonts 的 Huninn 粉圓體
