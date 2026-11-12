// Express app for the DL3 investor CRM: serves the CRM page and a small JSON API.
// The API copies the shape of here.now "Site Data" so the page works with either.
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { researchEnabled, askModel, sanitizeResult, CRITERIA, clip } from "./research.js";
import { askPdf, askWebsite, sanitizeFirms, checkWebsiteUrl, MAX_PDF_BYTES } from "./importer.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(HERE, "../sites/investor-crm");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(SITE_DIR, ".herenow/data.json"), "utf8"));
const MAX_RECORD_BYTES = 16 * 1024;
const ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ID_PATTERN = /^rec_[0-9A-HJKMNP-TV-Z]{26}$/;

export function newId() {
  const bytes = crypto.randomBytes(26);
  let s = "rec_";
  for (const b of bytes) s += ID_ALPHABET[b % 32];
  return s;
}

const COLLECTIONS = Object.keys(MANIFEST.collections); // the only table names that ever reach SQL
const DATE_FIELDS = new Set(["touch_date", "follow_up", "next_date", "last_date", "approval_date", "ai_updated"]);
const CHOICES = { // fixed lists used by the outreach tracker
  interest: ["Committed", "Hot", "Warm", "Lukewarm", "No reply yet", "Passed"],
  direction: ["out", "in", "meeting"],
  channel: ["Email", "Call", "Meeting", "LinkedIn", "Introduction", "Event", "Site visit"]
};

// Check a request body against the manifest's field list for one collection. Returns { data } or { error }.
export function validate(body, { requireName, server = false, collection = "investors" }) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Body must be a JSON object." };
  const fields = MANIFEST.collections[collection].fields;
  const data = {};
  for (const [key, value] of Object.entries(body)) {
    const f = fields[key];
    if (!f || (!server && key.startsWith("ai_"))) return { error: `Unknown field: ${key}` };
    if (f.type === "string") {
      if (typeof value !== "string") return { error: `${key} must be text.` };
      const v = f.trim ? value.trim() : value;
      if (f.maxLength && v.length > f.maxLength) return { error: `${key} is too long (max ${f.maxLength}).` };
      if (DATE_FIELDS.has(key) && !/^(\d{4}-\d{2}-\d{2})?$/.test(v)) return { error: `${key} must be a date like 2026-11-10.` };
      if (CHOICES[key] && !CHOICES[key].includes(v)) return { error: `${key} must be one of: ${CHOICES[key].join(", ")}.` };
      data[key] = v;
    } else if (f.type === "integer" || f.type === "number") {
      const ok = f.type === "integer" ? Number.isInteger(value) : typeof value === "number" && Number.isFinite(value);
      if (!ok) return { error: `${key} must be ${f.type === "integer" ? "a whole number" : "a number"}.` };
      if (f.minimum != null && value < f.minimum) return { error: `${key} must be at least ${f.minimum}.` };
      if (f.maximum != null && value > f.maximum) return { error: `${key} must be at most ${f.maximum}.` };
      data[key] = value;
    } else if (f.type === "boolean") {
      if (typeof value !== "boolean") return { error: `${key} must be true or false.` };
      data[key] = value;
    } else {
      return { error: `Unsupported field type for ${key}.` };
    }
  }
  for (const [key, f] of Object.entries(fields)) {
    if (!f.required) continue;
    if (requireName && !data[key]) return { error: `${key} is required.` };
    if (key in data && !data[key]) return { error: `${key} cannot be empty.` };
  }
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_RECORD_BYTES) return { error: "Record is too large." };
  return { data };
}

// Simple per-IP limiter (in memory). Fine for one small server.
function limiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => { const cut = Date.now() - windowMs; for (const [k, v] of hits) if (v.at < cut) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const rec = hits.get(req.ip);
    if (!rec || now - rec.at > windowMs) hits.set(req.ip, { at: now, n: 1 });
    else if (++rec.n > max) return res.status(429).json({ error: "Too many requests. Please wait and try again." });
    next();
  };
}


// ---- Automatic research -------------------------------------------------------------------
const STALE_MS = 6 * 60 * 1000;
const dailyLimit = () => parseInt(process.env.AI_DAILY_LIMIT, 10) || 40;
const runsToday = async pool => (await pool.query("select count(*)::int as n from research_runs where started_at > now() - interval '24 hours'")).rows[0].n;
const SCORE_FIELDS = CRITERIA.map(c => c[1]);
const TEXT_FIELDS = ["hq", "strategy", "check_size", "website", "linkedin", "contact_email", "sources_text", "deals_text"];

async function setData(pool, id, patch) {
  const v = validate(patch, { requireName: false, server: true });
  if (v.error) throw new Error("internal: " + v.error);
  await pool.query("update investors set data = data || $2::jsonb, updated_at = now() where id = $1", [id, v.data]);
}

// Runs in the background after the request has been answered. Never overwrites what a person typed.
export async function runResearchJob(pool, id, name) {
  try {
    const { text, urls } = await askModel(name);
    const { data } = sanitizeResult(text, urls);
    const { rows } = await pool.query("select data from investors where id = $1", [id]);
    if (!rows.length) return;
    const cur = rows[0].data;
    const patch = { ai_status: "done", ai_updated: data.ai_updated, ai_missing: data.ai_missing };
    let summary = data.ai_summary;
    for (const f of TEXT_FIELDS) if (!cur[f] && data[f]) patch[f] = data[f];
    if (SCORE_FIELDS.some(f => cur[f] > 0)) summary += "\nNote: scores were already set by a person, so the AI scores above were not applied.";
    else for (const f of SCORE_FIELDS) patch[f] = data[f];
    if (data.type && data.type !== cur.type) summary += `\nNote: the AI suggests the investor type may be ${data.type}.`;
    patch.ai_summary = summary.slice(0, 2000);
    await setData(pool, id, patch);
  } catch (e) {
    console.error("research failed:", e.message);
    const msg = typeof e.status === "number" ? `The AI service returned an error (code ${e.status}).` : /^The AI /.test(e.message) ? e.message : "Research could not be completed.";
    try { await setData(pool, id, { ai_status: "failed", ai_missing: `Research failed: ${msg} Try again later or fill the details in by hand.` }); } catch (e2) { console.error("could not record failure:", e2.message); }
  }
}

// ---- Import from a PDF or web page ----------------------------------------------------------
// Runs in the background. Creates one "pending" investor per firm; nothing is scored here.
export async function runImportJob(pool, jobId, { kind, label, sourceUrl, read }) {
  try {
    const text = await read();
    const existing = (await pool.query("select data->>'name' as n from investors")).rows.map(r => r.n);
    const out = sanitizeFirms(text, existing, { label, sourceUrl, kind });
    const db = await pool.connect();
    const created = [];
    try {
      await db.query("begin");
      for (const rec of out.records) {
        const v = validate(rec, { requireName: true, server: true });
        if (v.error) continue;
        const id = newId();
        await db.query("insert into investors (id, data) values ($1, $2)", [id, v.data]);
        created.push({ id, name: v.data.name });
      }
      await db.query("commit");
    } catch (e) { await db.query("rollback").catch(() => {}); throw e; } finally { db.release(); }
    const result = { created, skippedDuplicates: out.skippedDuplicates, skippedIndividuals: out.skippedIndividuals, leftOver: out.leftOver };
    await pool.query("update imports set status = 'done', result = $2 where id = $1", [jobId, result]);
  } catch (e) {
    console.error("import failed:", e.message);
    const msg = typeof e.status === "number" ? `The AI service returned an error (code ${e.status}).` : /^The AI /.test(e.message) ? e.message : "The import could not be completed.";
    await pool.query("update imports set status = 'failed', error = $2 where id = $1", [jobId, msg]).catch(e2 => console.error("could not record failure:", e2.message));
  }
}

async function startImport(pool, res, { kind, label, sourceUrl, read }) {
  if (!researchEnabled()) return res.status(503).json({ error: "Importing is not set up yet." });
  if (await runsToday(pool) >= dailyLimit()) return res.status(429).json({ error: "The daily limit has been reached. Try again tomorrow." });
  await pool.query("insert into research_runs default values");
  const id = crypto.randomUUID();
  await pool.query("insert into imports (id, status, kind, label) values ($1, 'running', $2, $3)", [id, kind, label]);
  res.status(202).json({ id });
  runImportJob(pool, id, { kind, label, sourceUrl, read }).catch(e => console.error("import job crashed:", e.message));
}

const row = r => ({ id: r.id, data: r.data, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() });

export function createApp(pool) {
  const app = express();
  app.set("trust proxy", 1); // Render puts one proxy in front of the app
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY" });
    next();
  });
  app.use(express.json({ limit: "32kb" }));

  // The CRM page. It is the same file used on here.now, with the API address added.
  const pageHtml = fs.readFileSync(path.join(SITE_DIR, "index.html"), "utf8")
    .replace("<script>", '<script>window.INVESTORS_API="/api/investors";</script>\n<script>');
  app.get("/", (req, res) => res.type("html").send(pageHtml));
  const trackerJs = fs.readFileSync(path.join(SITE_DIR, "tracker.js"), "utf8");
  app.get("/tracker.js", (req, res) => res.type("application/javascript").set("Cache-Control", "no-cache").send(trackerJs));
  const logoPng = fs.readFileSync(path.join(SITE_DIR, "dl3-logo.png"));
  app.get("/dl3-logo.png", (req, res) => res.type("image/png").set("Cache-Control", "no-cache").send(logoPng));
  app.get("/favicon.ico", (req, res) => res.status(204).end());
  app.get("/healthz", async (req, res) => {
    try { await pool.query("select 1"); res.type("text").send("ok"); } catch { res.status(503).type("text").send("database unavailable"); }
  });

  const reads = limiter({ windowMs: 3600_000, max: 1200 });

  const researchLimit = limiter({ windowMs: 3600_000, max: 10 });
  app.get("/api/research/status", reads, async (req, res) => {
    res.json({ enabled: researchEnabled(), remainingToday: Math.max(0, dailyLimit() - await runsToday(pool)) });
  });
  app.post("/api/investors/:id/research", researchLimit, async (req, res) => {
    if (!researchEnabled()) return res.status(503).json({ error: "AI research is not set up yet." });
    if (!ID_PATTERN.test(req.params.id)) return res.status(404).json({ error: "Not found." });
    const { rows } = await pool.query("select data from investors where id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    const cur = rows[0].data;
    if (cur.review_status !== "pending") return res.status(409).json({ error: "Only investors waiting for review can be researched. Confirmed records are not changed by the AI." });
    if (cur.ai_status === "running" && Date.now() - Date.parse(cur.ai_started || 0) < STALE_MS) return res.status(409).json({ error: "Research is already running for this investor." });
    if (await runsToday(pool) >= dailyLimit()) return res.status(429).json({ error: "The daily research limit has been reached. Try again tomorrow." });
    await pool.query("insert into research_runs default values");
    await setData(pool, req.params.id, { ai_status: "running", ai_started: new Date().toISOString() });
    res.status(202).json({ status: "running" });
    runResearchJob(pool, req.params.id, String(cur.name || "")).catch(e => console.error("research job crashed:", e.message));
  });


  const importLimit = limiter({ windowMs: 3600_000, max: parseInt(process.env.IMPORT_HOURLY_LIMIT, 10) || 6 });
  app.post("/api/import/pdf", importLimit, express.raw({ type: "application/pdf", limit: MAX_PDF_BYTES }), async (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 8 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") return res.status(400).json({ error: "Please send a PDF file." });
    let name = "document.pdf";
    try { name = clip(decodeURIComponent(String(req.get("x-filename") || "")).split(/[\\/]/).pop(), 80) || name; } catch { /* keep default */ }
    await startImport(pool, res, { kind: "PDF", label: name, sourceUrl: "", read: () => askPdf(buf) });
  });
  app.post("/api/import/website", importLimit, async (req, res) => {
    const url = checkWebsiteUrl(req.body && req.body.url);
    if (!url) return res.status(400).json({ error: "Please give a full web address starting with https://." });
    await startImport(pool, res, { kind: "website", label: clip(url, 80), sourceUrl: url, read: () => askWebsite(url) });
  });
  app.get("/api/import/:id", reads, async (req, res) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.status(404).json({ error: "Not found." });
    const { rows } = await pool.query("select status, kind, label, result, error from imports where id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    res.json(rows[0]);
  });

  // One set of routes per collection in the manifest (investors, outreach, projects).
  // The table name comes from that fixed list, never from the request.
  for (const col of COLLECTIONS) {
    const writeMax = col === "investors" ? 300 : parseInt((/^(\d+)\/hour\/ip$/.exec(MANIFEST.collections[col].rateLimit || "") || [])[1], 10) || 300;
    const colWrites = limiter({ windowMs: 3600_000, max: writeMax });

    app.get(`/api/${col}`, reads, async (req, res) => {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
      let after = null;
      if (req.query.cursor) {
        try { const [t, id] = Buffer.from(String(req.query.cursor), "base64url").toString().split("|"); after = { t, id }; if (!t || !ID_PATTERN.test(id)) throw 0; }
        catch { return res.status(400).json({ error: "Bad cursor." }); }
      }
      const params = after ? [after.t, after.id, limit + 1] : [limit + 1];
      const where = after ? "where (created_at, id) > ($1::timestamptz, $2)" : "";
      const { rows } = await pool.query(`select id, data, created_at, updated_at, created_at::text as created_text from ${col} ${where} order by created_at, id limit $${params.length}`, params);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const nextCursor = rows.length > limit ? Buffer.from(`${last.created_text}|${last.id}`).toString("base64url") : null;
      res.json({ records: page.map(row), nextCursor });
    });

    app.get(`/api/${col}/:id`, reads, async (req, res) => {
      if (!ID_PATTERN.test(req.params.id)) return res.status(404).json({ error: "Not found." });
      const { rows } = await pool.query(`select id, data, created_at, updated_at from ${col} where id = $1`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "Not found." });
      res.json({ record: row(rows[0]) });
    });

    app.post(`/api/${col}`, colWrites, async (req, res) => {
      const v = validate(req.body, { requireName: true, collection: col });
      if (v.error) return res.status(400).json({ error: v.error });
      const { rows } = await pool.query(`insert into ${col} (id, data) values ($1, $2) returning id, data, created_at, updated_at`, [newId(), v.data]);
      res.status(201).json({ record: row(rows[0]) });
    });

    app.patch(`/api/${col}/:id`, colWrites, async (req, res) => {
      if (!ID_PATTERN.test(req.params.id)) return res.status(404).json({ error: "Not found." });
      const v = validate(req.body, { requireName: false, collection: col });
      if (v.error) return res.status(400).json({ error: v.error });
      const { rows } = await pool.query(`update ${col} set data = data || $2::jsonb, updated_at = now() where id = $1 returning id, data, created_at, updated_at`, [req.params.id, v.data]);
      if (!rows.length) return res.status(404).json({ error: "Not found." });
      res.json({ record: row(rows[0]) });
    });
  }

  app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));
  app.use((req, res) => res.status(404).type("text").send("Not found"));
  app.use((err, req, res, next) => { // never echo internal details to the browser
    console.error("request failed:", err.message);
    if (res.headersSent) return next(err);
    if (err.type === "entity.too.large") return res.status(413).json({ error: "That file is too large (10 MB limit)." });
    res.status(err.status === 400 ? 400 : 500).json({ error: err.status === 400 ? "Bad request." : "Something went wrong on the server." });
  });
  return app;
}

export async function migrate(pool) {
  for (const col of COLLECTIONS) {
    await pool.query(`create table if not exists ${col} (
      id text primary key,
      data jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`);
    await pool.query(`create index if not exists ${col}_created_idx on ${col} (created_at, id)`);
  }
  await pool.query(`create table if not exists imports (
    id text primary key, status text not null, kind text not null, label text not null,
    result jsonb, error text, created_at timestamptz not null default now())`);
  await pool.query("create table if not exists research_runs (id bigserial primary key, started_at timestamptz not null default now())");
}
