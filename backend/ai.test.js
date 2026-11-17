import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { provider, aiEnabled, defaultModel, openaiResponses, pageToText, fetchPageText } from "./ai.js";
import { askModel } from "./research.js";
import { askPdf } from "./importer.js";

const KEYS = ["AI_PROVIDER", "OPENAI_API_KEY", "OPENAI_BASE_URL", "ANTHROPIC_API_KEY", "AI_MODEL"];
const withEnv = async (env, fn) => {
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  KEYS.forEach(k => delete process.env[k]); Object.assign(process.env, env);
  try { return await fn(); } finally { KEYS.forEach(k => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))); }
};

test("provider choice follows the keys that are set", async () => {
  await withEnv({}, () => { assert.equal(provider(), "anthropic"); assert.equal(aiEnabled(), false); });
  await withEnv({ ANTHROPIC_API_KEY: "a" }, () => { assert.equal(provider(), "anthropic"); assert.equal(aiEnabled(), true); assert.equal(defaultModel(), "claude-haiku-5-5"); });
  await withEnv({ OPENAI_API_KEY: "o" }, () => { assert.equal(provider(), "openai"); assert.equal(aiEnabled(), true); assert.equal(defaultModel(), "gpt-5.6-terra"); });
  await withEnv({ OPENAI_API_KEY: "o", ANTHROPIC_API_KEY: "a", AI_PROVIDER: "anthropic" }, () => assert.equal(provider(), "anthropic"));
  await withEnv({ OPENAI_API_KEY: "o", AI_MODEL: "x" }, () => assert.equal(defaultModel(), "x"));
});

function mock(handler) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", c => (b += c)); req.on("end", () => { seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b || "{}") }); const [code, out] = handler(seen.at(-1)); res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(out)); });
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r({ srv, seen, base: `http://127.0.0.1:${srv.address().port}/v1` })));
}
const answer = (text, urls = []) => [200, { status: "completed", output: [
  { type: "web_search_call", action: { sources: [{ url: "https://src.example/a" }] } },
  { type: "message", content: [{ type: "output_text", text, annotations: urls.map(u => ({ type: "url_citation", url: u })) }] }] }];

test("research sends the key as a bearer token with web search, and collects cited pages", async () => {
  const m = await mock(() => answer('{"ok":1}', ["https://src.example/b"]));
  try {
    await withEnv({ OPENAI_API_KEY: "secret-key", OPENAI_BASE_URL: m.base }, async () => {
      const r = await askModel("Some Firm");
      assert.equal(r.text, '{"ok":1}');
      assert.deepEqual([...r.urls].sort(), ["https://src.example/a", "https://src.example/b"]);
    });
    const c = m.seen[0];
    assert.equal(c.url, "/v1/responses"); assert.equal(c.auth, "Bearer secret-key");
    assert.equal(c.body.model, "gpt-5.6-terra"); assert.deepEqual(c.body.tools, [{ type: "web_search" }]);
    assert.match(c.body.input, /Some Firm/);
  } finally { m.srv.close(); }
});

test("a PDF is sent as a file input and no search tool", async () => {
  const m = await mock(() => answer('{"firms":[]}'));
  try {
    await withEnv({ OPENAI_API_KEY: "k", OPENAI_BASE_URL: m.base }, async () => { assert.equal(await askPdf(Buffer.from("%PDF-1.4 test")), '{"firms":[]}'); });
    const part = m.seen[0].body.input[0].content[0];
    assert.equal(part.type, "input_file"); assert.match(part.file_data, /^data:application\/pdf;base64,/); assert.equal(m.seen[0].body.tools, undefined);
  } finally { m.srv.close(); }
});

test("errors: status is kept for the log, unsupported web search and refusals get plain messages", async () => {
  let reply = [401, { error: "bad" }];
  const m = await mock(() => reply);
  try {
    await withEnv({ OPENAI_API_KEY: "k", OPENAI_BASE_URL: m.base }, async () => {
      await assert.rejects(openaiResponses({ instructions: "x", input: "y" }), e => e.status === 401);
      reply = [400, { error: { message: "Unsupported tool type: web_search" } }];
      await assert.rejects(openaiResponses({ instructions: "x", input: "y", tools: [{ type: "web_search" }] }), /does not offer web search/);
      reply = [200, { output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }];
      await assert.rejects(openaiResponses({ instructions: "x", input: "y" }), /declined/);
    });
  } finally { m.srv.close(); }
});

test("page text: scripts removed, links to emails kept, and private addresses are refused", async () => {
  const t = pageToText('<html><script>evil()</script><h1>Our team</h1><p>Pat &amp; Co</p><a href="mailto:pat@firm.com">mail</a></html>');
  assert.ok(t.includes("Our team") && t.includes("Pat & Co") && t.includes("pat@firm.com") && !t.includes("evil"));
  for (const u of ["https://127.0.0.1/", "https://10.0.0.5/x", "https://169.254.169.254/latest", "https://[::1]/", "http://example.com/"]) await assert.rejects(fetchPageText(u), /The AI import/, u);
});
