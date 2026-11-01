// Kładka UI. Talks only to the local server it was loaded from.
// Coach mode: the writer's own text stays the base; model suggestions are
// shown inline and applied only when the writer accepts them.
"use strict";

const $ = (id) => document.getElementById(id);
const EXAMPLES = {
  landlord: { target: "pl", text: "Dzień dobry Pan Nowak,\nu mnie w kwatera nie działa ogrzewanie od 3 listopada. Dzwoniłam po telefonu dwa razy ale nikt nie odpowiedział. Proszę naprawić to szybko bo w mieszkaniu jest 14 stopni a u mnie jest mała dziecka.\nczekam odpowiedzi\nOksana Kovalenko" },
  school: { target: "pl", text: "Cześć, to mama Andrija z 3b. Andrij jutro nie będzie w szkole bo маємо візит у лікаря o 10:00. Możesz dać mi zadanie domowe? Dziekuje" },
  job: { target: "en", text: "Hello,\nI am write about vacancy of accountant in your company. I have 12 years experience, I worked like a chief accountant in Kharkiv since 2014 to 2022. I am very accurate and responsible. I know 1C and Excel, now I learn SAP.\nWaiting for your answer." },
  office: { target: "pl", text: "Szanowny Pan,\nprosze o wydanie zaświadczenia o niekaralności dla oformienia pracy. Mój numer PESEL 85031712345, sprawa nr WSO-II.6151.1234.2025. Ja już byłam w urzędzie 20.10 ale nie było mojej zajawy w systemie.\nDo widzenia\nNatalia Bondar" },
};
const SEVERITY_UK = { error: "помилка", warning: "увага", info: "порада" };
const LEVEL_UK = { too_informal: "Занадто неформально", ok: "Тон відповідний", too_formal: "Занадто офіційно" };
const TYPE_UK = { grammar: "граматика", spelling: "правопис", vocabulary: "слово", register: "тон", punctuation: "пунктуація", word_order: "порядок слів", translation: "переклад", other: "інше" };

let busy = false;
let idleMinutes = 15;
let lastActivity = Date.now();
// Current coach state: the draft that was checked and the located changes.
let state = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const currentTask = () => document.querySelector('input[name="task"]:checked')?.value ?? "job";
const currentTarget = () => document.querySelector('input[name="target"]:checked')?.value ?? "pl";
const show = (id, on = true) => { $(id).hidden = !on; };

async function loadTasks() {
  const data = await (await fetch("/api/tasks")).json();
  idleMinutes = data.idleMinutes || 15;
  $("idle-note").textContent = `Після ${idleMinutes} хв без дій усе очищується автоматично.`;
  const box = $("tasks");
  Object.entries(data.tasks).forEach(([key, t], i) => {
    const label = el("label", "task");
    const input = el("input");
    input.type = "radio"; input.name = "task"; input.value = key; input.checked = i === 0;
    label.append(input, el("span", "task-uk", t.label_uk), el("span", "task-en", t.label));
    box.append(label);
  });
}

async function health() {
  try {
    const d = await (await fetch("/api/health")).json();
    const s = $("model-status");
    s.textContent = d.model ? "Модель: працює локально" : "Модель вимкнена: лише правила";
    s.className = "pill " + (d.model ? "pill-ok" : "pill-off");
  } catch {
    $("model-status").textContent = "Сервер недоступний";
  }
}

function resetOutput() {
  ["rules-block", "coach-block", "result-block", "register-block", "full-block", "meaning-block", "errors", "progress"].forEach((id) => show(id, false));
  ["rules", "changes", "marked", "result", "corrected", "orig", "back", "errors"].forEach((id) => $(id).replaceChildren());
  $("full-block").open = false;
  $("timing").textContent = "";
  $("copied").textContent = "";
  state = null;
}

function addError(text) {
  $("errors").append(el("p", "", text));
  show("errors");
}

function renderRules(r) {
  show("empty", false);
  show("rules-block");
  $("rules-count").textContent = String(r.findings.length);
  const ul = $("rules");
  if (r.findings.length === 0) {
    ul.append(el("li", "muted", "Правила нічого не знайшли. Це не означає, що помилок немає."));
    return;
  }
  for (const f of r.findings) {
    const li = el("li", "finding sev-" + f.severity);
    const head = el("div", "finding-head");
    head.append(el("span", "tag", SEVERITY_UK[f.severity]), el("code", "matched", f.matched));
    if (f.fix) head.append(el("span", "arrow", "→"), el("code", "fix", f.fix));
    li.append(head, el("p", "why", f.why_uk));
    ul.append(li);
  }
}

// Find each change's "from" fragment in the draft. Overlapping or missing
// fragments cannot be applied inline and are marked as not located.
function locate(draft, changes) {
  const located = [];
  const taken = [];
  changes.forEach((c, i) => {
    const from = c.from.trim().replace(/^[«"'„“]+/, "").replace(/[»"'”]+$/, "").trim();
    let at = from ? draft.indexOf(from) : -1;
    if (at < 0 && from) at = draft.toLowerCase().indexOf(from.toLowerCase());
    const end = at + from.length;
    const overlaps = taken.some(([a, b]) => at < b && end > a);
    if (at >= 0 && !overlaps) {
      taken.push([at, end]);
      located.push({ ...c, i, at, len: from.length, status: "pending" });
    } else {
      located.push({ ...c, i, at: -1, len: 0, status: "unlocated" });
    }
  });
  return located;
}

function applyAccepted() {
  let out = state.draft;
  const acc = state.changes.filter((c) => c.at >= 0 && c.status === "accepted").sort((a, b) => b.at - a.at);
  for (const c of acc) out = out.slice(0, c.at) + c.to + out.slice(c.at + c.len);
  return out;
}

function renderCoach() {
  const marked = $("marked");
  marked.replaceChildren();
  const inline = state.changes.filter((c) => c.at >= 0).sort((a, b) => a.at - b.at);
  let pos = 0;
  for (const c of inline) {
    marked.append(document.createTextNode(state.draft.slice(pos, c.at)));
    const num = el("sup", "num", String(c.i + 1));
    if (c.status === "accepted") {
      marked.append(el("ins", "", c.to), num);
    } else if (c.status === "rejected") {
      marked.append(el("span", "kept", state.draft.slice(c.at, c.at + c.len)), num);
    } else {
      marked.append(el("del", "", state.draft.slice(c.at, c.at + c.len)), el("ins", "proposal", c.to), num);
    }
    pos = c.at + c.len;
  }
  marked.append(document.createTextNode(state.draft.slice(pos)));

  const ol = $("changes");
  ol.replaceChildren();
  for (const c of state.changes) {
    const li = el("li", "change st-" + c.status);
    li.value = c.i + 1;
    const head = el("div", "finding-head");
    head.append(el("span", "tag", TYPE_UK[c.type] ?? c.type));
    if (c.from) head.append(el("del", "", c.from), el("span", "arrow", "→"));
    head.append(el("ins", "", c.to));
    if (c.rule_id) head.append(el("span", "tag tag-rule", "пояснення з правила"));
    li.append(head, el("p", "why", c.why_uk));
    const row = el("div", "row tight");
    if (c.status === "unlocated") {
      row.append(el("span", "muted small", "Цього фрагмента немає у вашому тексті дослівно. Внесіть зміну вручну, якщо вона потрібна."));
    } else {
      const yes = el("button", c.status === "accepted" ? "small on" : "small", "Прийняти");
      const no = el("button", c.status === "rejected" ? "small on" : "small", "Відхилити");
      yes.setAttribute("aria-pressed", String(c.status === "accepted"));
      no.setAttribute("aria-pressed", String(c.status === "rejected"));
      yes.addEventListener("click", () => { c.status = "accepted"; renderCoach(); });
      no.addEventListener("click", () => { c.status = "rejected"; renderCoach(); });
      row.append(yes, no);
    }
    li.append(row);
    ol.append(li);
  }
  if (state.changes.length === 0) ol.append(el("li", "muted", "Модель не запропонувала змін."));
  $("result").textContent = applyAccepted();
  show("coach-block");
  show("result-block");
}

function setAll(status) {
  if (!state) return;
  state.changes.forEach((c) => { if (c.status !== "unlocated") c.status = status; });
  renderCoach();
}

function renderModel(data, draft) {
  (data.errors ?? []).forEach(addError);
  const m = data.model?.ok ? data.model.value : null;
  if (!m) {
    if (data.rules && data.rules.fixedText !== draft) {
      $("result").textContent = data.rules.fixedText;
      show("result-block");
      addError("Показано текст лише з автоматичними виправленнями правил.");
    }
    return;
  }
  if (data.newNumbers?.length) addError(`Увага: у повній версії є числа, яких не було у вашій чернетці: ${data.newNumbers.join(", ")}. Не копіюйте їх без перевірки.`);
  if (data.placeholders?.length) addError(`У повній версії є місця для заповнення: ${data.placeholders.join(", ")}.`);

  state = { draft, changes: locate(draft, m.changes) };
  renderCoach();

  const level = data.register?.level ?? m.register.level;
  $("register-level").textContent = LEVEL_UK[level] ?? level;
  $("register-level").className = "badge lvl-" + level;
  const ruleNote = data.register?.rule_hits?.length ? ` Правила знайшли неформальні елементи: ${data.register.rule_hits.join(", ")}.` : "";
  $("register-note").textContent = m.register.note_uk + ruleNote;
  show("register-block");

  $("corrected").textContent = m.corrected;
  $("target-label").textContent = currentTarget() === "pl" ? "(польська)" : "(англійська)";
  show("full-block");

  if (data.back?.ok) {
    $("orig").textContent = draft;
    $("back").textContent = data.back.value.uk;
    show("meaning-block");
  }
  const a = data.model.attempts.at(-1);
  const tps = a?.genTokPerSec ? `, ${a.genTokPerSec.toFixed(1)} токенів/с` : "";
  $("timing").textContent = `Готово за ${data.seconds.toFixed(1)} с${tps}. Усе пораховано на цьому комп’ютері.`;
}

async function post(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function check() {
  if (busy) return;
  const draft = $("draft").value;
  if (!draft.trim()) { $("draft").focus(); return; }
  busy = true;
  $("check").disabled = true;
  resetOutput();
  const input = { task: currentTask(), target: currentTarget(), draft };
  try {
    renderRules((await post("/api/rules", input)).rules);
    show("progress");
    const data = await post("/api/coach", input);
    show("progress", false);
    // Ignore a late answer if the screen was cleared meanwhile.
    if ($("draft").value === draft) renderModel(data, draft);
  } catch (e) {
    show("progress", false);
    addError("Помилка: " + e.message);
  } finally {
    busy = false;
    $("check").disabled = false;
    health();
  }
}

// Shared-laptop safety: wipe everything visible and any browser storage.
function clearAll() {
  $("draft").value = "";
  resetOutput();
  show("empty");
  const first = document.querySelector('input[name="task"]');
  if (first) first.checked = true;
  document.querySelector('input[name="target"][value="pl"]').checked = true;
  try { localStorage.clear(); } catch { /* storage may be blocked */ }
  try { sessionStorage.clear(); } catch { /* storage may be blocked */ }
  updateCounter();
}

async function newPerson() {
  clearAll();
  try { await post("/api/new-person", {}); } catch { /* counting is optional */ }
  $("draft").focus();
}

function example() {
  const ex = EXAMPLES[currentTask()];
  $("draft").value = ex.text;
  document.querySelector(`input[name="target"][value="${ex.target}"]`).checked = true;
  updateCounter();
}

function updateCounter() {
  $("counter").textContent = `${$("draft").value.length} / 4000`;
}

function touch() { lastActivity = Date.now(); }
setInterval(() => {
  const hasContent = $("draft").value.length > 0 || state !== null;
  if (!busy && hasContent && Date.now() - lastActivity > idleMinutes * 60000) clearAll();
}, 20000);
["keydown", "pointerdown", "input", "wheel"].forEach((ev) => document.addEventListener(ev, touch, { passive: true }));

$("check").addEventListener("click", check);
$("example").addEventListener("click", example);
$("new-person").addEventListener("click", newPerson);
$("accept-all").addEventListener("click", () => setAll("accepted"));
$("reject-all").addEventListener("click", () => setAll("rejected"));
$("draft").addEventListener("input", updateCounter);
$("draft").addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") check(); });
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("result").textContent); $("copied").textContent = "Скопійовано"; }
  catch { $("copied").textContent = "Виділіть текст і скопіюйте вручну"; }
});
$("copy-counts").addEventListener("click", async () => {
  try {
    const counts = await (await fetch("/api/counts")).json();
    await navigator.clipboard.writeText(JSON.stringify(counts, null, 2));
    $("counts-copied").textContent = "Скопійовано";
  } catch {
    $("counts-copied").textContent = "Не вдалося скопіювати";
  }
});

loadTasks().then(() => { updateCounter(); health(); });
