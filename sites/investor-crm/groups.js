/*
  GROUPS
  Click a group (a flag, a pipeline stage, an investor type or a confidence level) to see a summary of
  everyone in it, and fix each flag right there.

  This file is loaded before the main script in index.html and uses its helpers
  (S, INV, esc, val, can, fit, conf, inactive, overdue, STAGES, TYPES, AS_OF, go, selectInv, render,
  saveRemote, log) and todayStr / addDays from tracker.js.

  FLAG_CATALOG is the one list of flags. flags(i) in index.html is built from it, so a flag and its fix
  can never get out of step.
*/

const iso = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
const invById = id => INV.find(x => x.id === id);
const dateIn = (id, def) => `<input type="date" id="${id}" value="${esc(def || "")}">`;

const FLAG_CATALOG = [
  { key: "pending", label: "Pending review: confirm before use", test: i => i.review === "pending",
    help: "A person has not checked this record yet. Read the details and sources, correct anything wrong, then confirm it so it counts in the ranking.",
    save: "Confirm record",
    form: () => `<div class="muted">Confirming means a person has checked the details and sources.</div>`,
    apply: i => { i.review = "approved"; return { msg: "record confirmed" }; } },

  { key: "type", label: "Investor type not confirmed", test: i => i.type === "Unclassified",
    help: "Choose which kind of investor this is: a family office, an institution, or a qualified purchaser.",
    save: "Save type",
    form: i => `<label>Investor type <select id="fx1">${TYPES.filter(t => t !== "Unclassified").map(t => `<option>${esc(t)}</option>`).join("")}</select></label>`,
    apply: i => { i.type = val("fx1"); return { msg: "type set to " + i.type }; } },

  { key: "contact", label: "Contact missing", test: i => !i.decisionMakers.length,
    help: "Add a person or contact at the firm who can be approached, with their role.",
    save: "Add contact",
    form: () => `<div class="formgrid"><label>Name<input id="fx1" placeholder="Name of the contact"></label><label>Title<input id="fx2" placeholder="e.g. Head of acquisitions"></label></div>`,
    apply: i => {
      const name = val("fx1").trim().slice(0, 160), title = val("fx2").trim().slice(0, 160);
      if (!name) return { error: "Enter the contact's name." };
      i.decisionMakers.push({ name, title, src: "" }); return { msg: "contact added" };
    } },

  { key: "srcdate", label: "Unverified source date", test: i => i.sources.some(s => !s.published),
    help: "Some sources have no publication date. Open each source, find the date it was published, and enter it.",
    save: "Save dates",
    form: i => i.sources.map((s, k) => s.published ? "" : `<div class="row" style="margin:4px 0"><span style="min-width:200px">${esc(s.label)}${s.url ? ` <a href="${/^https:\/\//.test(s.url) ? esc(s.url) : "#"}" target="_blank" rel="noopener noreferrer">open</a>` : ""}</span>${dateIn("fx_d" + k)}</div>`).join(""),
    apply: i => {
      let n = 0;
      i.sources.forEach((s, k) => { const el = document.getElementById("fx_d" + k); if (el && el.value) { if (!iso(el.value)) return; s.published = el.value; n++; } });
      return n ? { msg: n + " source date(s) saved" } : { error: "Enter at least one date." };
    } },

  { key: "lowconf", label: "Needs human review", test: i => conf(i) === "Low",
    help: "Confidence is Low because the sources are self-reported, undated, or missing. Add a dated source (or set the dates) to raise it.",
    save: "Add source",
    form: i => `<div class="formgrid"><label>Source name<input id="fx1" placeholder="e.g. The Real Deal"></label><label>Link (https)<input id="fx2" placeholder="https://"></label><label>Date published${dateIn("fx3")}</label></div>${i.selfReported ? `<label style="margin-top:6px"><input type="checkbox" id="fx4"> These details are not self-reported (checked elsewhere)</label>` : ""}`,
    apply: i => {
      const name = val("fx1").trim(), url = val("fx2").trim(), date = val("fx3"), notSelf = document.getElementById("fx4");
      let msg = [];
      if (name || url || date) {
        if (!name || !/^https:\/\//i.test(url) || !iso(date)) return { error: "A source needs a name, a link starting with https://, and a publication date." };
        i.sources.push({ id: "S" + (i.sources.length + 1), label: name.slice(0, 80), url: url.slice(0, 300), accessed: todayStr(), published: date }); msg.push("source added");
      }
      if (notSelf && notSelf.checked) { i.selfReported = false; msg.push("marked as not self-reported"); }
      return msg.length ? { msg: msg.join(" and ") } : { error: "Add a source, or tick the box if it applies." };
    } },

  { key: "capped", label: "Score capped at 60 (no verified deals)", test: i => fit(i).capped,
    help: "With no verified deals the fit score is held at 60. Add a deal this firm really did, and give the evidence score it deserves.",
    save: "Add deal",
    form: () => `<div class="formgrid"><label class="wide">Deal (what, where, when)<input id="fx1" placeholder="e.g. Bought a 120-unit building in Lakeview, Mar 2026"></label><label>Evidence score (1 to 5)<select id="fx2">${[1, 2, 3, 4, 5].map(n => `<option ${n === 3 ? "selected" : ""}>${n}</option>`).join("")}</select></label></div><div class="muted">Also add the source for this deal under the record's Sources.</div>`,
    apply: i => {
      const deal = val("fx1").trim().slice(0, 300);
      if (!deal) return { error: "Describe the deal." };
      i.deals.push(deal); i.scores.evidence = +val("fx2"); return { msg: "deal added, evidence score " + i.scores.evidence };
    } },

  { key: "inactive", label: "No activity in 30+ days", test: i => inactive(i),
    help: "There has been no contact for over a month. Log the real contact in the Outreach tracker, or update the last contact date if it happened elsewhere.",
    save: "Update last contact",
    form: i => `<label>Date of the last real contact${dateIn("fx1", todayStr())}</label> <button type="button" onclick="trackerFor('${esc(i.id)}')">Log it in the Outreach tracker instead</button>`,
    apply: i => { const d = val("fx1"); if (!iso(d)) return { error: "Enter a date." }; i.last = d; return { msg: "last contact set to " + d }; } },

  { key: "overdue", label: "Follow-up overdue", test: i => overdue(i),
    help: "The planned follow-up date has passed. Set a new date, or clear it if no follow-up is needed.",
    save: "Set new date",
    form: i => `<label>New follow-up date${dateIn("fx1", addDays(todayStr(), 7))}</label> <button type="button" onclick="clearNext('${esc(i.id)}')">No follow-up needed</button>`,
    apply: i => { const d = val("fx1"); if (!iso(d)) return { error: "Enter a date." }; i.next = d; return { msg: "follow-up set for " + d }; } },

  { key: "approval", label: "Approval record missing", test: i => i.stage === "contacted" && !i.approval,
    help: "This investor is marked contacted but outreach was never approved. An Approver must approve it.",
    save: "Approve outreach",
    form: () => can("approve") ? `<div class="muted">Approving records that outreach was authorized.</div>` : `<div class="flag">Only an Approver can do this. Switch "Viewing as" to Approver, or ask the person who holds that role.</div>`,
    apply: i => { if (!can("approve")) return { error: "Only an Approver can approve outreach." }; i.approval = { by: "Approver", date: todayStr() }; return { msg: "outreach approved" }; } },

  { key: "intro", label: "No introduction path recorded", test: i => !i.rel.length,
    help: "Record who at DL3 knows someone at this firm, and how, so the team can ask for a warm introduction.",
    save: "Add path",
    form: () => `<div class="formgrid"><label>Who at DL3 knows them<input id="fx1" placeholder="Team member"></label><label>How they know them<input id="fx2" placeholder="e.g. former colleague of the principal"></label><label>Date confirmed${dateIn("fx3", todayStr())}</label></div>`,
    apply: i => {
      const holder = val("fx1").trim().slice(0, 80), knows = val("fx2").trim().slice(0, 200), confirmed = val("fx3");
      if (!holder || !knows) return { error: "Enter who knows them and how." };
      i.rel.push({ holder, knows, confirmed: iso(confirmed) ? confirmed : todayStr() }); return { msg: "introduction path added" };
    } },

  { key: "suppressed", label: "Suppressed (removal request)", test: i => i.suppressed,
    help: "This investor asked to be removed. Only lift the suppression if that request was withdrawn.",
    save: "Lift suppression",
    form: () => `<label><input type="checkbox" id="fx1"> The removal request was withdrawn</label>`,
    apply: i => { const c = document.getElementById("fx1"); if (!c || !c.checked) return { error: "Tick the box to confirm the request was withdrawn." }; i.suppressed = false; return { msg: "suppression lifted" }; } }
];
const flagIdx = key => FLAG_CATALOG.findIndex(f => f.key === key);

/* ---------- Opening a group ---------- */
function openGroup(kind, value) {
  if (S.tab !== "Group") S.prevTab = S.tab;
  S.group = { kind, value }; S.fix = null; S.msg = ""; S.tab = "Group";
  render(); window.scrollTo(0, 0);
}
function groupTitle(g) {
  return g.kind === "flag" ? "Flag: " + FLAG_CATALOG[g.value].label : g.kind === "stage" ? "Stage: " + g.value : g.kind === "type" ? "Type: " + g.value : "Confidence: " + g.value;
}
function groupMembers(g) {
  const test = g.kind === "flag" ? i => FLAG_CATALOG[g.value].test(i) : g.kind === "stage" ? i => i.stage === g.value : g.kind === "type" ? i => i.type === g.value : i => conf(i) === g.value;
  return INV.filter(test).sort((a, b) => fit(b).t - fit(a).t);
}
const gchip = (label, count, kind, value) => `<button type="button" class="chip linkchip" onclick="openGroup('${kind}',${typeof value === "number" ? value : "'" + esc(value) + "'"})">${esc(label)}: ${count}</button>`;

/* ---------- Summary of a group ---------- */
function groupSummary(list) {
  const n = list.length, fits = list.map(i => fit(i).t);
  const count = fn => list.filter(fn).length;
  const confs = ["High", "Medium", "Low"].map(c => [c, count(i => conf(i) === c)]);
  const flagCounts = FLAG_CATALOG.map((f, k) => [k, count(i => f.test(i))]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  const stages = STAGES.map(s => [s, count(i => i.stage === s)]).filter(x => x[1] > 0);
  const types = TYPES.map(t => [t, count(i => i.type === t)]).filter(x => x[1] > 0);
  return {
    n, avg: n ? Math.round(fits.reduce((a, b) => a + b, 0) / n) : 0, min: n ? Math.min(...fits) : 0, max: n ? Math.max(...fits) : 0,
    confs, flagCounts, stages, types, pending: count(i => i.review === "pending"), approved: count(i => i.approval), withFlags: count(i => flags(i).length > 0)
  };
}

/* ---------- The group page ---------- */
function vGroup() {
  const g = S.group;
  if (!g) return `<div class="card">Pick a group on the Dashboard.</div>`;
  const list = groupMembers(g), s = groupSummary(list);
  const back = `<button onclick="go(S.prevTab||'Dashboard')">← Back</button>`;
  const sentence = s.n === 0 ? "Nobody is in this group." :
    `${s.n} investor${s.n === 1 ? "" : "s"}, average fit ${s.avg} (range ${s.min} to ${s.max}). ${s.pending} waiting for review, ${s.approved} approved for outreach, ${s.withFlags} with at least one flag.` +
    (s.flagCounts.length ? ` Most common flag: ${FLAG_CATALOG[s.flagCounts[0][0]].label} (${s.flagCounts[0][1]}).` : " No flags in this group.");
  const help = g.kind === "flag" ? `<div class="card"><strong>How to fix it</strong><div style="margin-top:4px">${esc(FLAG_CATALOG[g.value].help)}</div></div>` : "";
  const mix = (title, chips) => chips ? `<div style="margin-top:8px"><strong>${title}</strong><br>${chips}</div>` : "";
  const summary = `<div class="card"><h2 style="margin-top:0">Summary</h2><p>${esc(sentence)}</p>
    <div class="sgrid">
      ${metric(s.n, "Investors")}${metric(s.avg, "Average fit")}${metric(s.pending, "Waiting for review")}${metric(s.withFlags, "With flags")}
    </div>
    ${mix("Confidence", s.confs.map(([c, n]) => gchip(c, n, "conf", c)).join(""))}
    ${mix("Flags in this group (click one to switch)", s.flagCounts.map(([k, n]) => gchip(FLAG_CATALOG[k].label, n, "flag", k)).join(""))}
    ${mix("Stages", s.stages.map(([st, n]) => gchip(st, n, "stage", st)).join(""))}
    ${mix("Types", s.types.map(([t, n]) => gchip(t, n, "type", t)).join(""))}</div>`;
  const cards = list.map(i => groupCard(i, g)).join("") || `<div class="card muted">Nothing is in this group any more. Nice work.</div>`;
  return `<div class="row" style="justify-content:space-between;margin-bottom:8px">${back}</div>
    <h2 style="margin-top:0">${esc(groupTitle(g))}</h2>${summary}${help}<h2>Investors in this group</h2>${cards}`;
}

function groupCard(i, g) {
  const mine = FLAG_CATALOG.map((f, k) => ({ f, k })).filter(x => x.f.test(i));
  const f0 = S.fix && S.fix.id === i.id ? S.fix.k : -1;
  const rows = mine.map(({ f, k }) => {
    const here = g.kind === "flag" && g.value === k;
    const open = f0 === k;
    const panel = open ? `<div class="fixbox"><div class="muted" style="margin-bottom:6px">${esc(f.help)}</div>${f.form(i)}
      <div class="row" style="margin-top:8px"><button class="primary" onclick="fixDo('${esc(i.id)}',${k})">${esc(f.save)}</button><button onclick="toggleFix('${esc(i.id)}',${k})">Cancel</button></div></div>` : "";
    return `<div class="flagrow"><span class="${here ? "" : "muted"}">${here ? "<strong>" + esc(f.label) + "</strong>" : esc(f.label)}</span>
      <button onclick="toggleFix('${esc(i.id)}',${k})">${open ? "Close" : "Fix"}</button></div>${panel}`;
  }).join("") || `<div class="muted">No flags.</div>`;
  return `<div class="card"><div class="row" style="justify-content:space-between">
      <strong><a href="#" onclick="go('Prospects');selectInv('${esc(i.id)}');return false">${esc(i.name)}</a></strong>
      <span class="muted">Fit ${fit(i).t} · ${esc(conf(i))} confidence · ${esc(i.stage)} · ${esc(i.type)}</span></div>
      <div style="margin-top:6px">${rows}</div></div>`;
}

function toggleFix(id, k) { S.fix = S.fix && S.fix.id === id && S.fix.k === k ? null : { id, k }; render(); }
async function fixDo(id, k) {
  const i = invById(id), f = FLAG_CATALOG[k];
  if (!i) return;
  if (!can("edit")) { S.msg = "Your role cannot edit records."; render(); return; }
  const r = f.apply(i);
  if (r.error) { S.msg = r.error; render(); return; }
  i.history.unshift({ date: todayStr(), role: S.role, field: "flag: " + f.label, from: "flagged", to: r.msg });
  log("Fixed flag: " + f.label, i.name);
  S.fix = null;
  S.msg = await saveRemote(i, "Saved for " + i.name + ": " + r.msg + ".");
  render();
}
async function clearNext(id) {
  const i = invById(id); if (!i || !can("edit")) return;
  i.next = ""; S.fix = null;
  S.msg = await saveRemote(i, "Follow-up cleared for " + i.name + ".");
  render();
}
function trackerFor(id) {
  const i = invById(id); if (!i) return;
  T.prefill = { inv: i.rid || i.id, project: "", interest: "No reply yet" };
  go("Tracker");
}

/* ---------- The Groups card on the Dashboard ---------- */
function groupsCard() {
  const flagChips_ = FLAG_CATALOG.map((f, k) => [f.label, INV.filter(f.test).length, k]).filter(x => x[1] > 0).map(([l, n, k]) => gchip(l, n, "flag", k)).join("") || '<span class="muted">No flags. Everything is clean.</span>';
  const types = TYPES.map(t => [t, INV.filter(i => i.type === t).length]).filter(x => x[1] > 0).map(([t, n]) => gchip(t, n, "type", t)).join("");
  const confs = ["High", "Medium", "Low"].map(c => gchip(c, INV.filter(i => conf(i) === c).length, "conf", c)).join("");
  return `<h2>Groups</h2><div class="card"><div class="muted" style="margin-bottom:6px">Click a group to see a summary and fix its flags.</div>
    <div><strong>Flags</strong><br>${flagChips_}</div>
    <div style="margin-top:8px"><strong>Investor type</strong><br>${types || '<span class="muted">none</span>'}</div>
    <div style="margin-top:8px"><strong>Confidence</strong><br>${confs}</div></div>`;
}
