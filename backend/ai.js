// Which AI service is used, and how to talk to an OpenAI-compatible one (such as the U-M GPT Toolkit).
//   AI_PROVIDER=openai | anthropic   optional; if left out, OPENAI_API_KEY present means openai, otherwise anthropic
//   OPENAI_API_KEY                   the key (set in Render's Environment tab, never in the code)
//   OPENAI_BASE_URL                  default: the U-M GPT Toolkit, https://api.toolkit.umgpt.umich.edu/v1
//   AI_MODEL                         default: gpt-5.6-terra (openai) or claude-haiku-5-5 (anthropic)
// Everything the AI returns is untrusted text and is checked by research.js / importer.js before use.
import dns from "node:dns/promises";
import net from "node:net";

export const DEFAULT_OPENAI_BASE = "https://api.toolkit.umgpt.umich.edu/v1";

export function provider() {
  const p = String(process.env.AI_PROVIDER || "").toLowerCase();
  if (p === "openai" || p === "anthropic") return p;
  return process.env.OPENAI_API_KEY ? "openai" : "anthropic";
}
export const aiEnabled = () => (provider() === "openai" ? !!process.env.OPENAI_API_KEY : !!process.env.ANTHROPIC_API_KEY);
export const defaultModel = () => process.env.AI_MODEL || (provider() === "openai" ? "gpt-5.6-terra" : "claude-haiku-5-5");

const aiError = msg => new Error(msg); // messages starting with "The AI " are shown to people as they are

// One call to the Responses API (the same one Codex uses). Returns { text, urls }:
// urls are the web pages the answer cites, which is what the research step treats as "returned by search".
export async function openaiResponses({ instructions, input, tools, timeoutMs = 240_000 }) {
  const base = String(process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE).replace(/\/+$/, "");
  let res;
  try {
    res = await fetch(base + "/responses", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: defaultModel(), instructions, input, ...(tools ? { tools } : {}) }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    throw aiError(e && e.name === "TimeoutError" ? "The AI took too long to finish." : "The AI service could not be reached.");
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 600); // goes to the server log only
    if (res.status === 400 && tools && /tool|web_search/i.test(body)) throw aiError("The AI service does not offer web search with this key, so automatic research is not available.");
    const e = new Error(`${res.status} ${body}`); e.status = res.status; throw e;
  }
  const j = await res.json().catch(() => null);
  if (!j || typeof j !== "object") throw aiError("The AI sent a reply that could not be read.");
  if (j.error) throw aiError("The AI service reported an error.");
  let text = "";
  const urls = new Set();
  for (const item of Array.isArray(j.output) ? j.output : []) {
    if (item.type === "web_search_call" && item.action && Array.isArray(item.action.sources)) for (const s of item.action.sources) if (s && typeof s.url === "string") urls.add(s.url);
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const c of item.content) {
      if (c.type === "refusal") throw aiError("The AI declined this request.");
      if (c.type !== "output_text") continue;
      text += typeof c.text === "string" ? c.text : "";
      for (const a of Array.isArray(c.annotations) ? c.annotations : []) if (a && a.type === "url_citation" && typeof a.url === "string") urls.add(a.url);
    }
  }
  if (!text && typeof j.output_text === "string") text = j.output_text;
  if (j.status === "incomplete" && !text) throw aiError("The AI took too long to finish.");
  return { text, urls };
}

/* ---- reading a web page ourselves (the OpenAI-style service has no page-reading tool) ---- */
function privateAddress(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::1" || l === "::") return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
    if (m) return privateAddress(m[1]);
    return /^f[cd]/.test(l) || /^fe[89ab]/.test(l);
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
async function requirePublic(u) {
  if (u.protocol !== "https:") throw aiError("The AI import can only read https addresses.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some(a => privateAddress(a.address))) throw aiError("The AI import could not read that address.");
}
export function pageToText(html) {
  const mails = [...String(html).matchAll(/mailto:([^"'?\s>]+)/gi)].map(m => m[1]);
  let t = String(html).replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|br|section|article)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t\r\f]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  if (mails.length) t += "\nEmail addresses linked on the page: " + [...new Set(mails)].slice(0, 50).join(", ");
  return t.slice(0, 120_000);
}
export async function fetchPageText(url) {
  let u = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    await requirePublic(u);
    const res = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "DL3-CRM-importer", Accept: "text/html,text/plain" } }).catch(() => null);
    if (!res) throw aiError("The AI import could not open that page.");
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { u = new URL(res.headers.get("location"), u); continue; }
    if ([401, 403, 429].includes(res.status)) throw aiError("That website does not allow automated readers (it answered " + res.status + "). Save the page as a PDF, or copy its text into a .txt file, and use Import from a file instead.");
    if (!res.ok) throw aiError("The AI import could not open that page (it answered " + res.status + ").");
    if (!/text\/(html|plain)/i.test(res.headers.get("content-type") || "")) throw aiError("The AI import can only read web pages, not other file types.");
    const chunks = []; let size = 0;
    for await (const c of res.body) { size += c.length; if (size > 2_000_000) break; chunks.push(c); }
    const text = pageToText(Buffer.concat(chunks).toString("utf8"));
    if (text.length < 50) throw aiError("The AI import found almost no text on that page.");
    return text;
  }
  throw aiError("The AI import was sent around too many times by that page.");
}
