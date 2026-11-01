// Adds metrics derived from stored outputs to eval/results.json, without
// calling the model again. run.mjs calls this at the end of every run; it can
// also be run alone: node eval/derive.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { RULES } from "../src/rules.mjs";
import { combinedRegister } from "../src/pipeline.mjs";
import { unquote } from "../src/schema.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));

export function derive(results, drafts) {
  const byId = new Map(drafts.map((d) => [d.id, d]));
  const regRules = new Set(RULES.filter((r) => r.category === "register" && r.severity === "warning").map((r) => r.id));
  let total = 0, located = 0, labelled = 0, modelAgree = 0, combAgree = 0, informal = 0, modelCaught = 0, combCaught = 0;
  for (const x of results.drafts) {
    const d = byId.get(x.id);
    if (!x.output) continue;
    for (const c of x.output.changes) {
      total += 1;
      // Same normalization the pipeline now applies (cleanChanges).
      const f = unquote(c.from);
      if (f && d.draft.toLowerCase().includes(f.toLowerCase())) located += 1;
    }
    const e = d.expect_register;
    if (!e) continue;
    labelled += 1;
    const model = x.output.register.level;
    const comb = combinedRegister(model, x.rules.ids.filter((id) => regRules.has(id)));
    if (model === e) modelAgree += 1;
    if (comb === e) combAgree += 1;
    if (e === "too_informal") {
      informal += 1;
      if (model === e) modelCaught += 1;
      if (comb === e) combCaught += 1;
    }
  }
  Object.assign(results.summary, {
    changes_located_inline: `${located}/${total}`,
    register_model_agrees_with_label: `${modelAgree}/${labelled}`,
    register_model_caught_informal: `${modelCaught}/${informal}`,
    register_combined_agrees_with_label: `${combAgree}/${labelled}`,
    register_combined_caught_informal: `${combCaught}/${informal}`,
  });
  delete results.summary.register_agrees_with_label;
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = join(here, "results.json");
  const results = JSON.parse(readFileSync(file, "utf8"));
  const { drafts } = JSON.parse(readFileSync(join(here, "drafts.json"), "utf8"));
  writeFileSync(file, JSON.stringify(derive(results, drafts), null, 2) + "\n");
  console.log(JSON.stringify(results.summary, null, 2));
}
