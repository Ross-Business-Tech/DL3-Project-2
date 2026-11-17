// Removing several investors at once. Run with TEST_DATABASE_URL (skipped without it).
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createApp, migrate } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
test("remove several investors at once", { skip: !url && "TEST_DATABASE_URL not set" }, async t => {
  const pool = new pg.Pool({ connectionString: url });
  await migrate(pool);
  await pool.query("truncate investors, outreach");
  const server = createApp(pool).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await pool.end(); });
  const call = async (method, p, body) => { const r = await fetch(base + p, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const ids = [];
  for (const n of ["A", "B", "C", "Keep"]) ids.push((await call("POST", "/api/investors", { name: n })).json.record.id);
  await call("POST", "/api/outreach", { investor_rid: ids[0], investor_name: "A" });
  await call("POST", "/api/outreach", { investor_rid: ids[3], investor_name: "Keep" });

  assert.equal((await call("POST", "/api/investors-remove", { ids: [ids[0]] })).status, 400, "must be confirmed");
  assert.equal((await call("POST", "/api/investors-remove", { confirmed: true, ids: [] })).status, 400);
  assert.equal((await call("POST", "/api/investors-remove", { confirmed: true, ids: ["nope"] })).status, 400);
  assert.equal((await call("POST", "/api/investors-remove", { confirmed: true, ids: [ids[0], ids[0]] })).status, 400, "no repeats");
  assert.equal((await call("POST", "/api/investors-remove", { confirmed: true, ids: Array.from({ length: 51 }, () => ids[0]) })).status, 400);
  assert.equal((await call("GET", "/api/investors")).json.records.length, 4, "nothing removed by the bad requests");

  const r = await call("POST", "/api/investors-remove", { confirmed: true, by: "Pat", ids: ids.slice(0, 3) });
  assert.deepEqual(r.json, { deleted: 3, outreachRemoved: 1 });
  const left = (await call("GET", "/api/investors")).json.records.map(x => x.data.name);
  assert.deepEqual(left, ["Keep"]);
  assert.equal((await call("GET", "/api/outreach")).json.records.length, 1, "other investors' outreach stays");
});
