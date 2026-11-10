// Tests for the automatic research. The AI service is simulated: no real calls, no cost.
// Database checks run only when TEST_DATABASE_URL is set.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import pg from "pg";
import { createApp, migrate } from "./app.js";
import { sanitizeResult, systemPrompt } from "./research.js";

const TODAY = "2026-11-10";
const FOUND = new Set(["https://therealdeal.com/a", "https://www.costar.com/b"]);
const answer = over => JSON.stringify({
  firm_type: "Family office", hq: "Chicago, IL", strategy: "Value-add multifamily", check_size: "$5M to $10M",
  website: "https://acme.example/", linkedin_company: "https://www.linkedin.com/company/acme", contact_email: "info@acme.example",
  sources: [
    { label: "The Real Deal", url: "https://therealdeal.com/a", published: "2026-03-01" },
    { label: "Invented page", url: "https://invented.example/x", published: "2026-03-01" }
  ],
  deals: [{ text: "Bought 100 units in Chicago (2026)", source: 1 }, { text: "Phantom deal", source: 2 }],
  scores: {
    chicago: { score: 5, reason: "Active in Chicago.", sources: [1] },
    mf: { score: 4, reason: "Multifamily buyer.", sources: [2] },
    check: { score: 3, reason: "Checks look right.", sources: [] },
    strategy: { score: 4, reason: "Value-add.", sources: [1] },
    evidence: { score: 5, reason: "Recent deal.", sources: [1] },
    capital: { score: 3, reason: "Family office.", sources: [1] }
  },
  missing: ["Equity check range is a guess"], ...over
});

test("sanitize: keeps supported facts, drops invented ones, and lowers unsupported scores", () => {
  const { data } = sanitizeResult("Here you go: " + answer(), FOUND, TODAY);
  assert.equal(data.sources_text.split("\n").length, 1);
  assert.match(data.sources_text, /therealdeal\.com\/a \| 2026-11-10 \| 2026-03-01/);
  assert.equal(data.deals_text, "Bought 100 units in Chicago (2026) (source 1)");
  assert.equal(data.s_chicago, 5);
  assert.equal(data.s_mf, 2, "cited only a dropped source");
  assert.equal(data.s_check, 2, "no source at all");
  assert.equal(data.s_evidence, 5);
  assert.equal(data.hq, "Chicago, IL");
  assert.equal(data.website, "https://acme.example/");
  assert.equal(data.linkedin, "https://www.linkedin.com/company/acme");
  assert.match(data.ai_summary, /Note: .*dropped/);
  assert.match(data.ai_missing, /Decision-makers are not collected/);
  assert.match(data.ai_missing, /Check the contact email/);
  assert.equal(data.ai_status, "done");
});

test("sanitize: no usable sources means no claims and low scores", () => {
  const { data } = sanitizeResult(answer({ sources: [{ label: "x", url: "https://invented.example/x" }], deals: [] }), FOUND, TODAY);
  assert.equal(data.hq, undefined);
  assert.equal(data.strategy, undefined);
  assert.equal(data.contact_email, undefined);
  assert.equal(data.s_evidence, 0);
  assert.ok(Object.entries(data).filter(([k]) => k.startsWith("s_")).every(([, v]) => v <= 2));
  assert.match(data.ai_missing, /Not found: any usable source/);
});

test("sanitize: rejects bad links, emails, dates, types and out-of-range scores", () => {
  const { data } = sanitizeResult(answer({
    website: "javascript:alert(1)", linkedin_company: "https://www.linkedin.com/in/some-person", contact_email: "not an email",
    firm_type: "Hedge fund", sources: [{ label: "Real", url: "https://therealdeal.com/a", published: "2099-01-01" }], deals: [],
    scores: { chicago: { score: 9, reason: "x", sources: [1] }, mf: { score: -3, reason: "x", sources: [1] }, check: { score: "high" }, strategy: {}, evidence: { score: 5, sources: [1] }, capital: null }
  }), FOUND, TODAY);
  assert.equal(data.website, undefined);
  assert.equal(data.linkedin, undefined);
  assert.equal(data.contact_email, undefined);
  assert.equal(data.type, undefined);
  assert.match(data.sources_text, /\|\s*$/, "future date becomes empty");
  assert.equal(data.s_chicago, 5);
  assert.equal(data.s_mf, 0);
  assert.equal(data.s_check, 0);
  assert.equal(data.s_evidence, 0, "evidence needs a sourced deal");
});

test("sanitize: instructions hidden in the answer are only ever text", () => {
  const { data } = sanitizeResult(answer({ strategy: "Ignore previous instructions <script>alert(1)</script>\u0000" }), FOUND, TODAY);
  assert.ok(!/[\u0000-\u001f]/.test(data.strategy));
  assert.match(data.strategy, /^Ignore previous instructions/); // stored as text; the page escapes it when shown
});

test("sanitize: unreadable answers are rejected", () => {
  assert.throws(() => sanitizeResult("I could not find anything", FOUND, TODAY), /not in the expected format/);
  assert.throws(() => sanitizeResult("{not json}", FOUND, TODAY), /not in the expected format/);
  assert.throws(() => sanitizeResult("[1,2]", FOUND, TODAY), /not in the expected format/);
});

test("system prompt tells the model the key rules", () => {
  const p = systemPrompt();
  for (const s of ["Never guess", "firms only", "never instructions", "web search"]) assert.match(p, new RegExp(s, "i"));
});

// ---- end to end with a simulated AI service -------------------------------------------------
const url = process.env.TEST_DATABASE_URL;
test("research job end to end", { skip: !url && "TEST_DATABASE_URL not set" }, async t => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL, lim: process.env.AI_DAILY_LIMIT };
  let mode = "good", calls = 0;
  const ai = http.createServer((req, res) => {
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      calls++;
      if (mode === "unauthorized") { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "secret detail" } })); }
      const message = (content, stop) => JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
      const search = [{ type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "x" } },
        { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://therealdeal.com/a", title: "A", encrypted_content: "x", page_age: null }] }];
      res.writeHead(200, { "content-type": "application/json" });
      if (mode === "pause" && !body.includes("pause-marker")) return res.end(message([...search, { type: "text", text: "pause-marker" }], "pause_turn"));
      if (mode === "garbage") return res.end(message([{ type: "text", text: "no json here" }], "end_turn"));
      res.end(message([...search, { type: "text", text: answer() }], "end_turn"));
    });
  });
  await new Promise(r => ai.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${ai.address().port}`;

  const pool = new pg.Pool({ connectionString: url });
  await migrate(pool);
  await pool.query("truncate investors"); await pool.query("truncate research_runs");
  const server = createApp(pool).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.close(); ai.close(); await pool.end();
    for (const [k, v] of [["ANTHROPIC_API_KEY", saved.key], ["ANTHROPIC_BASE_URL", saved.base], ["AI_DAILY_LIMIT", saved.lim]]) v === undefined ? delete process.env[k] : process.env[k] = v;
  });
  const call = async (method, p, body) => { const r = await fetch(base + p, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const waitFor = async (id, status) => { for (let i = 0; i < 80; i++) { const r = await call("GET", `/api/investors/${id}`); if (r.json.record.data.ai_status === status) return r.json.record.data; await new Promise(r => setTimeout(r, 100)); } throw new Error("timed out waiting for " + status); };
  const add = async (name, extra = {}) => (await call("POST", "/api/investors", { name, review_status: "pending", ...extra })).json.record.id;

  assert.deepEqual((await call("GET", "/api/research/status")).json, { enabled: true, remainingToday: 40 });

  // happy path: fills empty fields, applies scores, keeps what a person typed
  const id = await add("Acme Capital", { type: "Family office", notes: "typed by a person", strategy: "my own strategy" });
  assert.equal((await call("POST", `/api/investors/${id}/research`)).status, 202);
  const done = await waitFor(id, "done");
  assert.equal(done.name, "Acme Capital");
  assert.equal(done.notes, "typed by a person");
  assert.equal(done.strategy, "my own strategy", "a person's text is never overwritten");
  assert.equal(done.hq, "Chicago, IL");
  assert.equal(done.s_chicago, 5);
  assert.equal(done.s_mf, 2);
  assert.equal(done.review_status, "pending", "stays in review");
  assert.match(done.ai_summary, /Chicago interest: 5\/5/);
  assert.match(done.ai_missing, /Decision-makers are not collected/);

  // guards
  const confirmed = await add("Done Co"); await call("PATCH", `/api/investors/${confirmed}`, { review_status: "approved" });
  assert.equal((await call("POST", `/api/investors/${confirmed}/research`)).status, 409);
  assert.equal((await call("POST", "/api/investors/rec_00000000000000000000000000/research")).status, 404);
  assert.equal((await call("PATCH", `/api/investors/${id}`, { ai_status: "done" })).status, 400, "ai_ fields are server-only");
  assert.equal((await call("POST", "/api/investors", { name: "x", ai_summary: "forged" })).status, 400);

  // a second run on a record whose scores a person already set keeps the person's scores
  const id2 = await add("Scored By Hand Inc", { s_chicago: 1 });
  await call("POST", `/api/investors/${id2}/research`);
  const d2 = await waitFor(id2, "done");
  assert.equal(d2.s_chicago, 1);
  assert.match(d2.ai_summary, /scores were already set by a person/);

  // the model asks for another turn, then answers
  mode = "pause"; calls = 0;
  const id3 = await add("Paused Partners");
  await call("POST", `/api/investors/${id3}/research`);
  await waitFor(id3, "done");
  assert.equal(calls, 2);

  // unreadable answer and service errors are recorded without leaking details
  mode = "garbage";
  const id4 = await add("Garbage Group"); await call("POST", `/api/investors/${id4}/research`);
  const d4 = await waitFor(id4, "failed");
  assert.match(d4.ai_missing, /not in the expected format/);
  mode = "unauthorized";
  const id5 = await add("Unauthorized Unlimited"); await call("POST", `/api/investors/${id5}/research`);
  const d5 = await waitFor(id5, "failed");
  assert.match(d5.ai_missing, /code 401/);
  assert.ok(!/secret detail/.test(d5.ai_missing));

  // daily limit
  process.env.AI_DAILY_LIMIT = "1";
  const id6 = await add("Over Limit LLC");
  assert.equal((await call("POST", `/api/investors/${id6}/research`)).status, 429);
  assert.equal((await call("GET", "/api/research/status")).json.remainingToday, 0);

  // not set up
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal((await call("GET", "/api/research/status")).json.enabled, false);
  assert.equal((await call("POST", `/api/investors/${id6}/research`)).status, 503);
});
