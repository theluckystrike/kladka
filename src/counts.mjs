// Local usage counts. Numbers only: no draft text, no names, no time of day.
// Stored in one JSON file on this machine, never sent anywhere.
// Shape: { "2026-11-01": { checks: 3, tasks: { landlord: 2, job: 1 }, targets: { pl: 3 }, new_person: 1 } }

import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_FILE = join(fileURLToPath(new URL("..", import.meta.url)), "data", "counts.json");
const TASK_KEYS = new Set(["job", "landlord", "school", "office"]);
const TARGET_KEYS = new Set(["pl", "en"]);

function countsFile() {
  return process.env.KLADKA_COUNTS_FILE || DEFAULT_FILE;
}

function enabled() {
  return process.env.KLADKA_COUNTS !== "0";
}

function readCounts(file = countsFile()) {
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function today(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// event: { type: "check", task, target } or { type: "new_person" }
function record(event, { file = countsFile(), now = new Date() } = {}) {
  if (!enabled()) return null;
  const all = readCounts(file);
  const day = (all[today(now)] ??= { checks: 0, tasks: {}, targets: {}, new_person: 0 });
  if (event.type === "check") {
    day.checks += 1;
    if (TASK_KEYS.has(event.task)) day.tasks[event.task] = (day.tasks[event.task] ?? 0) + 1;
    if (TARGET_KEYS.has(event.target)) day.targets[event.target] = (day.targets[event.target] ?? 0) + 1;
  } else if (event.type === "new_person") {
    day.new_person += 1;
  } else {
    return null;
  }
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2) + "\n");
  renameSync(tmp, file);
  return all;
}

export { record, readCounts, countsFile, today };
