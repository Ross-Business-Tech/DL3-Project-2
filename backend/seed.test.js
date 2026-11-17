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
