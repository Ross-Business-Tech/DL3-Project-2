// Built-in investors that load once each, when the server starts. The lists live in seed-praxis.json and seed-chicago32.json: firm details,
// sources, deals and scores only. People's names, emails, phones and personal LinkedIn links are not in the
// public repo; they are added with the Import contacts box. A marker row makes this run only once.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validate, newId } from "./app.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const SEED_MARK = "praxis53";
export const SEED_SETS = [
  { mark: "praxis53", file: path.join(HERE, "seed-praxis.json") },
  { mark: "chicago32", file: path.join(HERE, "seed-chicago32.json") }
];

export async function seedBuiltIn(pool, file = SEED_SETS[0].file, mark = SEED_MARK) {
  await pool.query("create table if not exists app_marks (name text primary key, at timestamptz not null default now())");
  if ((await pool.query("select 1 from app_marks where name = $1", [mark])).rowCount) return { skipped: true };
  const items = JSON.parse(fs.readFileSync(file, "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  const db = await pool.connect();
  const out = { added: 0, filled: 0, left: 0, invalid: 0 };
  try {
    await db.query("begin");
    await db.query("select pg_advisory_xact_lock(7424)"); // two servers starting together: one waits
    if ((await db.query("select 1 from app_marks where name = $1", [mark])).rowCount) { await db.query("rollback"); return { skipped: true }; }
    const have = new Map((await db.query("select id, data from investors")).rows.map(r => [norm(r.data.name), r]));
    for (const item of items) {
      const rec = { ...item, review_status: "approved", stage: "identified", owner: "Unassigned", last_date: today, suppressed: false, no_website: false };
      const cur = have.get(norm(item.name));
      if (cur) {
        const d = cur.data, scored = ["s_chicago", "s_mf", "s_check", "s_strategy", "s_evidence", "s_capital"].some(k => d[k] > 0);
        if (d.review_status !== "pending" || scored) { out.left++; continue; } // a person already worked on it: untouched
        const v = validate(rec, { requireName: true, server: true });
        if (v.error) { out.invalid++; continue; }
        await db.query("update investors set data = data || $2::jsonb, updated_at = now() where id = $1", [cur.id, v.data]);
        out.filled++; continue;
      }
      rec.decision_text = "Contact to confirm | Head of acquisitions | | ";
      const v = validate(rec, { requireName: true, server: true });
      if (v.error) { out.invalid++; console.error("seed skipped", item.name, v.error); continue; }
      await db.query("insert into investors (id, data) values ($1, $2)", [newId(), v.data]);
      out.added++;
    }
    await db.query("insert into app_marks (name) values ($1)", [mark]);
    await db.query("commit");
  } catch (e) { await db.query("rollback").catch(() => {}); throw e; } finally { db.release(); }
  console.log("built-in investors loaded:", JSON.stringify(out));
  return out;
}

export async function seedAll(pool) { // every built-in list, each at most once
  const out = {};
  for (const set of SEED_SETS) out[set.mark] = await seedBuiltIn(pool, set.file, set.mark);
  return out;
}
