// 地方創生解方島 — 後端 API（Netlify Functions + Netlify Blobs）
// 資料結構（每筆一個 blob，避免同時寫入互相覆蓋）：
//   p/<id>            問題
//   s/<id>            解方
//   v/<solId>/<user>  一張支持票（只存 key）
import { getStore } from "@netlify/blobs";

export const config = { path: "/api/*" };

const AREAS = ["ren", "wen", "di", "chan", "jing"];
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

async function readAll(store, prefix) {
  const { blobs } = await store.list({ prefix });
  const items = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return items.filter(Boolean);
}
async function countPrefix(store, prefix) {
  const { blobs } = await store.list({ prefix });
  return blobs.length;
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
      const [problems, solutions, votes] = await Promise.all([
        readAll(store, "p/"),
        readAll(store, "s/"),
        store.list({ prefix: "v/" }),
      ]);
      const counts = {};
      const mine = [];
      for (const b of votes.blobs) {
        const [, sid, who] = b.key.split("/");
        counts[sid] = (counts[sid] || 0) + 1;
        if (me && who === me) mine.push(sid);
      }
      const pub = ({ author, ...rest }) => ({ ...rest, by: me && author === me ? "me" : "x" });
      return res({
        problems: problems.map(pub),
        solutions: solutions.map(pub),
        counts,
        mine,
        adminEnabled: !!adminPassword(),
      });
    }

    if (req.method !== "POST") return res({ error: "not_found" }, 404);
    if (!me) return res({ error: "no_uid" }, 400);
    const body = await req.json().catch(() => ({}));

    // ---- 老師登入檢查 ----
    if (route === "admin") return res({ ok: isAdmin(body.password), enabled: !!adminPassword() });

    // ---- 插一面問題旗 ----
    if (route === "problem") {
      const area = AREAS.includes(body.area) ? body.area : null;
      const title = clip(body.title, 80);
      if (!area) return res({ error: "bad_area" }, 400);
      if (title.length < 4) return res({ error: "too_short" }, 400);
      if ((await countPrefix(store, "p/")) >= MAX_PROBLEMS) return res({ error: "full" }, 409);
      const p = {
        id: newId(), area, title,
        place: clip(body.place, 40),
        desc: clip(body.desc, 400),
        name: clip(body.name, 20),
        author: me, at: Date.now(),
      };
      await store.setJSON("p/" + p.id, p);
      return res({ ok: true, id: p.id });
    }

    // ---- 提出解方 ----
    if (route === "solution") {
      const pid = clip(body.problemId, 40);
      const text = clip(body.text, 500);
      const uses = Array.isArray(body.uses) ? [...new Set(body.uses.filter((u) => AREAS.includes(u)))] : [];
      if (!pid || !(await store.get("p/" + pid, { type: "json" }))) return res({ error: "not_found" }, 404);
      if (text.length < 10) return res({ error: "too_short" }, 400);
      if (!uses.length) return res({ error: "no_uses" }, 400);
      if ((await countPrefix(store, "s/")) >= MAX_SOLUTIONS) return res({ error: "full" }, 409);
      const s = {
        id: newId(), problemId: pid, text, uses,
        value: clip(body.value, 120),
        name: clip(body.name, 20),
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
