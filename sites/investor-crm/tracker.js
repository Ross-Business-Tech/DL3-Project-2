/*
  OUTREACH TRACKER
  Logs every touch DL3 has with an investor (emails, calls, meetings, replies), gauges how
  interested each investor is in each DL3 project, and pushes the next follow-up so no
  conversation goes quiet.

  Saved in the shared database (collections: outreach = one record per touch, projects = DL3 projects
  that need investors). On a here.now test link there is no shared data, so the page runs in demo mode
  with made-up sample data and nothing is saved.
  Written by a teammate; ported here to use the Render database.

  This file is loaded before the main script in index.html and uses its helpers
  (S, INV, esc, val, table, metric, can, render, saveRemote, api, log).
*/

// The data lives next to the investor list, wherever that is (Render API or here.now Site Data).
const outCol = () => COL.replace(/investors$/, "outreach");
const projCol = () => COL.replace(/investors$/, "projects");

/* Interest levels, strongest first. days = suggested wait before the next follow-up. */
const INTEREST = [
  { k: "Committed", score: 100, days: 7, tip: "Signed or verbally committed. Follow up on documents and closing." },
  { k: "Hot", score: 80, days: 2, tip: "Asked for materials, a call, or a site visit. Strike while it is warm." },
  { k: "Warm", score: 60, days: 5, tip: "Open to the deal and wants more information." },
  { k: "Lukewarm", score: 40, days: 10, tip: "Polite, but not a fit right now. Check back with an update." },
  { k: "No reply yet", score: 20, days: 7, tip: "No response. Try a different channel or an introduction." },
  { k: "Passed", score: 0, days: 0, tip: "Declined. No follow-up is scheduled." }
];
const CHANNELS = ["Email", "Call", "Meeting", "LinkedIn", "Introduction", "Event", "Site visit"];
const DIRECTIONS = [
  { k: "out", label: "DL3 reached out" },
  { k: "in", label: "Investor replied or reached out" },
  { k: "meeting", label: "Meeting held" }
];
const NO_REPLY_LIMIT = 3;

/* Real calendar date, so follow-ups line up with the day the team opens the page. */
function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function niceDate(s) {
  if (!s) return "";
  const d = new Date(s + "T12:00:00");
  return isNaN(d) ? esc(s) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); // esc: stored text is never trusted
}
function interestOf(k) { return INTEREST.find(x => x.k === k) || INTEREST[4]; }
function money(m) { return m ? "$" + (Math.round(m * 10) / 10).toLocaleString() + "M" : "$0"; }

/* ---------- Tracker state ---------- */
const T = { outreach: [], projects: [], project: "", draft: null, prefill: null, showAll: false };

/* ---------- Loading and saving ---------- */
async function loadAll(col) {
  const all = []; let cursor = "";
  do {
    const r = await api("GET", col + "?limit=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
    all.push(...(r.records || [])); cursor = r.nextCursor || "";
  } while (cursor);
  return all;
}
async function loadTracker() {
  if (S.demo) { demoTracker(); return; }
  try {
    const [o, p] = await Promise.all([loadAll(outCol()), loadAll(projCol())]);
    T.outreach = o.map(r => ({ rid: r.id, ...r.data }));
    T.projects = p.map(r => ({ rid: r.id, ...r.data }));
    T.loadError = "";
  } catch (e) {
    T.loadError = "Could not load the outreach log (" + e.message + "). New entries will not be saved until this works.";
  }
}
async function saveRec(col, rec, fields) {
  if (S.demo) return;
  if (rec.rid) return api("PATCH", col + "/" + rec.rid, fields);
  const r = await api("POST", col, fields); rec.rid = r.record.id;
}
function outFields(o) {
  return {
    investor_rid: o.investor_rid || "", investor_name: o.investor_name, project: o.project || "", channel: o.channel,
    direction: o.direction, touch_date: o.touch_date, logged_by: o.logged_by || "", summary: o.summary || "",
    interest: o.interest, amount_m: +o.amount_m || 0, next_step: o.next_step || "", follow_up: o.follow_up || "",
    follow_up_done: !!o.follow_up_done
  };
}
async function trySave(fn, okText) {
  try { await fn(); return okText + (S.demo ? " (Demo mode: not saved.)" : ""); }
  catch (e) { return "Could not save to the shared list (" + e.message + "). The change is on screen only."; }
}

/* ---------- Demo data (made up, for test links only) ---------- */
function demoTracker() {
  if (T.demoLoaded) return;
  T.demoLoaded = true;
  const t = todayStr();
  T.projects = [
    { name: "Sample Project A: mixed-income apartments", target_m: 12, summary: "Made-up example project", active: true },
    { name: "Sample Project B: affordable senior housing", target_m: 8, summary: "Made-up example project", active: true }
  ];
  const A = T.projects[0].name, B = T.projects[1].name;
  const inv = n => INV[n] || INV[0];
  const mk = (n, project, d, channel, direction, interest, amount, summary, next, fu, done) => ({
    investor_rid: inv(n).rid || inv(n).id, investor_name: inv(n).name, project, touch_date: addDays(t, d), channel, direction,
    logged_by: "DL3 team (sample)", interest, amount_m: amount, summary, next_step: next, follow_up: fu === null ? "" : addDays(t, fu), follow_up_done: !!done
  });
  T.outreach = [
    mk(9, A, -12, "Email", "out", "No reply yet", 0, "Sent the one-page teaser.", "Follow up", -5, true),
    mk(9, A, -5, "Email", "in", "Hot", 3, "Replied asking for the financial model and a call.", "Send model, book call", -1),
    mk(10, A, -9, "Introduction", "out", "Warm", 2, "Warm intro through a lender contact.", "Share pitch deck", 0),
    mk(18, A, -20, "Meeting", "meeting", "Committed", 4, "Verbal commitment at the site visit.", "Send subscription documents", 3),
    mk(0, B, -15, "Email", "out", "No reply yet", 0, "First outreach email.", "Try a call", -8, true),
    mk(0, B, -8, "Call", "out", "No reply yet", 0, "Left a voicemail.", "Try LinkedIn", -1),
    mk(14, B, -6, "Call", "in", "Lukewarm", 0, "Likes Chicago but the check is small for them.", "Send update when Phase 2 opens", 4),
    mk(19, B, -3, "Email", "out", "Warm", 1.5, "Shared the senior-housing summary; asked good questions.", "Answer questions on operator", 2),
    mk(6, A, -30, "Email", "in", "Passed", 0, "Not investing in multifamily this year.", "", null)
  ];
}

/* ---------- Derived views ---------- */
/* Latest touch for each investor + project pair: this is the conversation's current state. */
function conversations(project) {
  const map = new Map();
  T.outreach.filter(o => !project || o.project === project)
    .slice().sort((a, b) => (a.touch_date || "").localeCompare(b.touch_date || ""))
    .forEach(o => {
      const key = (o.investor_rid || o.investor_name) + "|" + o.project;
      const c = map.get(key) || { investor_rid: o.investor_rid, investor_name: o.investor_name, project: o.project, touches: [], noReply: 0 };
      c.prev = c.last; c.last = o; c.touches.push(o);
      c.noReply = o.direction === "out" && o.interest === "No reply yet" ? c.noReply + 1 : (o.direction === "out" ? c.noReply : 0);
      map.set(key, c);
    });
  return [...map.values()];
}
function trend(c) {
  if (!c.prev) return "";
  const d = interestOf(c.last.interest).score - interestOf(c.prev.interest).score;
  return d > 0 ? '<span class="good" title="Interest went up">▲</span>' : d < 0 ? '<span class="bad" title="Interest went down">▼</span>' : '<span class="muted" title="No change">▬</span>';
}
function gauge(level) {
  const lv = interestOf(level);
  const cls = lv.score >= 80 ? "hot" : lv.score >= 60 ? "warm" : lv.score >= 40 ? "luke" : lv.score > 0 ? "cold" : "none";
  return `<span class="gauge" title="${esc(lv.tip)}"><span class="gbar"><span class="gfill ${cls}" style="width:${Math.max(lv.score, 4)}%"></span></span>${esc(lv.k)}</span>`;
}
/* Open follow-ups: the newest touch in each conversation, if it has a follow-up date and is not done. */
function followUps() {
  return conversations("").map(c => c.last)
    .filter(o => o.follow_up && !o.follow_up_done && o.interest !== "Passed")
    .sort((a, b) => a.follow_up.localeCompare(b.follow_up));
}
function softCircled(project) {
  return conversations(project).filter(c => c.last.interest !== "Passed").reduce((s, c) => s + (+c.last.amount_m || 0), 0);
}
function invFor(o) { return INV.find(i => (i.rid || i.id) === o.investor_rid) || INV.find(i => i.name === o.investor_name); }

/* ---------- Actions ---------- */
function setTP(p) { T.project = p; render(); }
function suggestFollow() {
  const lv = interestOf(val("o_interest"));
  const el = document.getElementById("o_follow");
  el.value = lv.days ? addDays(val("o_date") || todayStr(), lv.days) : "";
  document.getElementById("o_tip").textContent = lv.tip + (lv.days ? " Suggested follow-up in " + lv.days + " day(s)." : "");
}
function prefillFrom(key) {
  const o = T.outreach[+key];
  T.prefill = { inv: o.investor_rid, project: o.project, interest: o.interest };
  S.msg = "Log the follow-up with " + o.investor_name + " below. The old reminder closes when you save.";
  render();
  const f = document.getElementById("logForm"); if (f) f.scrollIntoView({ behavior: "smooth" });
}
async function logOutreach() {
    const invKey = val("o_inv"), i = INV.find(x => (x.rid || x.id) === invKey);
  const o = {
    investor_rid: invKey, investor_name: i ? i.name : "", project: val("o_project"), channel: val("o_channel"),
    direction: val("o_dir"), touch_date: val("o_date") || todayStr(), logged_by: val("o_by").trim() || who(),
    interest: val("o_interest"), amount_m: +val("o_amount") || 0, summary: val("o_sum").trim(),
    next_step: val("o_next").trim(), follow_up: val("o_follow"), follow_up_done: false
  };
  if (!i) { S.msg = "Pick an investor."; render(); return; }
  if (!o.project) { S.msg = "Pick the project this outreach is for. Add a project first if the list is empty."; render(); return; }
  if (!o.summary) { S.msg = "Add a short summary of what happened."; render(); return; }
  if (o.direction === "out" && !i.approval) {
    S.msg = i.name + " has not been approved for outreach yet. Approve it first (Pipeline & approvals tab) before DL3 reaches out. Replies from the investor can still be logged.";
    render(); return;
  }
  if (o.interest === "Passed") o.follow_up = "";
  // Close the earlier open reminder for this conversation: this touch replaces it.
  const older = T.outreach.filter(x => (x.investor_rid || x.investor_name) === invKey && x.project === o.project && x.follow_up && !x.follow_up_done);
  T.outreach.push(o);
  // Keep the prospect record in step: last contact, next follow-up, and pipeline stage.
  if (o.touch_date > (i.last || "")) i.last = o.touch_date;
  if (o.follow_up) i.next = o.follow_up;
  const stageFor = o.interest === "Committed" ? "committed" : o.direction === "meeting" ? "meeting scheduled" : i.approval ? "contacted" : i.stage;
  const order = ["identified", "researched", "scored", "reviewed", "approved for outreach", "contacted", "meeting scheduled", "in diligence", "committed"];
  if (order.indexOf(stageFor) > order.indexOf(i.stage)) { i.history.unshift({ date: o.touch_date, role: who(), field: "stage", from: i.stage, to: stageFor }); i.stage = stageFor; }
  T.prefill = null;
  S.msg = await trySave(async () => {
    await saveRec(outCol(), o, outFields(o));
    for (const x of older) { x.follow_up_done = true; await saveRec(outCol(), x, { follow_up_done: true }); }
    if (!S.demo) await persist(i);
  }, "Logged outreach with " + i.name + (o.follow_up ? ". Follow-up set for " + niceDate(o.follow_up) + "." : "."));
  older.forEach(x => x.follow_up_done = true);
  render();
}
async function markDone(key) {
  const o = T.outreach[+key]; o.follow_up_done = true;
  S.msg = await trySave(() => saveRec(outCol(), o, { follow_up_done: true }), "Follow-up with " + o.investor_name + " marked done.");
  render();
}
async function snooze(key, n) {
  const o = T.outreach[+key]; o.follow_up = addDays(todayStr(), n);
  S.msg = await trySave(() => saveRec(outCol(), o, { follow_up: o.follow_up }), "Follow-up with " + o.investor_name + " moved to " + niceDate(o.follow_up) + ".");
  render();
}
function draftEmail(key) {
  const o = T.outreach[+key];
  const lv = o.interest;
  const opener = {
    "Committed": "Thank you again for your commitment to " + o.project + ". I am following up on the next steps to close.",
    "Hot": "Thank you for your interest in " + o.project + ". As promised, I am following up with the materials you asked for and would like to find a time to talk.",
    "Warm": "Thank you for taking a look at " + o.project + ". I wanted to follow up with a bit more detail and answer any questions.",
    "Lukewarm": "I wanted to share a short update on " + o.project + " in case the timing or structure now fits better.",
    "No reply yet": "I wanted to follow up on my earlier note about " + o.project + ", a DL3 project that may fit your Chicago multifamily strategy."
  }[lv] || "I wanted to follow up on " + o.project + ".";
  const ask = o.next_step ? "\n\nNext step on our side: " + o.next_step + "." : "";
  T.draft = {
    key, to: o.investor_name,
    subject: "Following up: " + o.project,
    body: "Hello,\n\n" + opener + ask + "\n\nWould you have 20 minutes this week or next?\n\nBest regards,\n[Your name]\nDL3"
  };
  render();
  const d = document.getElementById("draftBox"); if (d) d.scrollIntoView({ behavior: "smooth" });
}
async function copyDraft() {
  const t = document.getElementById("draftText");
  try { await navigator.clipboard.writeText(t.value); S.msg = "Email copied. Paste it into your email app."; }
  catch (e) { t.select(); S.msg = "Select the text in the box and copy it."; }
  render();
}
async function addProject() {
  if (!can("edit")) return;
  const name = val("p_name").trim(), target = +val("p_target") || 0;
  if (!name) { S.msg = "Project name is required."; render(); return; }
  if (T.projects.some(p => p.name.toLowerCase() === name.toLowerCase())) { S.msg = "There is already a project with that name."; render(); return; }
  const p = { name, target_m: target, summary: val("p_sum").trim(), active: true };
  T.projects.push(p);
  S.msg = await trySave(() => saveRec(projCol(), p, p), "Added project " + name + ".");
  render();
}

/* ---------- View ---------- */
function vTracker() {
  const t = todayStr(), week = addDays(t, 7);
  const fu = followUps();
  const overdueN = fu.filter(o => o.follow_up < t).length, dueToday = fu.filter(o => o.follow_up === t).length;
  const convs = conversations("");
  const active = convs.filter(c => c.last.interest !== "Passed");
  const hot = active.filter(c => interestOf(c.last.interest).score >= 80).length;
  const raised = T.projects.reduce((s, p) => s + softCircled(p.name), 0);
  const target = T.projects.reduce((s, p) => s + (+p.target_m || 0), 0);
  const idx = o => T.outreach.indexOf(o);

  const notice = T.loadError ? `<div class="notice">${esc(T.loadError)}</div>` : "";

  // 1. Follow-ups to push
  const shown = T.showAll ? fu : fu.filter(o => o.follow_up <= week);
  const fuRows = shown.map(o => {
    const late = o.follow_up < t, today = o.follow_up === t;
    const when = late ? `<span class="bad"><strong>Overdue</strong> · ${niceDate(o.follow_up)}</span>` : today ? `<span class="flag"><strong>Today</strong></span>` : niceDate(o.follow_up);
    const c = convs.find(c => c.last === o);
    const warn = c && c.noReply >= NO_REPLY_LIMIT ? `<div class="flag" style="font-size:12px">${c.noReply} touches with no reply. Try an introduction or pause.</div>` : "";
    return `<div class="fu ${late ? "late" : ""}">
      <div class="fu-main"><div><strong>${esc(o.investor_name)}</strong></div>
        <div class="muted" style="font-size:12px">${esc(o.project)}</div>
        <div style="margin-top:4px">${gauge(o.interest)}</div>
        <div style="margin-top:4px">${esc(o.next_step || "Follow up")}</div>${warn}</div>
      <div class="fu-side"><div>${when}</div>
        <div class="row" style="margin-top:6px;justify-content:flex-end">
          <button onclick="draftEmail(${idx(o)})">Draft email</button>
          <button class="primary" onclick="prefillFrom(${idx(o)})">Log follow-up</button>
          <button onclick="snooze(${idx(o)},3)" title="Remind me in 3 days">Snooze 3d</button>
          <button onclick="markDone(${idx(o)})">Done</button>
        </div></div></div>`;
  }).join("") || `<div class="muted">No follow-ups due in the next 7 days.</div>`;
  const more = fu.length > shown.length || T.showAll ? `<button style="margin-top:8px" onclick="T.showAll=!T.showAll;render()">${T.showAll ? "Show next 7 days only" : "Show all " + fu.length + " scheduled"}</button>` : "";

  const draft = T.draft ? `<div class="card" id="draftBox"><h2>Draft follow-up to ${esc(T.draft.to)}</h2>
    <div class="muted" style="margin-bottom:6px">Check and edit before sending. This page does not send email.</div>
    <textarea id="draftText" rows="9" style="width:100%">Subject: ${esc(T.draft.subject)}\n\n${esc(T.draft.body)}</textarea>
    <div class="row" style="margin-top:8px"><button class="primary" onclick="copyDraft()">Copy</button>
    <a class="btnlink" href="mailto:?subject=${encodeURIComponent(T.draft.subject)}&body=${encodeURIComponent(T.draft.body)}">Open in email app</a>
    <button onclick="T.draft=null;render()">Close</button></div></div>` : "";

  // 2. Log form
  const pf = T.prefill || {};
  const invOpts = INV.filter(i => !i.suppressed).slice().sort((a, b) => (b.approval ? 1 : 0) - (a.approval ? 1 : 0) || a.name.localeCompare(b.name))
    .map(i => { const k = i.rid || i.id; return `<option value="${esc(k)}" ${k === pf.inv ? "selected" : ""}>${esc(i.name)}${i.approval ? "" : " (not approved yet)"}</option>`; }).join("");
  const projOpts = T.projects.filter(p => p.active !== false).map(p => `<option ${p.name === (pf.project || T.project) ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  const lv0 = interestOf(pf.interest || "No reply yet");
  const form = `<div class="card" id="logForm"><h2>Log outreach</h2>
    <div class="formgrid">
      <label>Investor<select id="o_inv">${invOpts}</select></label>
      <label>Project<select id="o_project">${projOpts || '<option value="">Add a project first</option>'}</select></label>
      <label>What happened<select id="o_dir">${DIRECTIONS.map(d => `<option value="${d.k}">${d.label}</option>`).join("")}</select></label>
      <label>Channel<select id="o_channel">${CHANNELS.map(c => `<option>${c}</option>`).join("")}</select></label>
      <label>Date<input type="date" id="o_date" value="${t}" onchange="suggestFollow()"></label>
      <label>DL3 team member<input id="o_by" placeholder="Who reached out" value="${esc(T.lastBy || "")}" onchange="T.lastBy=this.value"></label>
      <label>Investor interest<select id="o_interest" onchange="suggestFollow()">${INTEREST.map(x => `<option ${x.k === lv0.k ? "selected" : ""}>${x.k}</option>`).join("")}</select></label>
      <label>Amount indicated ($M)<input type="number" id="o_amount" min="0" step="0.5" placeholder="0"></label>
      <label class="wide">Summary<input id="o_sum" placeholder="What was said or sent"></label>
      <label class="wide">Next step<input id="o_next" placeholder="e.g. Send the financial model"></label>
      <label>Follow up on<input type="date" id="o_follow" value="${lv0.days ? addDays(t, lv0.days) : ""}"></label>
    </div>
    <div class="muted" id="o_tip" style="margin-top:6px">${esc(lv0.tip)}${lv0.days ? " Suggested follow-up in " + lv0.days + " day(s)." : ""}</div>
    <div class="row" style="margin-top:10px"><button class="primary" onclick="logOutreach()">Save outreach</button>${T.prefill ? '<button onclick="T.prefill=null;render()">Clear</button>' : ""}</div>
  </div>`;

  // 3. Projects
  const projCards = T.projects.map(p => {
    const cs = conversations(p.name).sort((a, b) => interestOf(b.last.interest).score - interestOf(a.last.interest).score);
    const sc = softCircled(p.name), tgt = +p.target_m || 0, pct = tgt ? Math.min(100, Math.round(sc / tgt * 100)) : 0;
    const strong = cs.filter(c => interestOf(c.last.interest).score >= 60).length;
    const touched = new Set(cs.map(c => c.investor_rid || c.investor_name));
    const ideas = INV.filter(i => !i.suppressed && !touched.has(i.rid || i.id) && !touched.has(i.name)).sort((a, b) => fit(b).t - fit(a).t).slice(0, 3);
    const need = tgt && sc < tgt ? `<div class="notice" style="margin:8px 0 0"><strong>${money(tgt - sc)} still to find.</strong> ${strong < 3 ? "Fewer than 3 interested investors. " : ""}Best-fit investors not yet contacted for this project: ${ideas.map(i => esc(i.name) + " (fit " + fit(i).t + (i.approval ? "" : ", needs approval") + ")").join("; ") || "none left"}.</div>` : tgt ? `<div class="notice good" style="margin:8px 0 0">Target covered by soft-circled interest.</div>` : "";
    const rows = cs.map(c => [
      `<a href="#" onclick="go('Prospects');selectInv('${esc((invFor(c.last) || {}).id || "")}');return false">${esc(c.investor_name)}</a>`,
      gauge(c.last.interest) + " " + trend(c),
      c.last.amount_m ? money(c.last.amount_m) : "",
      niceDate(c.last.touch_date) + " · " + esc(c.last.channel),
      c.touches.length,
      c.last.follow_up && !c.last.follow_up_done ? (c.last.follow_up < t ? `<span class="bad">${niceDate(c.last.follow_up)}</span>` : niceDate(c.last.follow_up)) : '<span class="muted">none</span>'
    ]);
    return `<div class="card"><h2 style="margin-top:0">${esc(p.name)}</h2>
      <div class="row"><span>${money(sc)} soft-circled of ${tgt ? money(tgt) : "no target set"}</span><span class="muted">${cs.length} investor(s) contacted · ${strong} warm or better</span></div>
      ${tgt ? `<div class="pbar"><span style="width:${pct}%"></span></div>` : ""}
      ${need}
      <div style="margin-top:8px">${table(["Investor", "Interest", "Amount", "Last touch", "Touches", "Next follow-up"], rows)}</div></div>`;
  }).join("");
  const addProj = can("edit") ? `<div class="card"><h2>Add a DL3 project</h2><div class="formgrid">
      <label class="wide">Project name<input id="p_name" placeholder="e.g. Sample Project C"></label>
      <label>Equity to raise ($M)<input type="number" id="p_target" min="0" step="0.5"></label>
      <label class="wide">Short description<input id="p_sum" placeholder="Type, location, size"></label></div>
      <div class="row" style="margin-top:8px"><button class="primary" onclick="addProject()">Add project</button></div></div>` : "";

  // 4. History
  const hist = T.outreach.filter(o => !T.project || o.project === T.project).slice().sort((a, b) => (b.touch_date || "").localeCompare(a.touch_date || "")).slice(0, 40);
  const dirLabel = k => (DIRECTIONS.find(d => d.k === k) || { label: k }).label;
  const histT = table(["Date", "Investor", "Project", "What happened", "By", "Interest", "Summary"],
    hist.map(o => [niceDate(o.touch_date), esc(o.investor_name), esc(o.project), esc(o.channel) + ": " + esc(dirLabel(o.direction)), esc(o.logged_by), esc(o.interest), esc(o.summary)]));
  const projFilter = `<select onchange="setTP(this.value)"><option value="">All projects</option>${T.projects.map(p => `<option ${p.name === T.project ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`;

  return `${notice}
  <div class="grid">
    ${metric(`<span class="${overdueN ? "bad" : ""}">${overdueN}</span>`, "Follow-ups overdue")}
    ${metric(dueToday, "Follow-ups due today")}
    ${metric(active.length, "Active investor conversations")}
    ${metric(hot, "Hot or committed")}
    ${metric(money(raised) + (target ? ` <span class="muted" style="font-size:14px">of ${money(target)}</span>` : ""), "Soft-circled across projects")}
  </div>
  <h2>Follow-ups to push</h2>
  <div class="card">${fuRows}${more}</div>
  ${draft}
  ${form}
  <h2>Investor interest by project</h2>
  ${projCards || '<div class="card muted">No projects yet. Add DL3’s first project below.</div>'}
  ${addProj}
  <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Outreach history</h2>${projFilter}</div>
  <div style="margin-top:8px">${histT}</div></div>
  <div class="card"><h2>How the tracker works</h2><ul>
    <li>Every email, call, meeting, or reply DL3 logs here is saved with the project it was for and the investor’s interest at that moment.</li>
    <li>Interest levels: ${INTEREST.map(x => "<strong>" + x.k + "</strong> (" + (x.days ? "follow up in " + x.days + " days" : "no follow-up") + ")").join(", ")}. The suggested date can be changed.</li>
    <li>Logging a new touch closes the earlier reminder for that investor and project, updates the prospect’s last contact and next follow-up, and moves its pipeline stage forward.</li>
    <li>After ${NO_REPLY_LIMIT} outreach attempts with no reply, the tracker suggests an introduction or a pause.</li>
    <li>DL3 must have outreach approval before reaching out. Replies from investors can always be logged.</li>
  </ul></div>`;
}
