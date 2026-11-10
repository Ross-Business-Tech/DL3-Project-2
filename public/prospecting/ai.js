/*
  PROTOTYPE SCORING (SIMULATED)

  This file holds the one scoring function for the prototype: rankProspect.
  It uses simple, fixed rules. It does not call any AI model or database.
  A real model or database can replace this function later, as long as it
  returns the same kind of result.

  Each investor has six scores from 0 to 5, in this order:
    [Chicago interest, multifamily experience, equity check size,
     strategy fit, evidence of deals, capital and investor type]
*/

// The date the prototype treats as "today".
const AS_OF = "2026-11-03";

// Sources dated on or after this are "recent" (within the last 24 months).
const RECENT_FROM = "2024-11-03";

// How many points each criterion can be worth. They add up to 100.
const WEIGHTS = [20, 20, 20, 15, 15, 10];

/*
  rankProspect(inv)
  Input: one investor record (see script.js).
  Output: { fit, capped, confidence, flags, label }
    fit        = total score from 0 to 100
    capped     = true if the score was lowered to 60 because there are no verified deals
    confidence = "High", "Medium", or "Low"
    flags      = plain-English warnings for a human to review
    label      = the text that must appear next to the result in the interface
*/
function rankProspect(inv) {
  // 1. Fit score: each criterion gives (score x weight / 5) points.
  let raw = 0;
  for (let k = 0; k < 6; k++) {
    raw += inv.scores[k] * WEIGHTS[k] / 5;
  }
  let fit = Math.round(raw);

  // 2. Cap rule: no verified deals means the total can be at most 60.
  let capped = false;
  if (inv.scores[4] === 0 && fit > 60) {
    fit = 60;
    capped = true;
  }

  // 3. Confidence: based on how many dated sources are recent.
  const dated = inv.sources.filter(d => d !== null);
  const recent = dated.filter(d => d >= RECENT_FROM).length;
  let confidence;
  if (inv.selfReported) {
    confidence = "Low";                 // self-reported data is never high confidence
  } else if (recent >= 2) {
    confidence = "High";
  } else if (dated.length >= 1) {
    confidence = "Medium";
  } else {
    confidence = "Low";                 // no dated sources at all
  }

  // 4. Flags: warnings a person should see.
  const flags = [];
  if (!inv.hasDecisionMaker) flags.push("Contact missing");
  if (inv.sources.some(d => d === null)) flags.push("Undated source");
  if (confidence === "Low") flags.push("Needs human review");
  if (capped) flags.push("Capped at 60 (no verified deals)");

  return {
    fit: fit,
    capped: capped,
    confidence: confidence,
    flags: flags,
    label: "Prototype scoring (simulated)"
  };
}
