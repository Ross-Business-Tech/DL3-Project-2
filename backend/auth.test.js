// Tests for the team password and for removing an investor.
// Database checks run only when TEST_DATABASE_URL is set.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import { createApp, migrate } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const PW = "correct horse battery staple";

async function withApp(password, fn) {
  const pool = new pg.Pool({ connectionString: url });
  await migrate(pool);
  for (const t of ["investors", "outreach", "projects"]) await pool.query(`truncate ${t}`);
  const saved = process.env.TEAM_PASSWORD;
  if (password) process.env.TEAM_PASSWORD = password; else delete process.env.TEAM_PASSWORD;
  const server = createApp(pool).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base, pool); } finally {
    server.close(); await pool.end();
    if (saved === undefined) delete process.env.TEAM_PASSWORD; else process.env.TEAM_PASSWORD = saved;
  }
}
const req = (base, method, path, { body, cookie, origin } = {}) => fetch(base + path, {
  method, redirect: "manual",
  headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) },
  body: body ? JSON.stringify(body) : undefined
});
const cookieFrom = r => (r.headers.get("set-cookie") || "").split(";")[0];

test("without a team password the tool is open, but removal is refused", { skip: !url && "TEST_DATABASE_URL not set" }, () => withApp("", async base => {
  assert.deepEqual(await (await req(base, "GET", "/api/session")).json(), { required: false, signedIn: true });
  assert.equal((await req(base, "GET", "/api/investors")).status, 200);
  assert.equal((await req(base, "GET", "/")).status, 200);
  const made = await (await req(base, "POST", "/api/investors", { body: { name: "Open Mode Co" } })).json();
  const del = await req(base, "DELETE", `/api/investors/${made.record.id}`, { body: { confirmed: true } });
  assert.equal(del.status, 403);
  assert.match((await del.json()).error, /needs the team password/);
  assert.equal((await req(base, "GET", `/api/investors/${made.record.id}`)).status, 200, "still there");
}));

test("with a team password, everything but the sign-in page is locked", { skip: !url && "TEST_DATABASE_URL not set" }, () => withApp(PW, async base => {
  assert.deepEqual(await (await req(base, "GET", "/api/session")).json(), { required: true, signedIn: false });
  const page = await req(base, "GET", "/");
  assert.equal(page.status, 302); assert.equal(page.headers.get("location"), "/login");
  assert.equal((await req(base, "GET", "/api/investors")).status, 401);
  assert.equal((await req(base, "POST", "/api/investors", { body: { name: "x" } })).status, 401);
  assert.equal((await req(base, "GET", "/api/research/status")).status, 401);
  assert.equal((await req(base, "POST", "/api/import/website", { body: { url: "https://example.com" } })).status, 401);
  const login = await req(base, "GET", "/login");
  assert.equal(login.status, 200); assert.match(await login.text(), /Enter the team password/);
  assert.equal((await req(base, "GET", "/healthz")).status, 200);
  assert.equal((await req(base, "GET", "/tracker.js")).status, 200);

  // wrong and right passwords
  assert.equal((await req(base, "POST", "/login", { body: { password: "nope" } })).status, 401);
  assert.equal((await req(base, "POST", "/login", { body: {} })).status, 401);
  assert.equal((await req(base, "POST", "/login", { body: { password: 123 } })).status, 401);
  const ok = await req(base, "POST", "/login", { body: { password: PW } });
  assert.equal(ok.status, 200);
  const setCookie = ok.headers.get("set-cookie");
  assert.match(setCookie, /dl3_session=/); assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=Lax/i);
  assert.ok(!setCookie.includes(PW) && !setCookie.includes(encodeURIComponent(PW)), "the password is never in the cookie");
  const cookie = cookieFrom(ok);

  assert.equal((await req(base, "GET", "/api/investors", { cookie })).status, 200);
  assert.equal((await req(base, "GET", "/", { cookie })).status, 200);
  assert.equal((await req(base, "GET", "/login", { cookie })).status, 302, "already signed in");
  assert.deepEqual(await (await req(base, "GET", "/api/session", { cookie })).json(), { required: true, signedIn: true });
  assert.equal((await req(base, "POST", "/api/investors", { body: { name: "Signed In Co" }, cookie })).status, 201);

  // forged, expired, and other-password cookies are refused
  const sig = (pw, exp) => crypto.createHmac("sha256", pw).update("dl3-session|" + exp).digest("base64url");
  const future = Date.now() + 86400000, past = Date.now() - 1000;
  for (const bad of ["dl3_session=garbage", `dl3_session=${future}.AAAA`, `dl3_session=${past}.${sig(PW, past)}`, `dl3_session=${future}.${sig("another password", future)}`, "dl3_session="])
    assert.equal((await req(base, "GET", "/api/investors", { cookie: bad })).status, 401, bad.slice(0, 40));
  assert.equal((await req(base, "GET", "/api/investors", { cookie: `dl3_session=${future}.${sig(PW, future)}` })).status, 200, "a correctly signed future cookie works");

  // requests from another website are refused even with a good cookie
  const evil = await req(base, "POST", "/api/investors", { body: { name: "Evil" }, cookie, origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  const same = await req(base, "POST", "/api/investors", { body: { name: "Same Site Co" }, cookie, origin: base });
  assert.equal(same.status, 201);

  // signing out clears the cookie
  const out = await req(base, "POST", "/logout", { cookie });
  assert.match(out.headers.get("set-cookie"), /dl3_session=;/);
}));

test("too many wrong passwords are slowed down", { skip: !url && "TEST_DATABASE_URL not set" }, () => withApp(PW, async base => {
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await req(base, "POST", "/login", { body: { password: "wrong" + i } })).status);
  assert.equal(codes.filter(c => c === 401).length, 10);
  assert.equal(codes.filter(c => c === 429).length, 2);
  assert.equal((await req(base, "POST", "/login", { body: { password: PW } })).status, 429, "even the right password waits");
}));

test("removing an investor needs confirmation and takes their outreach with it", { skip: !url && "TEST_DATABASE_URL not set" }, () => withApp(PW, async base => {
  const cookie = cookieFrom(await req(base, "POST", "/login", { body: { password: PW } }));
  const mk = async (path, body) => (await (await req(base, "POST", path, { body, cookie })).json()).record.id;
  const gone = await mk("/api/investors", { name: "Remove Me Capital" }), stays = await mk("/api/investors", { name: "Keep Me Capital" });
  await mk("/api/outreach", { investor_rid: gone, investor_name: "Remove Me Capital", interest: "Warm" });
  await mk("/api/outreach", { investor_rid: gone, investor_name: "Remove Me Capital", interest: "Hot" });
  await mk("/api/outreach", { investor_rid: stays, investor_name: "Keep Me Capital", interest: "Warm" });

  assert.equal((await req(base, "DELETE", `/api/investors/${gone}`, { body: { confirmed: true } })).status, 401, "needs the password");
  assert.equal((await req(base, "DELETE", `/api/investors/${gone}`, { cookie })).status, 400, "needs confirmation");
  assert.equal((await req(base, "DELETE", `/api/investors/${gone}`, { cookie, body: { confirmed: "yes" } })).status, 400, "only true counts");
  assert.equal((await req(base, "DELETE", `/api/investors/${gone}`, { cookie, body: { confirmed: true }, origin: "https://evil.example" })).status, 403);
  assert.equal((await req(base, "GET", `/api/investors/${gone}`, { cookie })).status, 200, "nothing happened yet");

  const done = await req(base, "DELETE", `/api/investors/${gone}`, { cookie, body: { confirmed: true } });
  assert.equal(done.status, 200);
  assert.deepEqual(await done.json(), { deleted: true, outreachRemoved: 2 });
  assert.equal((await req(base, "GET", `/api/investors/${gone}`, { cookie })).status, 404);
  const left = (await (await req(base, "GET", "/api/outreach", { cookie })).json()).records;
  assert.deepEqual(left.map(r => r.data.investor_name), ["Keep Me Capital"]);
  assert.equal((await req(base, "GET", `/api/investors/${stays}`, { cookie })).status, 200);
  assert.equal((await req(base, "DELETE", `/api/investors/${gone}`, { cookie, body: { confirmed: true } })).status, 404, "already gone");
  assert.equal((await req(base, "DELETE", "/api/investors/not-an-id", { cookie, body: { confirmed: true } })).status, 404);
  assert.equal((await req(base, "DELETE", `/api/outreach/${left[0].id}`, { cookie, body: { confirmed: true } })).status, 404, "only investors can be removed this way");
}));
