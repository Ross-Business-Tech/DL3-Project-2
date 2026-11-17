// Tests for the outreach tracker's data: the outreach and projects collections.
// Database checks run only when TEST_DATABASE_URL is set.
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createApp, migrate, validate } from "./app.js";

test("validate: outreach records accept good data and reject bad data", () => {
  const ok = { investor_name: "Acme", project: "Project A", channel: "Email", direction: "out", touch_date: "2026-11-10", interest: "Hot", amount_m: 3.5, follow_up: "2026-11-12", follow_up_done: false };
  assert.deepEqual(validate(ok, { requireName: true, collection: "outreach" }).data, ok);
  const bad = (over, re) => assert.match(validate({ ...ok, ...over }, { requireName: true, collection: "outreach" }).error, re);
  bad({ interest: "Super hot" }, /interest must be one of/);
  bad({ direction: "sideways" }, /direction must be one of/);
  bad({ channel: "Carrier pigeon" }, /channel must be one of/);
  bad({ follow_up: "<img src=x onerror=alert(1)>" }, /must be a date|too long/);
  bad({ follow_up: "<b>x</b>" }, /must be a date/);
  bad({ touch_date: "11/10/2026" }, /must be a date/);
  bad({ amount_m: -1 }, /at least 0/);
  bad({ amount_m: "5" }, /must be a number/);
  bad({ amount_m: Infinity }, /must be a number|must be at most/);
  bad({ amount_m: 1e9 }, /at most/);
  bad({ follow_up_done: "yes" }, /true or false/);
  bad({ surprise: 1 }, /Unknown field/);
  assert.match(validate({ project: "x" }, { requireName: true, collection: "outreach" }).error, /investor_name is required/);
  assert.equal(validate({ follow_up: "" }, { requireName: false, collection: "outreach" }).data.follow_up, "", "clearing a date is allowed");
});

test("validate: projects need a name and a numeric target", () => {
  assert.deepEqual(validate({ name: " Project A ", target_m: 12, active: true }, { requireName: true, collection: "projects" }).data, { name: "Project A", target_m: 12, active: true });
  assert.match(validate({ target_m: 12 }, { requireName: true, collection: "projects" }).error, /name is required/);
  assert.match(validate({ name: "x", target_m: "12" }, { requireName: true, collection: "projects" }).error, /must be a number/);
});

const url = process.env.TEST_DATABASE_URL;
test("tracker API end to end", { skip: !url && "TEST_DATABASE_URL not set" }, async t => {
  const pool = new pg.Pool({ connectionString: url });
  await migrate(pool);
  for (const tbl of ["investors", "outreach", "projects"]) await pool.query(`truncate ${tbl}`);
  const server = createApp(pool).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.close(); await pool.end(); });
  const call = async (method, p, body) => { const r = await fetch(base + p, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };

  const proj = await call("POST", "/api/projects", { name: "Project A", target_m: 12, summary: "Mixed-income", active: true });
  assert.equal(proj.status, 201);
  const out = await call("POST", "/api/outreach", { investor_rid: "rec_x", investor_name: "Acme", project: "Project A", channel: "Email", direction: "out", touch_date: "2026-11-10", interest: "Warm", amount_m: 2, follow_up: "2026-11-15", follow_up_done: false });
  assert.equal(out.status, 201);
  const id = out.json.record.id;

  const done = await call("PATCH", `/api/outreach/${id}`, { follow_up_done: true });
  assert.equal(done.status, 200);
  assert.equal(done.json.record.data.follow_up_done, true);
  assert.equal(done.json.record.data.investor_name, "Acme", "partial update keeps the rest");

  assert.equal((await call("POST", "/api/outreach", { investor_name: "Acme", interest: "Hot", follow_up: "<script>1</script>" })).status, 400);
  assert.equal((await call("PATCH", `/api/outreach/${id}`, { interest: "Nope" })).status, 400);
  assert.equal((await call("DELETE", `/api/outreach/${id}`)).status, 404, "no delete route");

  // collections are separate: an id from one is not found in another
  assert.equal((await call("GET", `/api/projects/${id}`)).status, 404);
  assert.equal((await call("PATCH", `/api/investors/${id}`, { notes: "x" })).status, 404);
  assert.equal((await call("GET", "/api/outreach")).json.records.length, 1);
  assert.equal((await call("GET", "/api/projects")).json.records.length, 1);
  assert.equal((await call("GET", "/api/investors")).json.records.length, 0);
  assert.equal((await call("GET", "/api/anything")).status, 404);
  assert.equal((await call("GET", "/api/pg_tables")).status, 404, "only known collections exist");

  // the tracker script is served next to the page
  const js = await fetch(base + "/tracker.js");
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type"), /javascript/);
  assert.match(await js.text(), /function vTracker/);
  assert.match(await fetch(base + "/").then(r => r.text()), /<script src="tracker\.js\?v=1"><\/script>/);
  const groupsJs = await fetch(base + "/groups.js");
  assert.equal(groupsJs.status, 200);
  assert.match(await groupsJs.text(), /FLAG_CATALOG/);
  assert.match(await fetch(base + "/").then(r => r.text()), /<script src="groups\.js\?v=1"><\/script>/);
  const logo = await fetch(base + "/dl3-logo.png");
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get("content-type"), "image/png");
  assert.equal(Buffer.from(await logo.arrayBuffer()).subarray(1, 4).toString(), "PNG");
});
