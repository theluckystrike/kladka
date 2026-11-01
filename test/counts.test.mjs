import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { record } from "../src/counts.mjs";

test("counts store numbers per day and never text", () => {
  const dir = mkdtempSync(join(tmpdir(), "kladka-counts-"));
  const file = join(dir, "counts.json");
  try {
    const now = new Date("2026-11-01T10:00:00Z");
    record({ type: "check", task: "landlord", target: "pl", draft: "SECRET TEXT" }, { file, now });
    record({ type: "check", task: "job", target: "en" }, { file, now });
    record({ type: "new_person" }, { file, now });
    record({ type: "unknown" }, { file, now });
    const raw = readFileSync(file, "utf8");
    assert.equal(raw.includes("SECRET"), false);
    const day = JSON.parse(raw)["2026-11-01"];
    assert.deepEqual(day, { checks: 2, tasks: { landlord: 1, job: 1 }, targets: { pl: 1, en: 1 }, new_person: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
