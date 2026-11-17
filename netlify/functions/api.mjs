// 解方島・我的島屋 後端
// GET  /api/config                          網站文字（所有人）
// POST /api/login   {name, pin}             回傳這位同學自己的資料（設過密碼就要密碼）
// POST /api/setpin  {name, pin, newPin}     設定或更改 4 位數密碼
// POST /api/save    {name, pin, student}    同學存檔（只開放地方、四象限、解方、預算）
// POST /api/admin   {password, action, ...} 老師後台（需 ADMIN_PASSWORD）
import { getStore } from "@netlify/blobs";
import SEEDS from "./seeds.mjs";

export const config = { path: "/api/*" };

const QK = ["num", "itv", "obs", "beh"];
const CFG_KEYS = ["title", "sub", "welcome", "welcomeSub", "hint", "notFound", "notice"];
const MAX_STUDENTS = 300;
const MAX_HISTORY = 40;
const MAX_FAILS = 5;            // 密碼連續錯幾次就暫停
const LOCK_MS = 5 * 60 * 1000;  // 暫停 5 分鐘

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const norm = (s) => String(s || "").replace(/\s/g, "").replace(/臺/g, "台");
const clip = (s, n) => String(s ?? "").trim().slice(0, n);
const list = (a, n, len) => (Array.isArray(a) ? a : []).map((x) => clip(x, len)).filter(Boolean).slice(0, n);
const safeId = (s) => clip(s, 40).replace(/[^\w-]/g, "");
const validPin = (p) => /^\d{4}$/.test(String(p || ""));

function cleanQuad(q) {
  const quad = {};
  for (const k of QK) quad[k] = list(q && q[k], 40, 600);
  return quad;
}
function cleanTables(ts) {
  return (Array.isArray(ts) ? ts : []).slice(0, 6).map((t) => ({
    title: clip(t && t.title, 60),
    total: clip(t && t.total, 30),
    rows: (Array.isArray(t && t.rows) ? t.rows : []).slice(0, 60).map((x) => ({
      item: clip(x && x.item, 100), unit: clip(x && x.unit, 30), qty: clip(x && x.qty, 30),
      times: clip(x && x.times, 30), sub: clip(x && x.sub, 30),
    })).filter((x) => x.item || x.unit || x.qty || x.times || x.sub),
  }));
}
function cleanStudent(r = {}) {
  return {
    order: Number.isFinite(+r.order) ? +r.order : 0,
    name: clip(r.name, 30),
    place: clip(r.place, 40),
    quad: cleanQuad(r.quad),
    advice: clip(r.advice, 2000),
    note: clip(r.note, 2000),
    ideas: list(r.ideas, 20, 1000),
    tables: cleanTables(r.tables),
    updatedAt: Number(r.updatedAt) || 0,
    updatedBy: r.updatedBy === "student" || r.updatedBy === "teacher" ? r.updatedBy : "",
  };
}
function cleanConfig(c = {}) {
  const o = {};
  for (const k of CFG_KEYS) o[k] = clip(c[k], k === "notice" ? 1000 : 200);
  return o;
}
async function sha(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function loadAll(store) {
  const { blobs } = await store.list({ prefix: "s/" });
  const out = await Promise.all(
    blobs.map(async (b) => {
      const data = await store.get(b.key, { type: "json" });
      return data ? { id: b.key.slice(2), data } : null;
    })
  );
  return out.filter(Boolean).sort((a, b) => (a.data.order || 999) - (b.data.order || 999) || a.id.localeCompare(b.id));
}
async function findByName(store, name) {
  const n = norm(name);
  if (!n) return { all: [], hit: null };
  const all = await loadAll(store);
  return { all, hit: all.find((r) => norm(r.data.name) === n) || null };
}
// 存檔前把舊版本放進修改紀錄
async function pushHistory(store, id, prev, by) {
  if (!prev) return;
  const h = (await store.get("h/" + id, { type: "json" })) || [];
  h.unshift({ at: Date.now(), by, data: prev });
  await store.setJSON("h/" + id, h.slice(0, MAX_HISTORY));
}
function adminPassword() {
  try { if (typeof Netlify !== "undefined" && Netlify.env) { const v = Netlify.env.get("ADMIN_PASSWORD"); if (v) return v; } } catch {}
  return process.env.ADMIN_PASSWORD || "";
}

// 驗證同學的名字與密碼。回傳 {hit} 或 {res: 錯誤回應}
async function authStudent(store, body, { requirePin }) {
  const { all, hit } = await findByName(store, body.name);
  if (!hit) return { res: json({ error: "not_found", empty: all.length === 0 }, 404) };
  const auth = await store.get("p/" + hit.id, { type: "json" });
  if (!auth) {
    if (requirePin) return { res: json({ error: "pin_not_set" }, 403) };
    return { hit, auth: null };
  }
  const fails = (await store.get("f/" + hit.id, { type: "json" })) || { n: 0, until: 0 };
  if (fails.until > Date.now()) return { res: json({ error: "locked", wait: Math.ceil((fails.until - Date.now()) / 60000) }, 429) };
  if (!body.pin) return { res: json({ error: "pin_required" }, 401) };
  if ((await sha(auth.salt + String(body.pin))) !== auth.hash) {
    const n = fails.n + 1;
    await store.setJSON("f/" + hit.id, n >= MAX_FAILS ? { n: 0, until: Date.now() + LOCK_MS } : { n, until: 0 });
    return { res: json({ error: n >= MAX_FAILS ? "locked" : "bad_pin", left: Math.max(0, MAX_FAILS - n), wait: 5 }, n >= MAX_FAILS ? 429 : 401) };
  }
  if (fails.n) await store.delete("f/" + hit.id);
  return { hit, auth };
}
async function setPin(store, id, pin) {
  const salt = crypto.randomUUID();
  await store.setJSON("p/" + id, { salt, hash: await sha(salt + pin), at: Date.now() });
  await store.delete("f/" + id);
}

export default async (req) => {
  const route = new URL(req.url).pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const store = getStore({ name: "jiefang-house", consistency: "strong" });

  try {
    if (req.method === "GET" && route === "config") {
      const c = await store.get("config", { type: "json" });
      return json({ config: c || {} });
    }
    if (req.method !== "POST") return json({ error: "method" }, 405);
    let body = {};
    try { body = await req.json(); } catch {}

    // ---- 同學登島 ----
    if (route === "login") {
      const a = await authStudent(store, body, { requirePin: false });
      if (a.res) return a.res;
      return json({ id: a.hit.id, student: a.hit.data, hasPin: !!a.auth });
    }

    // ---- 設定／更改密碼 ----
    if (route === "setpin") {
      if (!validPin(body.newPin)) return json({ error: "bad_new_pin" }, 400);
      const a = await authStudent(store, body, { requirePin: false });
      if (a.res) return a.res;
      await setPin(store, a.hit.id, String(body.newPin));
      return json({ ok: true });
    }

    // ---- 同學存檔：老師的欄位與姓名保持不變 ----
    if (route === "save") {
      const a = await authStudent(store, body, { requirePin: true });
      if (a.res) return a.res;
      const prev = a.hit.data, s = body.student || {};
      const rec = cleanStudent({
        ...prev,
        place: s.place, quad: s.quad, ideas: s.ideas, tables: s.tables,
        updatedAt: Date.now(), updatedBy: "student",
      });
      await pushHistory(store, a.hit.id, prev, "student");
      await store.setJSON("s/" + a.hit.id, rec);
      return json({ ok: true, id: a.hit.id, student: rec });
    }

    // ---- 老師後台 ----
    if (route === "admin") {
      const pw = adminPassword();
      if (!pw) return json({ error: "no_password" }, 500);
      if (String(body.password || "") !== pw) return json({ error: "forbidden" }, 403);
      const action = body.action;

      if (action === "check") return json({ ok: true });
      if (action === "list") {
        const c = await store.get("config", { type: "json" });
        const all = await loadAll(store);
        const { blobs } = await store.list({ prefix: "p/" });
        const pins = new Set(blobs.map((b) => b.key.slice(2)));
        return json({ students: all.map((r) => ({ ...r, hasPin: pins.has(r.id) })), config: c || {} });
      }
      if (action === "save") {
        const rec = cleanStudent(body.student);
        if (!rec.name) return json({ error: "no_name" }, 400);
        const all = await loadAll(store);
        let id = safeId(body.id);
        if (all.some((r) => r.id !== id && norm(r.data.name) === norm(rec.name))) return json({ error: "duplicate" }, 409);
        const prev = id ? (all.find((r) => r.id === id) || {}).data : null;
        // 老師打開編輯後，同學又存了檔：不要蓋掉同學的新內容
        if (prev && !body.force && (prev.updatedAt || 0) > (Number(body.baseUpdatedAt) || 0)) {
          return json({ error: "conflict", student: prev }, 409);
        }
        if (!id) {
          if (all.length >= MAX_STUDENTS) return json({ error: "full" }, 409);
          id = "s" + Date.now().toString(36);
          if (!rec.order) rec.order = Math.max(0, ...all.map((r) => r.data.order || 0)) + 1;
        }
        rec.updatedAt = Date.now();
        rec.updatedBy = "teacher";
        await pushHistory(store, id, prev, "teacher");
        await store.setJSON("s/" + id, rec);
        return json({ ok: true, id, student: rec });
      }
      if (action === "delete") {
        const id = safeId(body.id);
        if (!id) return json({ error: "bad_id" }, 400);
        const prev = await store.get("s/" + id, { type: "json" });
        await pushHistory(store, id, prev, "teacher");
        await store.delete("s/" + id);
        await store.delete("p/" + id);
        await store.delete("f/" + id);
        return json({ ok: true });
      }
      if (action === "resetpin") {
        const id = safeId(body.id);
        await store.delete("p/" + id);
        await store.delete("f/" + id);
        return json({ ok: true });
      }
      if (action === "history") {
        const id = safeId(body.id);
        return json({ history: (await store.get("h/" + id, { type: "json" })) || [] });
      }
      if (action === "restore") {
        const id = safeId(body.id);
        const h = (await store.get("h/" + id, { type: "json" })) || [];
        const pick = h.find((x) => x.at === Number(body.at));
        if (!pick) return json({ error: "not_found" }, 404);
        const prev = await store.get("s/" + id, { type: "json" });
        const rec = cleanStudent({ ...pick.data, updatedAt: Date.now(), updatedBy: "teacher" });
        await pushHistory(store, id, prev, "teacher");
        await store.setJSON("s/" + id, rec);
        return json({ ok: true, id, student: rec });
      }
      if (action === "config") {
        const c = cleanConfig(body.config);
        await store.setJSON("config", c);
        return json({ ok: true, config: c });
      }
      if (action === "seed") {
        // 只補上還沒有的同學，不覆蓋老師或同學修改過的資料
        const all = await loadAll(store);
        const ids = new Set(all.map((r) => r.id)), names = new Set(all.map((r) => norm(r.data.name)));
        let added = 0;
        for (const [id, rec] of SEEDS) {
          if (ids.has(id) || names.has(norm(rec.name))) continue;
          await store.setJSON("s/" + id, cleanStudent(rec));
          added++;
        }
        return json({ ok: true, added });
      }
      return json({ error: "bad_action" }, 400);
    }
    return json({ error: "not_found" }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: "server" }, 500);
  }
};
