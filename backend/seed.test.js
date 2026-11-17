// Run with TEST_DATABASE_URL (skipped without it).
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "./app.js";
import { seedBuiltIn } from "./seed.js";

const url = process.env.TEST_DATABASE_URL;
test("built-in investors load once and never overwrite worked-on records", { skip: !url && "TEST_DATABASE_URL not set" }, async t => {
  const pool = new pg.Pool({ connectionString: url });
  await migrate(pool);
  await pool.query("truncate investors, outreach");
  await pool.query("drop table if exists app_marks");
  t.after(async () => { await pool.query("drop table if exists app_marks"); await pool.end(); });
  const put = (data) => pool.query("insert into investors (id, data) values ($1, $2)", ["rec_" + Math.random().toString(36).slice(2).toUpperCase().padEnd(26, "0").slice(0, 26), data]);
  await put({ name: "Skydeck Capital", review_status: "pending" });                       // earlier import: filled in
  await put({ name: "BLG Capital Advisors", review_status: "approved", s_chicago: 2 });    // a person worked on it: left alone

  const r = await seedBuiltIn(pool);
  assert.equal(r.filled, 1); assert.equal(r.left, 1); assert.equal(r.invalid, 0); assert.equal(r.added, 51);
  const rows = (await pool.query("select data from investors")).rows.map(x => x.data);
  assert.equal(rows.length, 53);
  const sky = rows.find(d => d.name === "Skydeck Capital");
  assert.equal(sky.review_status, "approved"); assert.ok(sky.s_chicago > 0); assert.match(sky.sources_text, /praxisrock/);
  assert.equal(rows.find(d => d.name === "BLG Capital Advisors").s_chicago, 2);
  const fresh = rows.find(d => d.name === "Kinship Capital");
  assert.match(fresh.decision_text, /^Contact to confirm/); assert.equal(fresh.review_status, "approved");

  assert.deepEqual(await seedBuiltIn(pool), { skipped: true }, "second start does nothing");
  assert.equal((await pool.query("select count(*)::int n from investors")).rows[0].n, 53);
  assert.ok(!JSON.stringify(rows).match(/@(gmail|yahoo|hotmail|outlook)\./i), "no personal mailbox addresses");
});

test("both built-in lists load, once each, with no overlap", { skip: !url && "TEST_DATABASE_URL not set" }, async t => {
  const { seedAll } = await import("./seed.js");
  const pool = new pg.Pool({ connectionString: url });
  await migrate(pool);
  await pool.query("truncate investors, outreach");
  await pool.query("drop table if exists app_marks");
  t.after(async () => { await pool.query("drop table if exists app_marks"); await pool.end(); });
  const r = await seedAll(pool);
  assert.equal(r.praxis53.added, 53); assert.equal(r.chicago32.added, 32);
  const rows = (await pool.query("select data from investors")).rows.map(x => x.data);
  assert.equal(rows.length, 85);
  assert.equal(new Set(rows.map(d => d.name.toLowerCase().replace(/[^a-z0-9]/g, ""))).size, 85, "no duplicate names");
  assert.ok(rows.every(d => d.review_status === "approved" && d.sources_text && /^Contact to confirm/.test(d.decision_text)));
  const c = rows.find(d => /^Centaur/.test(d.name)); assert.deepEqual([c.s_chicago, c.s_mf, c.s_check, c.s_strategy, c.s_evidence, c.s_capital], [5, 5, 4, 3, 5, 5]);
  assert.deepEqual(Object.values(await seedAll(pool)).map(x => x.skipped), [true, true]);
  assert.equal((await pool.query("select count(*)::int n from investors")).rows[0].n, 85);
});
