// 地方創生解方島 — 後端 API（Netlify Functions + Netlify Blobs）
// 資料結構（每筆一個 blob，避免同時寫入互相覆蓋）：
//   p/<id>            問題（area = t1~t8 主題）
//   s/<id>            解方
//   v/<solId>/<user>  一張支持票（只存 key）
//   u/<user>          線上同學的暱稱與位置（45 秒沒更新就不顯示）
import { getStore } from "@netlify/blobs";

export const config = { path: "/api/*" };

const THEMES = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"]; // 問題的 8 個主題
const RES = ["ren", "wen", "di", "chan", "jing"]; // 解方用到的人文地產景
const MAX_PROBLEMS = 500;
const MAX_SOLUTIONS = 3000;

const res = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function adminPassword() {
  try {
    if (globalThis.Netlify?.env?.get) return globalThis.Netlify.env.get("ADMIN_PASSWORD") || "";
  } catch (e) {}
  return process.env.ADMIN_PASSWORD || "";
}
const isAdmin = (pw) => {
  const real = adminPassword();
  return !!real && typeof pw === "string" && pw === real;
};

// 瀏覽器送來的隨機代號只存在學生自己的裝置；伺服器只保存它的雜湊
async function hashId(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("jiefang-island:" + s));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function makeProblem(body, me, at) {
  const area = THEMES.includes(body.area) ? body.area : null;
  const title = clip(body.title, 80);
  if (!area) return { error: "bad_area" };
  if (title.length < 4) return { error: "too_short" };
  return {
    id: newId() + Math.random().toString(36).slice(2, 5), area, title,
    no: clip(body.no, 4),
    place: clip(body.place, 40),
    desc: clip(body.desc, 400),
    name: clip(body.name, 20),
    real: clip(body.real, 30), // 姓名或學號，只有老師看得到
    author: me, at,
  };
}

async function readAll(store, prefix) {
  const { blobs } = await store.list({ prefix });
  const items = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return items.filter(Boolean);
}
async function countPrefix(store, prefix) {
  const { blobs } = await store.list({ prefix });
  return blobs.length;
}
// 資料版本：問題、解方、按讚有變動時就會不同，前端靠它決定要不要重新讀取
async function version(store) {
  const lists = await Promise.all(["p/", "s/", "v/"].map((prefix) => store.list({ prefix })));
  let h = 2166136261;
  for (const l of lists) for (const b of l.blobs) for (let i = 0; i < b.key.length; i++) h = Math.imul(h ^ b.key.charCodeAt(i), 16777619);
  return lists.map((l) => l.blobs.length).join(".") + "." + (h >>> 0).toString(36);
}
async function deleteVotes(store, solId) {
  const { blobs } = await store.list({ prefix: "v/" + solId + "/" });
  await Promise.all(blobs.map((b) => store.delete(b.key)));
}

export default async (req) => {
  const store = getStore({ name: "jiefang-island", consistency: "strong" });
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const uid = clip(req.headers.get("x-uid"), 64);
  const me = uid.length >= 16 ? await hashId(uid) : null;

  try {
    // ---- 讀取整座島 ----
    if (req.method === "GET" && route === "state") {
      const [problems, solutions, votes, ver] = await Promise.all([
        readAll(store, "p/"),
        readAll(store, "s/"),
        store.list({ prefix: "v/" }),
        version(store),
      ]);
      const counts = {};
      const mine = [];
      for (const b of votes.blobs) {
        const [, sid, who] = b.key.split("/");
        counts[sid] = (counts[sid] || 0) + 1;
        if (me && who === me) mine.push(sid);
      }
      const pub = ({ author, real, ...rest }) => ({ ...rest, by: me && author === me ? "me" : "x" });
      return res({
        problems: problems.map(pub),
        solutions: solutions.map(pub),
        counts,
        mine,
        adminEnabled: !!adminPassword(),
        ver,
      });
    }

    if (req.method !== "POST") return res({ error: "not_found" }, 404);
    if (!me) return res({ error: "no_uid" }, 400);
    const body = await req.json().catch(() => ({}));

    // ---- 線上同學：回報自己的位置，取得其他人的位置與資料版本 ----
    if (route === "presence") {
      const x = Number(body.x), y = Number(body.y), d = Number(body.d) || 0;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        await store.setJSON("u/" + me, {
          k: me.slice(0, 10),
          name: clip(body.name, 20) || "同學",
          x: Math.round(x), y: Math.round(y), d: Math.round(d * 100) / 100,
          at: Date.now(),
        });
      }
      const [{ blobs }, ver] = await Promise.all([store.list({ prefix: "u/" }), version(store)]);
      const now = Date.now();
      const rows = await Promise.all(
        blobs.filter((b) => b.key !== "u/" + me).map((b) => store.get(b.key, { type: "json" }).then((v) => [b.key, v]))
      );
      const players = [];
      for (const [key, v] of rows) {
        if (!v) continue;
        if (now - v.at < 45000) { if (players.length < 80) players.push({ k: v.k, name: v.name, x: v.x, y: v.y, d: v.d }); }
        else if (now - v.at > 3600000) store.delete(key).catch(() => {});
      }
      return res({ ok: true, players, ver });
    }

    // ---- 老師登入檢查 ----
    if (route === "admin") return res({ ok: isAdmin(body.password), enabled: !!adminPassword() });

    // ---- 插一面問題旗 ----
    if (route === "problem") {
      const p = makeProblem(body, me, Date.now());
      if (p.error) return res({ error: p.error }, 400);
      if ((await countPrefix(store, "p/")) >= MAX_PROBLEMS) return res({ error: "full" }, 409);
      await store.setJSON("p/" + p.id, p);
      return res({ ok: true, id: p.id });
    }

    // ---- 老師批次匯入 ----
    if (route === "import") {
      if (!isAdmin(body.password)) return res({ error: "forbidden" }, 403);
      const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
      const now = Date.now();
      const list = items.map((it, i) => makeProblem(it, me, now + i));
      if (!list.length || list.some((p) => p.error)) return res({ error: "bad_area" }, 400);
      if ((await countPrefix(store, "p/")) + list.length > MAX_PROBLEMS) return res({ error: "full" }, 409);
      for (const p of list) await store.setJSON("p/" + p.id, p);
      return res({ ok: true, count: list.length });
    }

    // ---- 老師：學生解方紀錄（評分用） ----
    if (route === "roster") {
      if (!isAdmin(body.password)) return res({ error: "forbidden" }, 403);
      const [problems, solutions, votes] = await Promise.all([readAll(store, "p/"), readAll(store, "s/"), store.list({ prefix: "v/" })]);
      const counts = {};
      for (const b of votes.blobs) { const sid = b.key.split("/")[1]; counts[sid] = (counts[sid] || 0) + 1; }
      return res({
        problems: problems.map((p) => ({ id: p.id, no: p.no || "", title: p.title, area: p.area })),
        solutions: solutions.map((s) => ({
          id: s.id, problemId: s.problemId, text: s.text, uses: s.uses || [],
          name: s.name || "", real: s.real || "", ak: String(s.author || "").slice(0, 6),
          at: s.at, votes: counts[s.id] || 0,
        })),
      });
    }

    // ---- 老師清空整座島 ----
    if (route === "reset") {
      if (!isAdmin(body.password)) return res({ error: "forbidden" }, 403);
      for (const prefix of ["v/", "s/", "p/", "u/"]) {
        const { blobs } = await store.list({ prefix });
        for (const b of blobs) await store.delete(b.key);
      }
      return res({ ok: true });
    }

    // ---- 提出解方 ----
    if (route === "solution") {
      const pid = clip(body.problemId, 40);
      const text = clip(body.text, 500);
      const uses = Array.isArray(body.uses) ? [...new Set(body.uses.filter((u) => RES.includes(u)))] : [];
      if (!pid || !(await store.get("p/" + pid, { type: "json" }))) return res({ error: "not_found" }, 404);
      if (text.length < 10) return res({ error: "too_short" }, 400);
      if (!uses.length) return res({ error: "no_uses" }, 400);
      if ((await countPrefix(store, "s/")) >= MAX_SOLUTIONS) return res({ error: "full" }, 409);
      const s = {
        id: newId(), problemId: pid, text, uses,
        name: clip(body.name, 20),
        real: clip(body.real, 30), // 姓名或學號，只有老師看得到
        author: me, at: Date.now(),
      };
      await store.setJSON("s/" + s.id, s);
      return res({ ok: true, id: s.id });
    }

    // ---- 按讚 / 取消 ----
    if (route === "vote") {
      const sid = clip(body.solId, 40);
      if (!sid || !(await store.get("s/" + sid, { type: "json" }))) return res({ error: "not_found" }, 404);
      const key = "v/" + sid + "/" + me;
      if (body.on) await store.set(key, "1");
      else await store.delete(key);
      return res({ ok: true });
    }

    // ---- 刪除（老師，或作者本人） ----
    if (route === "delete") {
      const kind = body.kind === "p" ? "p" : body.kind === "s" ? "s" : null;
      const id = clip(body.id, 40);
      if (!kind || !id) return res({ error: "bad_request" }, 400);
      const item = await store.get(kind + "/" + id, { type: "json" });
      if (!item) return res({ ok: true });
      if (!isAdmin(body.password) && item.author !== me) return res({ error: "forbidden" }, 403);
      if (kind === "s") {
        await deleteVotes(store, id);
        await store.delete("s/" + id);
      } else {
        const sols = (await readAll(store, "s/")).filter((s) => s.problemId === id);
        for (const s of sols) {
          await deleteVotes(store, s.id);
          await store.delete("s/" + s.id);
        }
        await store.delete("p/" + id);
      }
      return res({ ok: true });
    }

    return res({ error: "not_found" }, 404);
  } catch (e) {
    console.error(e);
    return res({ error: "server" }, 500);
  }
};
