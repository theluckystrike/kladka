// Fixed JSON schemas for model output, plus a small dependency-free validator.
// The same schema object is sent to llama-server (grammar-constrained decoding)
// and used here to validate what comes back.

const CHANGE_TYPES = ["grammar", "spelling", "vocabulary", "register", "punctuation", "word_order", "translation", "other"];
const REGISTER_LEVELS = ["too_informal", "ok", "too_formal"];
// Ukrainian text: starts with a Cyrillic letter or «, and contains no letters
// that exist only in Russian (ы э ъ ё). Quotes and backslashes are excluded so
// the grammar cannot break the JSON string; the model quotes with « ».
const UK_TEXT = "^[А-ЩЬЮЯҐЄІЇа-щьюяґєії«][^\"\\\\ыэъёЫЭЪЁ]*$";

const COACH_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["corrected", "register", "changes"],
  properties: {
    corrected: { type: "string", minLength: 1, maxLength: 6000 },
    // llama.cpp generates keys in this order. The corrected text comes first:
    // when Ukrainian notes came first, the model drifted into writing the
    // corrected text in Ukrainian.
    register: {
      type: "object",
      additionalProperties: false,
      required: ["level", "note_uk"],
      properties: {
        level: { type: "string", enum: REGISTER_LEVELS },
        note_uk: { type: "string", minLength: 1, maxLength: 600, pattern: UK_TEXT },
      },
    },
    changes: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "type", "why_uk"],
        properties: {
          from: { type: "string", maxLength: 400 },
          to: { type: "string", maxLength: 400 },
          type: { type: "string", enum: CHANGE_TYPES },
          why_uk: { type: "string", minLength: 1, maxLength: 600, pattern: UK_TEXT },
        },
      },
    },
  },
});

const BACK_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["uk"],
  properties: { uk: { type: "string", minLength: 1, maxLength: 8000 } },
});

// Validate a value against the subset of JSON Schema used above.
function validate(schema, value, path = "$") {
  const errors = [];
  const t = schema.type;
  if (t === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return [`${path}: expected object`];
    }
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}.${key}: missing`);
    }
    for (const [key, v] of Object.entries(value)) {
      const sub = schema.properties?.[key];
      if (!sub) {
        if (schema.additionalProperties === false) errors.push(`${path}.${key}: unexpected property`);
        continue;
      }
      errors.push(...validate(sub, v, `${path}.${key}`));
    }
  } else if (t === "array") {
    if (!Array.isArray(value)) return [`${path}: expected array`];
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
    value.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
  } else if (t === "string") {
    if (typeof value !== "string") return [`${path}: expected string`];
    if (schema.minLength !== undefined && value.trim().length < schema.minLength) errors.push(`${path}: too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: too long`);
    if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not one of ${schema.enum.join("|")}`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${path}: does not match pattern`);
  }
  return errors;
}

const CYRILLIC = /[\u0400-\u04FF]/;
const CYRILLIC_ALL = /[\u0400-\u04FF]/g;
const RUSSIAN_ONLY = /[ыэъёЫЭЪЁ]/;

// Content checks the schema cannot express: right language in the right field.
function contentChecks(coach, target) {
  const problems = [];
  const cyr = (coach.corrected.match(CYRILLIC_ALL) ?? []).length;
  if (cyr > 0) problems.push(`corrected text contains ${cyr} Cyrillic characters (target ${target})`);
  coach.changes.forEach((c, i) => {
    if (!CYRILLIC.test(c.why_uk) || RUSSIAN_ONLY.test(c.why_uk)) problems.push(`changes[${i}].why_uk is not in Ukrainian`);
  });
  if (!CYRILLIC.test(coach.register.note_uk) || RUSSIAN_ONLY.test(coach.register.note_uk)) {
    problems.push("register.note_uk is not in Ukrainian");
  }
  return problems;
}

// Problems that make the answer unusable, so the pipeline retries.
function fatalProblems(coach, draft) {
  const out = [];
  const letters = (coach.corrected.match(/\p{L}/gu) ?? []).length || 1;
  const cyr = (coach.corrected.match(CYRILLIC_ALL) ?? []).length;
  if (cyr / letters > 0.2) out.push("corrected text is not in the target language");
  if (coach.corrected.trim().length < 0.5 * draft.trim().length) out.push("corrected text is much shorter than the draft (truncated)");
  return out;
}

// Drop changes that change nothing and exact duplicates. Returns the number dropped.
// The model often wraps fragments in « » or quotes copied from the prompt.
function unquote(text) {
  return text.trim().replace(/^[«"'„“]+/, "").replace(/[»"'”]+$/, "").trim();
}

function cleanChanges(coach) {
  const seen = new Set();
  const before = coach.changes.length;
  for (const c of coach.changes) {
    c.from = unquote(c.from);
    c.to = unquote(c.to);
  }
  coach.changes = coach.changes.filter((c) => {
    const key = `${c.from.trim()}\u0000${c.to.trim()}`;
    if (c.from.trim() === c.to.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return before - coach.changes.length;
}

// Parse model text into JSON. Tolerates code fences or text around one object.
function parseModelJson(text) {
  if (typeof text !== "string") return { ok: false, error: "no text" };
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    return { ok: true, value: JSON.parse(trimmed), repaired: trimmed !== text.trim() };
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return { ok: true, value: JSON.parse(trimmed.slice(start, end + 1)), repaired: true };
      } catch (e) {
        return { ok: false, error: `JSON parse failed: ${e.message}` };
      }
    }
    return { ok: false, error: "no JSON object found" };
  }
}

export { COACH_SCHEMA, BACK_SCHEMA, CHANGE_TYPES, REGISTER_LEVELS, UK_TEXT, validate, contentChecks, fatalProblems, cleanChanges, unquote, parseModelJson };
