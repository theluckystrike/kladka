// Runs the synthetic eval set through the full pipeline and records real
// measurements. Requires llama-server running on 127.0.0.1 (see README).
// Usage: node eval/run.mjs [--limit N] [--out file.json]

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { cpus, totalmem, platform, release } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { coach, rulesOnly, modelHealth, llmBaseUrl } from "../src/pipeline.mjs";
import { derive } from "./derive.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const { drafts } = JSON.parse(readFileSync(join(here, "drafts.json"), "utf8"));
const limitArg = process.argv.indexOf("--limit");
const outArg = process.argv.indexOf("--out");
const outFile = outArg > 0 ? process.argv[outArg + 1] : join(here, "results.json");
const set = limitArg > 0 ? drafts.slice(0, Number(process.argv[limitArg + 1])) : drafts;

function sh(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: "utf8", timeout: 10000 }).trim(); } catch { return null; }
}
function llamaPid() {
  const port = new URL(llmBaseUrl()).port || "80";
  const out = sh("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  return out ? Number(out.split("\n")[0]) : null;
}
function rssMb(pid) {
  const out = pid ? sh("ps", ["-o", "rss=", "-p", String(pid)]) : null;
  return out ? Math.round(Number(out) / 1024) : null;
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const r2 = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 100) / 100);

if (!(await modelHealth())) {
  console.error("llama-server is not answering on", llmBaseUrl());
  process.exit(1);
}
const pid = llamaPid();
const rssIdle = rssMb(pid);
let rssPeak = rssIdle ?? 0;
const sampler = setInterval(() => { const v = rssMb(pid); if (v && v > rssPeak) rssPeak = v; }, 500);

const rows = [];
for (const d of set) {
  const tr0 = performance.now();
  const rules = rulesOnly(d);
  const rulesMs = performance.now() - tr0;
  const got = new Set(rules.findings.map((f) => f.ruleId));
  const r = await coach(d);
  const a1 = r.model?.attempts?.[0];
  const aLast = r.model?.attempts?.at(-1);
  const b1 = r.back?.attempts?.[0];
  const corrected = r.model?.ok ? r.model.value.corrected : null;
  const factsKept = corrected ? d.facts.filter((f) => corrected.includes(f)) : [];
  const row = {
    id: d.id, task: d.task, target: d.target,
    rules: { hits: rules.findings.length, ms: r2(rulesMs), ids: [...got],
      expected: d.expect_rules.length, expected_found: d.expect_rules.filter((x) => got.has(x)).length },
    coach: {
      ok: !!r.model?.ok,
      valid_first_try: !!(a1 && !a1.error && a1.schemaErrors?.length === 0),
      attempts: r.model?.attempts?.length ?? 0,
      content_problems: aLast?.contentProblems ?? null,
      seconds: r2(aLast?.seconds), prompt_tokens: aLast?.promptTokens ?? null, gen_tokens: aLast?.genTokens ?? null,
      gen_tok_per_s: r2(aLast?.genTokPerSec), prompt_tok_per_s: r2(aLast?.promptTokPerSec), finish: aLast?.finish ?? null,
      errors: r.model?.attempts?.filter((x) => x.error || x.schemaErrors?.length).map((x) => x.error ?? x.schemaErrors.slice(0, 3)) ?? [],
      changes: r.model?.ok ? r.model.value.changes.length : null,
      register: r.model?.ok ? r.model.value.register.level : null,
      expect_register: d.expect_register ?? null,
      reasons_from_rules: r.model?.ok ? r.model.value.changes.filter((c) => c.rule_id).length : 0,
    },
    back: {
      ok: !!r.back?.ok,
      valid_first_try: !!(b1 && !b1.error && b1.schemaErrors?.length === 0),
      seconds: r2(r.back?.attempts?.at(-1)?.seconds), gen_tokens: r.back?.attempts?.at(-1)?.genTokens ?? null,
      gen_tok_per_s: r2(r.back?.attempts?.at(-1)?.genTokPerSec),
    },
    new_numbers: r.newNumbers ?? [],
    facts: { total: d.facts.length, kept: factsKept.length, missing: d.facts.filter((f) => !factsKept.includes(f)) },
    seconds_total: r2(r.seconds),
    output: r.model?.ok ? { corrected, changes: r.model.value.changes, register: r.model.value.register,
      back_translation_uk: r.back?.ok ? r.back.value.uk : null } : null,
  };
  rows.push(row);
  console.log(`${d.id}: ${row.seconds_total}s coach=${row.coach.ok ? "ok" : "FAIL"} ${row.coach.gen_tok_per_s ?? "-"} tok/s back=${row.back.ok ? "ok" : "FAIL"} facts ${row.facts.kept}/${row.facts.total} rules ${row.rules.hits}`);
}
clearInterval(sampler);

const okRows = rows.filter((x) => x.coach.ok);
const tps = rows.flatMap((x) => [x.coach.gen_tok_per_s, x.back.gen_tok_per_s]).filter((x) => x);
const secs = rows.map((x) => x.seconds_total);
const summary = {
  drafts: rows.length,
  coach_json_valid_first_try: `${rows.filter((x) => x.coach.valid_first_try).length}/${rows.length}`,
  coach_json_valid_after_fallback: `${okRows.length}/${rows.length}`,
  coach_content_checks_clean: `${okRows.filter((x) => x.coach.content_problems?.length === 0).length}/${okRows.length}`,
  back_json_valid_first_try: `${rows.filter((x) => x.back.valid_first_try).length}/${okRows.length}`,
  drafts_with_invented_numbers: `${okRows.filter((x) => x.new_numbers.length > 0).length}/${okRows.length}`,
  changes_total: okRows.reduce((s, x) => s + x.coach.changes, 0),
  changes_with_rule_reason: okRows.reduce((s, x) => s + x.coach.reasons_from_rules, 0),
  facts_preserved: `${rows.reduce((s, x) => s + x.facts.kept, 0)}/${rows.reduce((s, x) => s + x.facts.total, 0)}`,
  seconds_per_draft_median: r2(median(secs)),
  seconds_per_draft_mean: r2(mean(secs)),
  seconds_per_draft_p90: r2(pct(secs, 90)),
  seconds_per_draft_max: r2(Math.max(...secs)),
  gen_tokens_per_second_mean: r2(mean(tps)),
  gen_tokens_per_second_min: r2(Math.min(...tps)),
  prompt_tokens_per_second_mean: r2(mean(rows.map((x) => x.coach.prompt_tok_per_s).filter((x) => x))),
  llama_server_rss_mb_idle: rssIdle,
  llama_server_rss_mb_peak: rssPeak || null,
  node_rss_mb_peak: Math.round(process.memoryUsage().rss / 1048576),
  rule_hits_total: rows.reduce((s, x) => s + x.rules.hits, 0),
  rule_expected_found: `${rows.reduce((s, x) => s + x.rules.expected_found, 0)}/${rows.reduce((s, x) => s + x.rules.expected, 0)}`,
  rules_ms_max: r2(Math.max(...rows.map((x) => x.rules.ms))),
};

const results = {
  generated_at: new Date().toISOString(),
  note: "Real measurements from one run on the machine below. Test drafts are synthetic (eval/drafts.json).",
  machine: { platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model, cores: cpus().length, ram_gb: Math.round(totalmem() / 2 ** 30) },
  llama_server: { version: (() => { const r = spawnSync("llama-server", ["--version"], { encoding: "utf8", timeout: 10000 }); return `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").filter((l) => /version/i.test(l)).join(" ").trim() || null; })(), url: llmBaseUrl() },
  model: process.env.KLADKA_MODEL_FILE ?? null,
  settings: { temperature: 0.2, top_p: 0.9, seed: 42, constrained_json: true, back_translation: true },
  summary,
  drafts: rows,
};
derive(results, drafts);
writeFileSync(outFile, JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
