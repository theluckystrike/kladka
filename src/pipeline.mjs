// The checking pipeline: rules first, then the local model (two calls),
// then validation. Used by the web server and by the eval script.

import { runRules } from "./rules.mjs";
import { TASKS, TARGETS } from "./tasks.mjs";
import { COACH_SCHEMA, BACK_SCHEMA, validate, contentChecks, fatalProblems, cleanChanges, parseModelJson } from "./schema.mjs";

const DEFAULT_LLM_URL = "http://127.0.0.1:8080";
const MAX_DRAFT_CHARS = 4000;

// Privacy guard: the model endpoint must be on this machine.
function llmBaseUrl() {
  const raw = process.env.KLADKA_LLM_URL || DEFAULT_LLM_URL;
  const u = new URL(raw);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`KLADKA_LLM_URL must point to this machine (127.0.0.1), got ${host}`);
  }
  return u.origin;
}

// llama.cpp turns the schema into a grammar. Long length limits make that
// grammar huge, so lengths are checked locally instead of sent.
function grammarSchema(schema) {
  if (Array.isArray(schema)) return schema.map(grammarSchema);
  if (schema === null || typeof schema !== "object") return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "minLength" || k === "maxLength") continue;
    out[k] = grammarSchema(v);
  }
  return out;
}

function coachMessages(task, target, draft, findings) {
  const t = TASKS[task];
  const lang = TARGETS[target].name;
  const hints = findings
    .filter((f) => f.category !== "script")
    .slice(0, 12)
    .map((f) => `- «${f.matched}»${f.fix ? ` → «${f.fix}»` : ""}: ${f.why_uk}`)
    .join("\n");
  const system = [
    `You are a careful writing coach for Ukrainian speakers who live in Poland.`,
    `The user wrote a draft of: ${t.label}. The reader is ${t.reader}.`,
    `Target language: ${lang}. ${t.guidance}${target === "en" ? " The target is English: use the English equivalents of these conventions (Dear Ms/Mr Surname or Dear Sir or Madam, Yours sincerely or Kind regards)." : ""}`,
    ``,
    `Fill the JSON fields in this order:`,
    `1. "corrected": the full letter rewritten IN ${lang.toUpperCase()} as correct, natural, polite ${lang} for this reader. Use \\n for line breaks. Keep the meaning and every fact (names, dates, numbers, amounts, addresses, case numbers) exactly as written. Keep the greeting and the writer's name or signature at the end. Do not add facts, addresses, numbers or promises that are not in the draft. If parts are written in Ukrainian, Russian or another language, translate them into ${lang}. The corrected text must be entirely in ${lang} and contain no Cyrillic letters.`,
    `2. "register": judge the ORIGINAL draft, before your corrections, for this reader. "level" is too_informal (for example a greeting like Cześć/Hi, ty-forms, slang, no polite formulas), ok, or too_formal (rare). "note_uk": one or two sentences in Ukrainian.`,
    `3. "changes": the most important real corrections, at most 6, no duplicates, never a fragment that stayed the same. "from" is the original fragment, "to" is the new fragment, "type" is one of grammar, spelling, vocabulary, register, punctuation, word_order, translation, other. "why_uk": one short sentence (at most 25 words) in Ukrainian (українською мовою, not Russian) that explains the rule. Quote words with « ». Where it applies, name the typical mistake of Ukrainian speakers: Polish case endings and prepositions, verb aspect, missing English articles, false friends between Ukrainian and ${lang}, formal address (Pan/Pani, Dear Mr/Ms).`,
    ``,
    `Each why_uk must explain that specific change. Never reuse the same sentence for different changes. If you are not sure of the grammar rule, say plainly what sounds more natural.`,
    `All explanations (note_uk, why_uk) must be in Ukrainian. Answer with one JSON object only.`,
  ].join("\n");
  const ask = `Rewrite this draft as a ${lang} letter, then explain the changes in Ukrainian.`;
  const user = hints
    ? `Перевірка правилами вже знайшла (список може бути неповним):\n${hints}\n\n${ask}\nDraft:\n${draft}`
    : `${ask}\nDraft:\n${draft}`;
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

function backMessages(target, text) {
  const lang = TARGETS[target].name;
  return [
    {
      role: "system",
      content: `Translate the ${lang} text into Ukrainian. Translate faithfully and literally: do not improve, shorten, explain or add anything. Answer with one JSON object: {"uk": "<translation>"}.`,
    },
    { role: "user", content: text },
  ];
}

async function chat(messages, schema, { maxTokens, timeoutMs, constrained = true, seed = 42 }) {
  const body = {
    messages,
    temperature: 0.2,
    top_p: 0.9,
    seed,
    max_tokens: maxTokens,
    cache_prompt: true,
  };
  if (constrained) {
    body.response_format = { type: "json_schema", json_schema: { name: "out", schema: grammarSchema(schema) } };
  }
  const t0 = performance.now();
  const res = await fetch(`${llmBaseUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const seconds = (performance.now() - t0) / 1000;
  if (!res.ok) throw new Error(`llama-server HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  const tm = data.timings ?? {};
  return {
    text,
    finish: data.choices?.[0]?.finish_reason ?? null,
    seconds,
    promptTokens: tm.prompt_n ?? data.usage?.prompt_tokens ?? null,
    genTokens: tm.predicted_n ?? data.usage?.completion_tokens ?? null,
    genTokPerSec: tm.predicted_per_second ?? null,
    promptTokPerSec: tm.prompt_per_second ?? null,
  };
}

// One model step with validation. Up to three attempts: grammar-constrained,
// constrained with another seed, then unconstrained. Later attempts run only
// when the earlier answer fails the schema or a fatal check.
const ATTEMPTS = [
  { constrained: true, seed: 42 },
  { constrained: true, seed: 7 },
  { constrained: false, seed: 42 },
];

async function modelStep(messages, schema, opts, { check, fatal } = {}) {
  const attempts = [];
  for (const plan of ATTEMPTS) {
    let r;
    try {
      r = await chat(messages, schema, { ...opts, ...plan });
    } catch (e) {
      attempts.push({ ...plan, error: e.message });
      if (e.name === "TimeoutError" || /ECONNREFUSED|fetch failed/.test(e.message)) break;
      continue;
    }
    const parsed = parseModelJson(r.text);
    let errors = parsed.ok ? validate(schema, parsed.value) : [parsed.error];
    if (errors.length === 0 && fatal) errors = fatal(parsed.value);
    const info = { ...plan, seconds: r.seconds, promptTokens: r.promptTokens, genTokens: r.genTokens,
      genTokPerSec: r.genTokPerSec, promptTokPerSec: r.promptTokPerSec, finish: r.finish, schemaErrors: errors };
    if (errors.length === 0) {
      if (Array.isArray(parsed.value.changes)) info.changesDropped = cleanChanges(parsed.value);
      info.contentProblems = check ? check(parsed.value) : [];
      attempts.push(info);
      return { ok: true, value: parsed.value, attempts };
    }
    info.rawPreview = r.text.slice(0, 300);
    attempts.push(info);
  }
  return { ok: false, value: null, attempts };
}

async function modelHealth() {
  try {
    const res = await fetch(`${llmBaseUrl()}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

// Register = the model's judgement, overridden to too_informal when a
// register rule (informal greeting, ty-form) fired. In testing the model alone
// rated clearly informal drafts as "ok".
function combinedRegister(modelLevel, registerRuleIds) {
  return registerRuleIds.length > 0 ? "too_informal" : modelLevel;
}

// When a model change covers a fragment the rule engine flagged, show the
// curated Ukrainian explanation instead of the model's own.
function attachRuleReasons(changes, findings) {
  for (const c of changes) {
    const from = c.from.toLowerCase();
    const f = findings.find((x) => x.category !== "script" && from.includes(x.matched.toLowerCase()));
    if (f) {
      c.why_model_uk = c.why_uk;
      c.why_uk = f.why_uk;
      c.rule_id = f.ruleId;
    }
  }
}

function checkInput({ task, target, draft }) {
  if (!TASKS[task]) throw new RangeError(`unknown task: ${task}`);
  if (!TARGETS[target]) throw new RangeError(`unknown target: ${target}`);
  if (typeof draft !== "string" || draft.trim().length === 0) throw new RangeError("draft is empty");
  if (draft.length > MAX_DRAFT_CHARS) throw new RangeError(`draft longer than ${MAX_DRAFT_CHARS} characters`);
}

function rulesOnly(input) {
  checkInput(input);
  return runRules(input.draft, input.target);
}

/**
 * Full pipeline. Always returns the rule results; model results are added
 * when llama-server answers and the output validates.
 */
async function coach(input, { timeoutMs = 180000, backTranslate = true } = {}) {
  checkInput(input);
  const { task, target, draft } = input;
  const t0 = performance.now();
  const rules = runRules(draft, target);
  const result = { rules, model: null, back: null, errors: [] };

  if (!(await modelHealth())) {
    result.errors.push("Local model is not running. Showing rule checks only.");
    result.seconds = (performance.now() - t0) / 1000;
    return result;
  }
  const maxTokens = 2048;
  const step1 = await modelStep(coachMessages(task, target, draft, rules.findings), COACH_SCHEMA,
    { maxTokens, timeoutMs }, { check: (v) => contentChecks(v, target), fatal: (v) => fatalProblems(v, draft) });
  result.model = step1;
  if (step1.ok) {
    attachRuleReasons(step1.value.changes, rules.findings);
    const regHits = rules.findings.filter((f) => f.category === "register" && f.severity === "warning");
    result.register = {
      level: combinedRegister(step1.value.register.level, regHits.map((f) => f.ruleId)),
      model_level: step1.value.register.level,
      rule_hits: [...new Set(regHits.map((f) => f.matched))],
    };
  }
  if (step1.ok) {
    // Safety net: numbers in the corrected text that were not in the draft.
    const nums = (t) => new Set(t.match(/\d+/g) ?? []);
    const had = nums(draft);
    result.newNumbers = [...nums(step1.value.corrected)].filter((n) => !had.has(n));
    // Placeholders such as [Your Name] that the writer must fill or delete.
    result.placeholders = step1.value.corrected.match(/\[[^\]\n]{2,40}\]/g) ?? [];
  }
  if (!step1.ok) {
    result.errors.push("The model answer could not be validated. Showing rule checks only.");
  } else if (backTranslate) {
    const step2 = await modelStep(backMessages(target, step1.value.corrected), BACK_SCHEMA,
      { maxTokens: Math.min(2048, 300 + Math.ceil(step1.value.corrected.length * 1.5)), timeoutMs },
      { fatal: (v) => (/[\u0400-\u04FF]/.test(v.uk) ? [] : ["back translation is not in Ukrainian"]) });
    if (step2.ok) step2.value.uk = step2.value.uk.replace(/<\/?translation>/g, "").trim();
    result.back = step2;
    if (!step2.ok) result.errors.push("Back-translation failed validation.");
  }
  result.seconds = (performance.now() - t0) / 1000;
  return result;
}

export { coach, rulesOnly, attachRuleReasons, combinedRegister, modelHealth, llmBaseUrl, grammarSchema, coachMessages, backMessages, MAX_DRAFT_CHARS };
