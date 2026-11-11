// Run with: TEST_DATABASE_URL=postgres://... npm test   (skipped when no test database is given)
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createApp, migrate, validate, newId } from "./app.js";

test("validate: accepts a good record and rejects bad ones", () => {
  assert.deepEqual(validate({ name: "  Acme  ", s_chicago: 4, suppressed: false }, { requireName: true }).data, { name: "Acme", s_chicago: 4, suppressed: false });
  assert.match(validate({ s_chicago: 3 }, { requireName: true }).error, /name is required/);
  assert.match(validate({ name: "x", nope: 1 }, { requireName: true }).error, /Unknown field/);
  assert.match(validate({ name: "x", s_chicago: 9 }, { requireName: true }).error, /at most 5/);
  assert.match(validate({ name: "x", s_chicago: "4" }, { requireName: true }).error, /whole number/);
  assert.match(validate({ name: "x".repeat(200) }, { requireName: true }).error, /too long/);
  assert.match(validate({ name: "" }, { requireName: false }).error, /cannot be empty/);
});

test("newId matches the record id format", () => assert.match(newId(), /^rec_[0-9A-HJKMNP-TV-Z]{26}$/));

const url = process.env.TEST_DATABASE_URL;
test("API end to end", { skip: !url && "TEST_DATABASE_URL not set" }, async t => {
  const pool = new pg.Pool({ connectionString: url });
  await migrate(pool);
  await pool.query("truncate investors");
  const server = createApp(pool).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await pool.end(); });
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null), text: null };
  };

  assert.equal((await call("GET", "/api/investors")).json.records.length, 0);
  const made = await call("POST", "/api/investors", { name: "Acme Capital", type: "Institutional", s_chicago: 5, review_status: "pending" });
  assert.equal(made.status, 201);
  const id = made.json.record.id;
  assert.match(id, /^rec_/);

  const patched = await call("PATCH", `/api/investors/${id}`, { notes: "checked", review_status: "approved" });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.record.data.name, "Acme Capital"); // untouched fields survive a partial update
  assert.equal(patched.json.record.data.review_status, "approved");

  assert.equal((await call("PATCH", `/api/investors/${id}`, { name: "" })).status, 400);
  assert.equal((await call("POST", "/api/investors", { type: "x" })).status, 400);
  assert.equal((await call("POST", "/api/investors", { name: "x", evil: 1 })).status, 400);
  assert.equal((await call("PATCH", "/api/investors/rec_00000000000000000000000000", { notes: "x" })).status, 404);
  assert.equal((await call("GET", "/api/investors/not-an-id")).status, 404);
  assert.equal((await call("DELETE", `/api/investors/${id}`)).status, 404); // no delete route

  // paging: 3 more records, page size 2
  for (const n of ["B", "C", "D"]) await call("POST", "/api/investors", { name: n });
  const p1 = await call("GET", "/api/investors?limit=2");
  assert.equal(p1.json.records.length, 2);
  assert.ok(p1.json.nextCursor);
  const p2 = await call("GET", `/api/investors?limit=2&cursor=${p1.json.nextCursor}`);
  assert.equal(p2.json.records.length, 2);
  assert.equal(p2.json.nextCursor, null); // last page
  const all = [...p1.json.records, ...p2.json.records].map(r => r.data.name);
  assert.deepEqual(all, ["Acme Capital", "B", "C", "D"]);
  assert.equal((await call("GET", "/api/investors?cursor=garbage")).status, 400);

  const page = await fetch(base + "/").then(r => r.text());
  assert.match(page, /window\.INVESTORS_API="\/api\/investors"/);
  assert.equal((await fetch(base + "/healthz")).status, 200);
});
