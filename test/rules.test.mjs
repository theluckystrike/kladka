import { test } from "node:test";
import assert from "node:assert/strict";
import { RULES, runRules, buildRule, rx, keepCase } from "../src/rules.mjs";

const ids = (text, target) => runRules(text, target).findings.map((f) => f.ruleId);

test("all rules load, have unique ids and Ukrainian explanations", () => {
  assert.ok(RULES.length >= 40);
  assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length);
  for (const r of RULES) assert.match(r.why, /[Ѐ-ӿ]/, r.id);
});

test("buildRule rejects a rule without a Ukrainian explanation", () => {
  assert.throws(() => buildRule({ id: "x", lang: "pl", pattern: /a/g, message: "m", why: "english only", severity: "info", category: "grammar" }));
});

test("unicode word boundary works with Polish letters", () => {
  const r = rx("\\bżółw\\b");
  assert.equal("Mój żółw śpi".match(r)?.[0], "żółw");
  assert.equal("żółwik".match(r), null);
});

test("keepCase keeps an initial capital", () => {
  assert.equal(keepCase("Prosze", "proszę"), "Proszę");
  assert.equal(keepCase("prosze", "proszę"), "proszę");
});

test("Polish formal address: Szanowny Pan becomes vocative", () => {
  const r = runRules("Szanowny Pan, piszę w sprawie mieszkania.", "pl");
  assert.ok(r.findings.some((f) => f.ruleId === "pl-szanowny-pan-vocative"));
  assert.match(r.fixedText, /^Szanowny Panie,/);
});

test("Polish: Szanowna Pani is not flagged, Szanowny Pani is", () => {
  assert.ok(!ids("Szanowna Pani, dziękuję.", "pl").includes("pl-szanowny-pani-agreement"));
  assert.ok(ids("Szanowny Pani Dyrektor", "pl").includes("pl-szanowny-pani-agreement"));
});

test("Polish case government fixes", () => {
  const r = runRules("Szukam pracę. Czekam Pana odpowiedzi. Mnie 34 lata.", "pl");
  assert.match(r.fixedText, /Szukam pracy/);
  assert.match(r.fixedText, /Czekam na Pana odpowiedź/);
  assert.match(r.fixedText, /Mam 34 lata/);
});

test("Polish false friends are flagged without auto-fix", () => {
  const r = runRules("Moja kwatera jest zimna. Złożyłam zajawę i chcę oformić dokumenty.", "pl");
  const got = r.findings.map((f) => f.ruleId);
  for (const id of ["pl-ff-kwatera", "pl-ff-zajawa", "pl-ff-oformic"]) assert.ok(got.includes(id), id);
  for (const f of r.findings.filter((x) => x.category === "vocabulary")) assert.equal(f.fix, null);
});

test("Polish register: cześć and ty-forms are flagged", () => {
  const got = ids("Cześć, możesz mi pomóc?", "pl");
  assert.ok(got.includes("pl-informal-greeting"));
  assert.ok(got.includes("pl-ty-form-to-stranger"));
});

test("Polish diacritics fixed, correct words untouched", () => {
  const r = runRules("Prosze o odpowiedź. Dziekuje i pozdrawiam sie.", "pl");
  assert.equal(r.fixedText, "Proszę o odpowiedź. Dziękuję i pozdrawiam się.");
  assert.equal(runRules("Proszę o wynagrodzenie. Z poważaniem", "pl").findings.length, 0);
});

test("po telefonie becomes przez telefon", () => {
  assert.match(runRules("Dzwoniłam po telefonu.", "pl").fixedText, /przez telefon/);
});

test("English calques of Ukrainian speakers", () => {
  const r = runRules("I am agree. I have 34 years. It depends from him. I work like a teacher since three years.", "en");
  assert.match(r.fixedText, /I agree/);
  assert.match(r.fixedText, /I am 34 years old/);
  assert.match(r.fixedText, /depends on/);
  assert.match(r.fixedText, /work as a teacher/);
  assert.match(r.fixedText, /for three years/);
});

test("years of experience is not mistaken for age", () => {
  assert.ok(!ids("I have 12 years experience as a nurse.", "en").includes("en-have-years"));
  assert.ok(!ids("I have 5 years of experience.", "en").includes("en-have-years"));
  assert.ok(ids("I have 34 years, I live in Wrocław.", "en").includes("en-have-years"));
});

test("English articles", () => {
  const r = runRules("I went to office for a interview. I am accountant.", "en");
  assert.match(r.fixedText, /to the office/);
  assert.match(r.fixedText, /an interview/);
  assert.match(r.fixedText, /I am an accountant/);
});

test("English false friend accurate is flagged, accurate data is not", () => {
  assert.ok(ids("I am very accurate and responsible.", "en").includes("en-ff-accurate"));
  assert.ok(!ids("The data is accurate.", "en").includes("en-ff-accurate"));
});

test("English double negative", () => {
  assert.ok(ids("I don't know nothing about it.", "en").includes("en-double-negative"));
});

test("rules are scoped by target language", () => {
  assert.ok(!ids("I am agree", "pl").includes("en-am-agree"));
  assert.ok(!ids("Szanowny Pan", "en").includes("pl-szanowny-pan-vocative"));
});

test("Cyrillic fragments are reported for both targets", () => {
  assert.ok(ids("Andrij nie będzie bo маємо візит у лікаря.", "pl").includes("any-cyrillic-left"));
  assert.ok(ids("We have візит tomorrow.", "en").includes("any-cyrillic-left"));
});

test("overlapping fixes are resolved by the second pass", () => {
  assert.equal(runRules("Dziękuję dziękuję .", "pl").fixedText, "Dziękuję.");
  assert.equal(runRules("I work like a accountant.", "en").fixedText, "I work as an accountant.");
});

test("clean text gives no findings", () => {
  assert.equal(runRules("Dear Ms Smith, I would like to apply for the position of accountant.", "en").findings.length, 0);
  assert.equal(runRules("Szanowna Pani, uprzejmie proszę o informację w sprawie wniosku.", "pl").findings.length, 0);
});

test("runRules validates its input", () => {
  assert.throws(() => runRules(42, "pl"), TypeError);
  assert.throws(() => runRules("x", "de"), TypeError);
});
