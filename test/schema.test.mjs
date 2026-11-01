import { test } from "node:test";
import assert from "node:assert/strict";
import { COACH_SCHEMA, BACK_SCHEMA, validate, contentChecks, parseModelJson } from "../src/schema.mjs";
import { grammarSchema, llmBaseUrl } from "../src/pipeline.mjs";

const good = {
  corrected: "Szanowny Panie, uprzejmie proszę o naprawę ogrzewania.",
  changes: [{ from: "Szanowny Pan", to: "Szanowny Panie", type: "grammar", why_uk: "У звертанні потрібен кличний відмінок." }],
  register: { level: "too_informal", note_uk: "Чернетка звучала занадто розмовно." },
};

test("valid coach output passes", () => {
  assert.deepEqual(validate(COACH_SCHEMA, good), []);
  assert.deepEqual(contentChecks(good, "pl"), []);
});

test("missing field is reported", () => {
  const { register, ...rest } = good;
  assert.ok(validate(COACH_SCHEMA, rest).some((e) => e.includes("register: missing")));
});

test("wrong enum and wrong type are reported", () => {
  const bad = structuredClone(good);
  bad.register.level = "casual";
  bad.changes[0].type = 7;
  const errs = validate(COACH_SCHEMA, bad);
  assert.ok(errs.some((e) => e.includes("level: not one of")));
  assert.ok(errs.some((e) => e.includes("type: expected string")));
});

test("unexpected property and too many changes are reported", () => {
  const bad = structuredClone(good);
  bad.extra = 1;
  bad.changes = Array.from({ length: 9 }, () => good.changes[0]);
  const errs = validate(COACH_SCHEMA, bad);
  assert.ok(errs.some((e) => e.includes("unexpected property")));
  assert.ok(errs.some((e) => e.includes("more than 8")));
});

test("empty corrected text fails minLength", () => {
  const bad = { ...good, corrected: "   " };
  assert.ok(validate(COACH_SCHEMA, bad).some((e) => e.includes("corrected: too short")));
});

test("content checks catch Cyrillic in output and English explanations", () => {
  const bad = structuredClone(good);
  bad.corrected = "Szanowny Panie, маємо problem.";
  bad.changes[0].why_uk = "Vocative case is needed.";
  const p = contentChecks(bad, "pl");
  assert.equal(p.length, 2);
});

test("back-translation schema", () => {
  assert.deepEqual(validate(BACK_SCHEMA, { uk: "Шановний пане" }), []);
  assert.ok(validate(BACK_SCHEMA, {}).length > 0);
});

test("parseModelJson handles plain, fenced and wrapped JSON", () => {
  assert.equal(parseModelJson('{"uk":"так"}').value.uk, "так");
  const fenced = parseModelJson('```json\n{"uk":"так"}\n```');
  assert.equal(fenced.value.uk, "так");
  assert.equal(fenced.repaired, true);
  assert.equal(parseModelJson('Here: {"uk":"так"} done').value.uk, "так");
  assert.equal(parseModelJson("not json").ok, false);
  assert.equal(parseModelJson('{"uk": "unterminated').ok, false);
});

test("grammar schema drops length limits but keeps structure", () => {
  const g = grammarSchema(COACH_SCHEMA);
  assert.equal(JSON.stringify(g).includes("Length"), false);
  assert.equal(g.properties.changes.maxItems, 8);
  assert.deepEqual(g.properties.register.properties.level.enum, ["too_informal", "ok", "too_formal"]);
});

test("model URL must be local", () => {
  const old = process.env.KLADKA_LLM_URL;
  try {
    process.env.KLADKA_LLM_URL = "http://127.0.0.1:9999";
    assert.equal(llmBaseUrl(), "http://127.0.0.1:9999");
    process.env.KLADKA_LLM_URL = "https://api.example.com";
    assert.throws(() => llmBaseUrl(), /this machine/);
  } finally {
    if (old === undefined) delete process.env.KLADKA_LLM_URL; else process.env.KLADKA_LLM_URL = old;
  }
});

test("curated rule reasons replace model reasons when a change covers a rule hit", async () => {
  const { attachRuleReasons } = await import("../src/pipeline.mjs");
  const changes = [
    { from: "u mnie w kwatera", to: "w moim mieszkaniu", type: "vocabulary", why_uk: "Модельне пояснення." },
    { from: "bo", to: "ponieważ", type: "vocabulary", why_uk: "Інше пояснення." },
  ];
  const findings = [{ ruleId: "pl-ff-kwatera", category: "vocabulary", matched: "kwatera", why_uk: "Хибний друг перекладача." }];
  attachRuleReasons(changes, findings);
  assert.equal(changes[0].why_uk, "Хибний друг перекладача.");
  assert.equal(changes[0].rule_id, "pl-ff-kwatera");
  assert.equal(changes[0].why_model_uk, "Модельне пояснення.");
  assert.equal(changes[1].why_uk, "Інше пояснення.");
});

test("cleanChanges strips quotes, drops no-op and duplicate changes", async () => {
  const { cleanChanges } = await import("../src/schema.mjs");
  const coach = { changes: [
    { from: "«kwatera»", to: "«mieszkanie»", type: "vocabulary", why_uk: "х" },
    { from: "kwatera", to: "mieszkanie", type: "vocabulary", why_uk: "х" },
    { from: "Oksana", to: "Oksana", type: "other", why_uk: "х" },
  ] };
  assert.equal(cleanChanges(coach), 2);
  assert.deepEqual(coach.changes.map((c) => [c.from, c.to]), [["kwatera", "mieszkanie"]]);
});
