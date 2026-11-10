/*
  DATA
  CSV-01 to CSV-25 come from the investor research CSV (public sources). Individuals are not named. Scores are in
  the order listed in ai.js.
  "sources" holds the publication date of each source (null means undated).
*/
const INVESTORS = [
  { id: "CSV-01", name: "Ante, Inc. (Antetokounmpo family office)", type: "Family office", hq: "Chicago, IL", scores: [5,5,3,3,4,4], sources: ["2026-01-26", "2026-04-01"], selfReported: false, hasDecisionMaker: true, stage: "identified", approved: false },
  { id: "CSV-02", name: "Lagflin SCA (Campari family office)", type: "Family office", hq: "Luxembourg-based entity", scores: [4,3,4,4,3,5], sources: ["2025-03-27"], selfReported: false, hasDecisionMaker: true, stage: "identified", approved: false },
  { id: "CSV-03", name: "Beitel Group (NY family office)", type: "Family office", hq: "New York, NY", scores: [3,5,3,4,2,4], sources: ["2021-03-04"], selfReported: false, hasDecisionMaker: false, stage: "identified", approved: false },
  { id: "CSV-04", name: "The Scharf Group (NY family office)", type: "Family office", hq: "New York, NY", scores: [3,5,3,4,2,4], sources: ["2021-03-04"], selfReported: false, hasDecisionMaker: false, stage: "identified", approved: false },
  { id: "CSV-05", name: "Elie Rieder family office (NY)", type: "Family office", hq: "Manhattan and Suffern, NY", scores: [3,4,1,2,1,2], sources: [null], selfReported: false, hasDecisionMaker: true, stage: "identified", approved: false },
  { id: "CSV-06", name: "The Chicago Family Office", type: "Family office", hq: "Chicago, IL", scores: [4,1,1,2,0,2], sources: [null], selfReported: false, hasDecisionMaker: false, stage: "identified", approved: false },
  { id: "CSV-07", name: "Berger Realty Group (family office)", type: "Family office", hq: "Chicago, IL", scores: [5,5,3,3,3,4], sources: ["2025-07-18", "2025-07-16"], selfReported: false, hasDecisionMaker: true, stage: "identified", approved: false },
  { id: "CSV-08", name: "Pontegadea Inversiones (Amancio Ortega family office)", type: "Family office", hq: "Spain", scores: [4,3,3,2,2,5], sources: ["2023-08-22", "2026-10-17"], selfReported: false, hasDecisionMaker: false, stage: "identified", approved: false },
  { id: "CSV-09", name: "Intercontinental Real Estate with Magellan Development Group", type: "Institutional", hq: "Chicago, IL", scores: [4,5,3,4,4,4], sources: ["2026-02-10", "2026-02-10"], selfReported: false, hasDecisionMaker: false, stage: "identified", approved: false },
  { id: "CSV-10", name: "FPA Multifamily", type: "Institutional", hq: "Chicago, IL", scores: [5,5,4,4,5,5], sources: ["2025-12-19", "2026-02-17"], selfReported: false, hasDecisionMaker: true, stage: "identified", approved: false },
  { id: "CSV-11", name: "LaTerra Capital Management and Respark Residential", type: "Institutional", hq: "HQ: Marina del Rey, CA", scores: [5,5,4,4,5,5], sources: ["2025-12-16", "2026-03-31"], selfReported: false, hasDecisionMaker: true, stage: "identified", approved: false },
  { id: "CSV-12", name: "Laramar Group", type: "Institutional", hq: "Chicago, IL", scores: [5,5,4,3,2,4], sources: [null], selfReported: false, hasDecisionMaker: false, stage: "identified", approved: false },
  { id: "CSV-13", name: "Concord Capital", type: "Institutional", hq: "Chicago, IL", scores: [5,5,2,4,3,3], sources: ["2026-08-17"], selfReported: false, hasDecisionMaker: false, stage: "identified", approved: false },
  { id: "CSV-14", name: "Equus Capital Partners", type: "Institutional", hq: "Chicago, IL", scores: [4,5,2,4,2,3], sources: [null], selfReported: false, hasDecisionMaker: false, stage: "identified", approved: false },
  { id: "CSV-15", name: "Eastham Capital (with Bender Cos.)", type: "Institutional", hq: "Chicago, IL", scores: [5,5,3,4,5,4], sources: ["2026-03-27", "2026-04-01"], selfReported: false, hasDecisionMaker: false, stage: "identified", approved: false },
  { id: "CSV-16", name: "Standard Real Estate Investments", type: "Institutional", hq: "Midwest", scores: [4,5,2,4,1,3], sources: [null], selfReported: false, hasDecisionMaker: false, stage: "identified", approved: false },
  { id: "CSV-17", name: "R.I.G. Capital", type: "Institutional", hq: "Chicago, IL", scores: [5,5,4,3,3,4], sources: ["2026-05-13", "2026-05-13"], selfReported: false, hasDecisionMaker: false, stage: "identified", approved: false },
  { id: "CSV-18", name: "Waterton", type: "Institutional", hq: "Chicago, IL", scores: [5,5,4,3,3,4], sources: ["2026-03-11"], selfReported: false, hasDecisionMaker: false, stage: "identified", approved: false },
  { id: "CSV-19", name: "Cedar Street", type: "Institutional", hq: "Chicago, IL", scores: [5,5,3,4,4,4], sources: ["2026-03-05"], selfReported: false, hasDecisionMaker: false, stage: "identified", approved: false },
  { id: "CSV-20", name: "RPM Living", type: "Institutional", hq: "Texas", scores: [5,5,4,3,5,5], sources: ["2026-07-06", "2026-08-24"], selfReported: false, hasDecisionMaker: false, stage: "identified", approved: false },
  { id: "CSV-21", name: "Highland Partners", type: "Institutional", hq: "Utah", scores: [4,5,4,3,3,4], sources: ["2026-07-09"], selfReported: false, hasDecisionMaker: false, stage: "identified", approved: false },
  { id: "CSV-22", name: "Branch Capital Partners", type: "Institutional", hq: "Chicago, IL", scores: [4,5,2,3,2,2], sources: ["2026-08-03"], selfReported: false, hasDecisionMaker: false, stage: "identified", approved: false },
  { id: "CSV-23", name: "Individual investor A", type: "Qualified purchaser", hq: "Chicago, IL", scores: [5,5,3,3,2,3], sources: [null], selfReported: false, hasDecisionMaker: true, stage: "identified", approved: false },
  { id: "CSV-24", name: "Individual investors B", type: "Qualified purchaser", hq: "Chicago, IL", scores: [5,5,3,4,3,3], sources: ["2025-07-18"], selfReported: false, hasDecisionMaker: true, stage: "identified", approved: false },
  { id: "CSV-25", name: "Randolph Street Realty Capital", type: "Qualified purchaser", hq: "Chicago, IL", scores: [5,5,2,3,3,3], sources: ["2025-01-17"], selfReported: false, hasDecisionMaker: true, stage: "identified", approved: false }
];

/*
  Milestone 1: show every investor, sorted by fit score (highest first).
  The shortlist and approval features come in later milestones.
*/
function render() {
  // Score each investor using the function in ai.js, then sort by fit.
  const ranked = INVESTORS
    .map(inv => ({ inv: inv, r: rankProspect(inv) }))
    .sort((a, b) => b.r.fit - a.r.fit);

  const rows = ranked.map((x, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${x.inv.name}</td>
      <td>${x.inv.type}</td>
      <td class="num">${x.r.fit}</td>
      <td>${x.r.confidence}</td>
      <td>${x.r.flags.length ? x.r.flags.join(", ") : "None"}</td>
    </tr>`).join("");

  document.getElementById("list").innerHTML = `
    <table>
      <thead>
        <tr><th>Rank</th><th>Investor</th><th>Type</th><th>Fit</th><th>Confidence</th><th>Flags</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  document.getElementById("count").textContent =
    INVESTORS.length + " investors from public research, ranked by fit score";
}

render();
