// Express app for the DL3 investor CRM: serves the CRM page and a small JSON API.
// The API copies the shape of here.now "Site Data" so the page works with either.
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(HERE, "../sites/investor-crm");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(SITE_DIR, ".herenow/data.json"), "utf8"));
const FIELDS = MANIFEST.collections.investors.fields; // single source of truth for allowed fields
const MAX_RECORD_BYTES = 16 * 1024;
const ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ID_PATTERN = /^rec_[0-9A-HJKMNP-TV-Z]{26}$/;

export function newId() {
  const bytes = crypto.randomBytes(26);
  let s = "rec_";
  for (const b of bytes) s += ID_ALPHABET[b % 32];
  return s;
}

// Check a request body against the field list. Returns { data } or { error }.
export function validate(body, { requireName }) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Body must be a JSON object." };
  const data = {};
  for (const [key, value] of Object.entries(body)) {
    const f = FIELDS[key];
    if (!f) return { error: `Unknown field: ${key}` };
    if (f.type === "string") {
      if (typeof value !== "string") return { error: `${key} must be text.` };
      const v = f.trim ? value.trim() : value;
      if (f.maxLength && v.length > f.maxLength) return { error: `${key} is too long (max ${f.maxLength}).` };
      data[key] = v;
    } else if (f.type === "integer") {
      if (!Number.isInteger(value)) return { error: `${key} must be a whole number.` };
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
  if (requireName && !data.name) return { error: "name is required." };
  if ("name" in data && !data.name) return { error: "name cannot be empty." };
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
  app.get("/favicon.ico", (req, res) => res.status(204).end());
  app.get("/healthz", async (req, res) => {
    try { await pool.query("select 1"); res.type("text").send("ok"); } catch { res.status(503).type("text").send("database unavailable"); }
  });

  const reads = limiter({ windowMs: 3600_000, max: 1200 });
  const writes = limiter({ windowMs: 3600_000, max: 300 });

  app.get("/api/investors", reads, async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    let after = null;
    if (req.query.cursor) {
      try { const [t, id] = Buffer.from(String(req.query.cursor), "base64url").toString().split("|"); after = { t, id }; if (!t || !ID_PATTERN.test(id)) throw 0; }
      catch { return res.status(400).json({ error: "Bad cursor." }); }
    }
    const params = after ? [after.t, after.id, limit + 1] : [limit + 1];
    const where = after ? "where (created_at, id) > ($1::timestamptz, $2)" : "";
    const { rows } = await pool.query(`select id, data, created_at, updated_at, created_at::text as created_text from investors ${where} order by created_at, id limit $${params.length}`, params);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > limit ? Buffer.from(`${last.created_text}|${last.id}`).toString("base64url") : null;
    res.json({ records: page.map(row), nextCursor });
  });

  app.get("/api/investors/:id", reads, async (req, res) => {
    if (!ID_PATTERN.test(req.params.id)) return res.status(404).json({ error: "Not found." });
    const { rows } = await pool.query("select id, data, created_at, updated_at from investors where id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    res.json({ record: row(rows[0]) });
  });

  app.post("/api/investors", writes, async (req, res) => {
    const v = validate(req.body, { requireName: true });
    if (v.error) return res.status(400).json({ error: v.error });
    const { rows } = await pool.query("insert into investors (id, data) values ($1, $2) returning id, data, created_at, updated_at", [newId(), v.data]);
    res.status(201).json({ record: row(rows[0]) });
  });

  app.patch("/api/investors/:id", writes, async (req, res) => {
    if (!ID_PATTERN.test(req.params.id)) return res.status(404).json({ error: "Not found." });
    const v = validate(req.body, { requireName: false });
    if (v.error) return res.status(400).json({ error: v.error });
    const { rows } = await pool.query("update investors set data = data || $2::jsonb, updated_at = now() where id = $1 returning id, data, created_at, updated_at", [req.params.id, v.data]);
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    res.json({ record: row(rows[0]) });
  });

  app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));
  app.use((req, res) => res.status(404).type("text").send("Not found"));
  app.use((err, req, res, next) => { // never echo internal details to the browser
    console.error("request failed:", err.message);
    if (res.headersSent) return next(err);
    res.status(err.status === 400 ? 400 : 500).json({ error: err.status === 400 ? "Bad request." : "Something went wrong on the server." });
  });
  return app;
}

export async function migrate(pool) {
  await pool.query(`create table if not exists investors (
    id text primary key,
    data jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`);
  await pool.query("create index if not exists investors_created_idx on investors (created_at, id)");
}
