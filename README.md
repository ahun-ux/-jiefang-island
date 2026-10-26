# 地方創生解方島（Netlify 版）

學生打開網址就能在島上插問題旗、提出解方、互相按讚，不用註冊或登入。老師用一組密碼登入後台，可以批次匯入問題、刪除任何內容、複製全部結果。

## 檔案

```
public/index.html            島嶼遊戲畫面
netlify/functions/api.mjs    後端：讀寫問題、解方、按讚
netlify.toml                 告訴 Netlify 網頁和後端放在哪
package.json                 後端用到的套件（@netlify/blobs）
```

資料存在 Netlify 內建的 Netlify Blobs，不需要另外申請資料庫。

## 部署方式

> 注意：Netlify 的「拖曳資料夾上傳」只會放上靜態網頁，後端不會運作，島上會顯示「連不上島嶼伺服器」。請用下面兩種方式之一。

### 方式一：透過 GitHub（不用打指令）

1. 到 GitHub 建立一個新的 repository，把這個資料夾裡的所有檔案上傳（保留資料夾結構）。
2. 登入 Netlify，新增一個專案，選擇「從 Git 匯入」，連結剛剛的 repository。
3. 建置設定會自動讀取 `netlify.toml`，不用改，直接部署。
4. 到網站設定的 **Environment variables**，新增：
   - Key：`ADMIN_PASSWORD`
   - Value：你自己訂的老師密碼
5. 回到 Deploys，重新部署一次，讓密碼生效。

之後只要在 GitHub 改檔案，Netlify 會自動更新網站。

### 方式二：用 Netlify CLI（會打指令的話最快）

```bash
npm install -g netlify-cli
cd jiefang-island-netlify
npm install
netlify login
netlify init            # 建立新網站
netlify env:set ADMIN_PASSWORD 你的密碼
netlify deploy --prod
```

本機測試：`netlify dev`，打開它顯示的網址。

## 上課怎麼用

1. 打開網站，按右上角「老師」，輸入密碼登入。
2. 在「老師後台」貼上學生盤點出的問題，一行一個：
   ```
   產｜後壁區｜稻米收購價低，年輕人不願接手農地｜訪談三戶農家都說沒有接班人
   景｜後壁區｜車站前老街店面一半拉下鐵門
   人｜｜長照據點志工平均年齡超過 70 歲
   ```
   面向填「人、文、地、產、景」其中一字；地點和補充說明可以留空。
3. 把網址（或 QR code）給學生。他們點旗子就能提出解方。
4. 課後在老師後台按「複製全部問題與解方」，貼到文件裡整理。

## 小提醒

- 學生的身分只是瀏覽器裡的一個隨機代號，換手機或清除瀏覽紀錄後，就不能刪自己先前寫的內容（老師仍然可以刪）。
- 網址是公開的，拿到網址的人都能留言。如果擔心外人亂寫，上課結束後可以到 Netlify 暫停網站，或改用新的網址。
- 上限：500 個問題、3000 個解方。
- 島上畫面每 12 秒自動更新一次，送出或按讚後會立即更新。
