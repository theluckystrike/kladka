// Kładka rule engine.
// Rule-based checks that run before (and without) the language model.
// The engine shape (validated frozen rules, capped findings, position-sorted
// results, reverse-order fix application) is ported from the MIT-licensed
// theluckystrike/bln-mcp-grammar-server (src/rules.mjs). The rules below are
// new, written for Ukrainian speakers writing Polish or English, with
// explanations in Ukrainian.

const MAX_FINDINGS_PER_RULE = 20;
const SEVERITIES = ["error", "warning", "info"];
const CATEGORIES = ["grammar", "spelling", "vocabulary", "register", "punctuation", "script"];
const LANGS = ["pl", "en", "any"];

// JavaScript \b is ASCII only, so it breaks on Polish letters (ą, ę, ł, ś ...).
// Every \b in a rule source is replaced with a Unicode-aware word boundary.
const UB = "(?:(?<![\\p{L}\\p{N}])(?=[\\p{L}\\p{N}])|(?<=[\\p{L}\\p{N}])(?![\\p{L}\\p{N}]))";

function rx(source, flags = "gu") {
  const f = flags.includes("u") ? flags : flags + "u";
  return new RegExp(source.replaceAll("\\b", UB), f.includes("g") ? f : f + "g");
}

// Keep the capital letter of the original match when replacing.
function keepCase(original, replacement) {
  if (!original || !replacement) return replacement;
  const first = original[0];
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function buildRule(def) {
  const { id, lang, pattern, message, why, fix, severity, category } = def;
  if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) throw new Error(`bad rule id: ${id}`);
  if (!LANGS.includes(lang)) throw new Error(`rule ${id}: bad lang ${lang}`);
  if (!(pattern instanceof RegExp) || !pattern.global) throw new Error(`rule ${id}: pattern must be a global RegExp`);
  if (typeof message !== "string" || message.length === 0) throw new Error(`rule ${id}: message required`);
  if (typeof why !== "string" || !/[\u0400-\u04FF]/.test(why)) throw new Error(`rule ${id}: why must be Ukrainian text`);
  if (!SEVERITIES.includes(severity)) throw new Error(`rule ${id}: bad severity`);
  if (!CATEGORIES.includes(category)) throw new Error(`rule ${id}: bad category`);
  if (fix !== undefined && fix !== null && typeof fix !== "function" && typeof fix !== "string") {
    throw new Error(`rule ${id}: fix must be function, string or null`);
  }
  return Object.freeze({ id, lang, pattern, message, why, fix: fix ?? null, severity, category });
}

const NUM_WORDS = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|several|many)";

const definitions = [
  // ---------------- Polish: formal address (Pan / Pani) ----------------
  {
    id: "pl-szanowny-pan-vocative", lang: "pl", category: "grammar", severity: "error",
    pattern: rx("\\bSzanowny\\s+Pan\\b"),
    fix: "Szanowny Panie",
    message: "Letter greeting needs the vocative: Szanowny Panie.",
    why: "У звертанні польська вимагає кличного відмінка: «Szanowny Panie», а не «Szanowny Pan». В українській теж кличний («Шановний пане»), тож форма знайома.",
  },
  {
    id: "pl-szanowny-pani-agreement", lang: "pl", category: "grammar", severity: "error",
    pattern: rx("\\bSzanowny\\s+Pani\\b"),
    fix: "Szanowna Pani",
    message: "Adjective must agree with Pani: Szanowna Pani.",
    why: "Прикметник узгоджується з родом: до жінки «Szanowna Pani», до чоловіка «Szanowny Panie».",
  },
  {
    id: "pl-informal-greeting", lang: "pl", category: "register", severity: "warning",
    pattern: rx("\\b(cześć|czesc|hej|siema|elo|witam)\\b", "giu"),
    fix: null,
    message: "Informal or impolite greeting for a formal letter.",
    why: "«Cześć/Hej» звучить як до друга. «Witam» багато хто в Польщі вважає неввічливим від молодшої чи нижчої за статусом особи. До установи, орендодавця, вчителя краще «Dzień dobry» або «Szanowna Pani / Szanowny Panie».",
  },
  {
    id: "pl-ty-form-to-stranger", lang: "pl", category: "register", severity: "warning",
    pattern: rx("\\b(możesz|mozesz|mógłbyś|mogłabyś|wiesz|chcesz|masz|twój|twoja|twoje|ciebie|tobie|tobą)\\b", "giu"),
    fix: null,
    message: "Informal 'ty' form; to an office, landlord or teacher use Pan/Pani.",
    why: "Звертання на «ти» до незнайомої людини чи установи польською грубе. Замість «możesz» пишіть «może Pan / może Pani», замість «twój» — «Pana / Pani».",
  },
  {
    id: "pl-do-widzenia-closing", lang: "pl", category: "register", severity: "info",
    pattern: rx("\\bdo widzenia\\b", "giu"),
    fix: null,
    message: "In a written letter close with 'Z poważaniem' or 'Z wyrazami szacunku'.",
    why: "«Do widzenia» кажуть усно. У листі до установи пишуть «Z poważaniem», до вчителя чи орендодавця також «Pozdrawiam serdecznie».",
  },
  // ---------------- Polish: false friends UA -> PL ----------------
  {
    id: "pl-ff-kwatera", lang: "pl", category: "vocabulary", severity: "warning",
    pattern: rx("\\bkwater(a|y|ę|ze|ą|ach)?\\b", "giu"),
    fix: null,
    message: "False friend: kwatera means lodging/quarters; a flat is 'mieszkanie'.",
    why: "Хибний друг перекладача: українське «квартира» польською «mieszkanie». «Kwatera» означає тимчасове житло або військову квартиру.",
  },
  {
    id: "pl-ff-magazyn", lang: "pl", category: "vocabulary", severity: "info",
    pattern: rx("\\bmagazyn(ie|u|em|y|ów)?\\b", "giu"),
    fix: null,
    message: "False friend: magazyn means warehouse or magazine; a shop is 'sklep'.",
    why: "Українське «магазин» польською «sklep». «Magazyn» — це склад або журнал.",
  },
  {
    id: "pl-ff-zajawa", lang: "pl", category: "vocabulary", severity: "error",
    pattern: rx("\\b(zajaw[aęyi]|zayav[ai]|zjaw[aęy])\\b", "giu"),
    fix: null,
    message: "Ukrainian 'заява' is 'wniosek' or 'podanie' in Polish ('zjawa' means ghost).",
    why: "«Заява» польською «wniosek» (до установи) або «podanie» (наприклад, до школи чи роботодавця). «Zjawa» польською означає привид.",
  },
  {
    id: "pl-ff-dowidka", lang: "pl", category: "vocabulary", severity: "error",
    pattern: rx("\\b(dowidk[aęiy]|dovidk[aiy])\\b", "giu"),
    fix: null,
    message: "Ukrainian 'довідка' is 'zaświadczenie' in Polish.",
    why: "«Довідка» польською «zaświadczenie» (наприклад, zaświadczenie o zatrudnieniu, zaświadczenie lekarskie).",
  },
  {
    id: "pl-ff-oformic", lang: "pl", category: "vocabulary", severity: "error",
    pattern: rx("\\boformi\\p{L}*", "giu"),
    fix: null,
    message: "'oformić' does not exist in Polish; use złożyć (wniosek), załatwić, wypełnić.",
    why: "Калька з «оформити». Польською: «złożyć wniosek», «załatwić sprawę», «wypełnić formularz», «zarejestrować».",
  },
  {
    id: "pl-ff-robota", lang: "pl", category: "vocabulary", severity: "info",
    pattern: rx("\\brobot(a|y|ę|ą|e)\\b", "giu"),
    fix: null,
    message: "In formal Polish a job is 'praca'; 'robota' is colloquial (and 'roboty' can mean works or robots).",
    why: "Українське «робота» в листі польською — «praca». «Robota» звучить розмовно, ніби «робітка».",
  },
  {
    id: "pl-ff-przyjmowac-udzial", lang: "pl", category: "vocabulary", severity: "error",
    pattern: rx("\\bprzyj\\p{L}*\\s+udział\\p{L}*", "giu"),
    fix: null,
    message: "Polish says 'brać udział' (take part), not 'przyjmować udział'.",
    why: "Калька з «приймати участь». Польською «brać udział», «wziąć udział w spotkaniu».",
  },
  // ---------------- Polish: case government and calques ----------------
  {
    id: "pl-szukac-genitive", lang: "pl", category: "grammar", severity: "error",
    pattern: rx("\\b(szuka\\p{L}*)\\s+pracę\\b", "giu"),
    fix: (m) => `${m[1]} pracy`,
    message: "'szukać' takes the genitive: szukam pracy.",
    why: "Дієслово «szukać» вимагає родового відмінка: «szukam pracy, szukam mieszkania», хоча українською «шукаю роботу» (знахідний).",
  },
  {
    id: "pl-czekam-na-odpowiedz", lang: "pl", category: "grammar", severity: "error",
    pattern: rx("\\b(czeka\\p{L}*)\\s+((?:Pana|Pani|Państwa)\\s+)?odpowiedzi\\b", "giu"),
    fix: (m) => `${m[1]} na ${m[2] ?? ""}odpowiedź`,
    message: "Polish: czekać na + accusative (czekam na odpowiedź).",
    why: "Українською «чекаю відповіді» (родовий), а польською потрібен прийменник: «czekam na odpowiedź», «czekam na Pana odpowiedź».",
  },
  {
    id: "pl-po-telefonie", lang: "pl", category: "grammar", severity: "error",
    pattern: rx("\\bpo\\s+telefon(ie|u)\\b", "giu"),
    fix: "przez telefon",
    message: "Polish says 'przez telefon' (by phone).",
    why: "Калька з «по телефону». Польською «rozmawiać przez telefon», «kontakt telefoniczny».",
  },
  {
    id: "pl-mnie-lat", lang: "pl", category: "grammar", severity: "error",
    pattern: rx("\\bmnie\\s+(\\d+)\\s+(lat|lata)\\b", "giu"),
    fix: (m) => keepCase(m[0], `mam ${m[1]} ${m[2]}`),
    message: "Age in Polish: 'mam 30 lat', not 'mnie 30 lat'.",
    why: "Калька з «мені 30 років». Польською вік «маю»: «mam 30 lat», «syn ma 8 lat».",
  },
  {
    id: "pl-u-mnie-jest", lang: "pl", category: "grammar", severity: "warning",
    pattern: rx("\\bu\\s+(mnie|nas)\\s+(jest|są|był|była|było|byli)\\b", "giu"),
    fix: null,
    message: "Possession in Polish is usually 'mam/mamy', not 'u mnie jest'.",
    why: "Калька з «у мене є». Польською природніше «mam dwoje dzieci», «mamy problem z ogrzewaniem».",
  },
  {
    id: "pl-mieszkam-na-ulicy", lang: "pl", category: "grammar", severity: "info",
    pattern: rx("\\bmieszka\\p{L}*\\s+na\\s+ulic(y|e)\\b", "giu"),
    fix: null,
    message: "Addresses: 'mieszkam przy ulicy ...' is the standard form.",
    why: "Українською «живу на вулиці...», польською адресу пишуть «mieszkam przy ulicy Długiej 5» або «ul. Długa 5».",
  },
  // ---------------- Polish: missing diacritics in common words ----------------
  {
    id: "pl-diacritics", lang: "pl", category: "spelling", severity: "warning",
    pattern: rx("\\b(prosze|Prosze|dziekuje|Dziekuje|dziekuję|Dziekuję|moge|sie|wiadomosc|powazaniem|zaswiadczenie|prosba|Prosba|Pania|Panstwo|Panstwa|zyczeniami|wlasciciel|wlascicielka)\\b", "gu"),
    fix: (m) => keepCase(m[0], ({
      prosze: "proszę", dziekuje: "dziękuję", "dziekuję": "dziękuję",
      moge: "mogę", sie: "się", wiadomosc: "wiadomość",
      powazaniem: "poważaniem", zaswiadczenie: "zaświadczenie",
      prosba: "prośba", pania: "Panią", panstwo: "Państwo", panstwa: "Państwa",
      zyczeniami: "życzeniami", wlasciciel: "właściciel", wlascicielka: "właścicielka",
    })[m[0].toLowerCase()] ?? m[0]),
    message: "Polish word without diacritics (ą, ę, ś, ź, ż, ł, ó, ć, ń).",
    why: "Без польських літер (ą, ę, ś, ż...) текст виглядає недбало, а в офіційному листі це помітно. Наприклад «proszę», «dziękuję», «się».",
  },
  // ---------------- English: articles ----------------
  {
    id: "en-article-missing-the-place", lang: "en", category: "grammar", severity: "error",
    pattern: rx("\\b(went|go|going|goes|come|came|walk|walked)\\s+to\\s+(store|office|hospital|bank|park|market|library|post office|pharmacy)\\b", "giu"),
    fix: (m) => `${m[1]} to the ${m[2]}`,
    message: "Missing article 'the' before a specific place.",
    why: "В українській немає артиклів, тому їх часто пропускають. Перед конкретним місцем потрібне «the»: «go to the bank», «the office».",
  },
  {
    id: "en-article-a-an", lang: "en", category: "grammar", severity: "error",
    pattern: rx("\\ba\\s+(hour|honest|apartment|application|interview|answer|appointment|opportunity|experienced|english|engineer|accountant|office)\\b", "giu"),
    fix: (m) => keepCase(m[0], `an ${m[1]}`),
    message: "Use 'an' before a vowel sound.",
    why: "Перед словом, що починається з голосного звуку, артикль «an»: «an apartment», «an interview», «an hour».",
  },
  {
    id: "en-article-missing-a-job", lang: "en", category: "grammar", severity: "warning",
    pattern: rx("\\b(I am|I'm|I work as|I worked as|work as|worked as|he is|she is)\\s+(teacher|nurse|driver|engineer|accountant|cook|doctor|lawyer|manager|programmer|cleaner|seamstress|electrician)\\b", "giu"),
    fix: (m) => `${m[1]} ${/^[aeiou]/i.test(m[2]) ? "an" : "a"} ${m[2]}`,
    message: "Professions take 'a/an' in English: I am a teacher.",
    why: "Українською «я вчителька» без артикля, англійською професія потребує «a/an»: «I am a teacher», «I worked as an accountant».",
  },
  // ---------------- English: L1 calques ----------------
  {
    id: "en-am-agree", lang: "en", category: "grammar", severity: "error",
    pattern: rx("\\b(I am|I'm)\\s+agree\\b", "giu"),
    fix: (m) => keepCase(m[0], "I agree"),
    message: "'agree' is a verb: I agree, not I am agree.",
    why: "Калька з «я згоден». Англійською «agree» — дієслово, без «am»: «I agree».",
  },
  {
    id: "en-depend-from", lang: "en", category: "grammar", severity: "error",
    pattern: rx("\\b(depend|depends|depending|depended)\\s+(from|of)\\b", "giu"),
    fix: (m) => `${m[1]} on`,
    message: "English: depend on.",
    why: "Калька з «залежати від». Англійською «depend on».",
  },
  {
    id: "en-consist-from", lang: "en", category: "grammar", severity: "error",
    pattern: rx("\\b(consist|consists|consisted)\\s+from\\b", "giu"),
    fix: (m) => `${m[1]} of`,
    message: "English: consist of.",
    why: "Калька з «складатися з». Англійською «consist of».",
  },
  {
    id: "en-married-with", lang: "en", category: "grammar", severity: "error",
    pattern: rx("\\bmarried\\s+with\\b", "giu"),
    fix: "married to",
    message: "English: married to someone.",
    why: "Калька з «одружений з». Англійською «married to».",
  },
  {
    id: "en-explain-me", lang: "en", category: "grammar", severity: "error",
    pattern: rx("\\b(explain|explained|describe|say)\\s+(me|us)\\b", "giu"),
    fix: (m) => `${m[1]} to ${m[2]}`,
    message: "English: explain to me.",
    why: "Калька з «поясніть мені» (давальний відмінок). Англійською потрібне «to»: «explain to me».",
  },
  {
    id: "en-have-years", lang: "en", category: "grammar", severity: "error",
    pattern: rx("\\b(I|he|she|my son|my daughter)\\s+(have|has)\\s+(\\d+)\\s+years\\b(?!\\s+(?:of\\s+)?(?:experience|work|practice|in|as|at)\\b)", "giu"),
    fix: (m) => `${m[1]} ${/^I$/i.test(m[1]) ? "am" : "is"} ${m[3]} years old`,
    message: "Age in English uses 'to be': I am 34 years old.",
    why: "Вік англійською через «to be»: «I am 34 years old», «my son is 8».",
  },
  {
    id: "en-since-duration", lang: "en", category: "grammar", severity: "error",
    pattern: rx(`\\bsince\\s+(${NUM_WORDS})\\s+(years|months|weeks|days|year|month)\\b`, "giu"),
    fix: (m) => `for ${m[1]} ${m[2]}`,
    message: "Duration takes 'for': for three years. 'since' needs a start point (since 2022).",
    why: "Українське «вже три роки / з трьох років» англійською «for three years». «Since» тільки з моментом початку: «since 2022», «since March».",
  },
  {
    id: "en-on-photo", lang: "en", category: "grammar", severity: "error",
    pattern: rx("\\bon\\s+the\\s+(photo|picture)\\b", "giu"),
    fix: (m) => `in the ${m[1]}`,
    message: "English: in the photo.",
    why: "Калька з «на фото». Англійською «in the photo».",
  },
  {
    id: "en-in-internet", lang: "en", category: "grammar", severity: "error",
    pattern: rx("\\bin\\s+(the\\s+)?internet\\b", "giu"),
    fix: "on the internet",
    message: "English: on the internet.",
    why: "Калька з «в інтернеті». Англійською «on the internet».",
  },
  {
    id: "en-make-photo", lang: "en", category: "vocabulary", severity: "error",
    pattern: rx("\\b(make|made|making)\\s+(a\\s+)?(photo|photos|picture)\\b", "giu"),
    fix: (m) => `${({ make: "take", made: "took", making: "taking" })[m[1].toLowerCase()]} ${m[2] ?? ""}${m[3]}`,
    message: "English: take a photo.",
    why: "Калька з «зробити фото». Англійською «take a photo».",
  },
  {
    id: "en-work-like", lang: "en", category: "grammar", severity: "error",
    pattern: rx("\\b(work|worked|working|works)\\s+like\\s+(a|an)\\b", "giu"),
    fix: (m) => `${m[1]} as ${m[2]}`,
    message: "Job role: work as a ..., not work like a ...",
    why: "Українське «працюю як / працювала вчителькою» англійською «work as a teacher». «Work like a» означає «працювати подібно до».",
  },
  {
    id: "en-double-negative", lang: "en", category: "grammar", severity: "error",
    pattern: rx("\\b(don't|doesn't|didn't|can't|couldn't|won't|never)\\s+(\\w+\\s+)?(nothing|nobody|nowhere|no one)\\b", "giu"),
    fix: null,
    message: "Double negative. English uses one negation: I don't know anything.",
    why: "В українській подвійне заперечення нормальне («я нічого не знаю»), а англійською ні: «I don't know anything» або «I know nothing».",
  },
  {
    id: "en-much-countable", lang: "en", category: "grammar", severity: "error",
    pattern: rx("\\bmuch\\s+(documents|problems|years|people|children|things|questions|hours|days|times|mistakes|projects|tasks|clients|jobs|languages)\\b", "giu"),
    fix: (m) => `many ${m[1]}`,
    message: "Countable plural nouns take 'many'.",
    why: "Українське «багато» має два англійські відповідники: «many» для злічуваних (many documents), «much» для незлічуваних (much time).",
  },
  {
    id: "en-he-dont", lang: "en", category: "grammar", severity: "error",
    pattern: rx("\\b(he|she|it|my son|my daughter|the landlord)\\s+(don't)\\b", "giu"),
    fix: (m) => `${m[1]} doesn't`,
    message: "Third person singular: he doesn't.",
    why: "У третій особі однини англійською «doesn't»: «he doesn't», «my son doesn't».",
  },
  // ---------------- English: false friends UA -> EN ----------------
  {
    id: "en-ff-accurate", lang: "en", category: "vocabulary", severity: "warning",
    pattern: rx("\\b(I am|I'm|very|am an|am a)\\s+accurate\\b", "giu"),
    fix: null,
    message: "False friend: 'accurate' means correct/precise; a tidy careful person is 'careful', 'neat', 'thorough'.",
    why: "Хибний друг: українське «акуратний» про людину англійською «careful», «neat», «thorough». «Accurate» — це про точні дані чи вимірювання.",
  },
  {
    id: "en-ff-magazine", lang: "en", category: "vocabulary", severity: "warning",
    pattern: rx("\\b(in|at|to|from)\\s+(a|the)\\s+magazine\\b", "giu"),
    fix: (m) => `${m[1]} ${m[2]} shop`,
    message: "False friend: a magazine is a periodical; a shop is 'shop' or 'store'.",
    why: "Хибний друг: «магазин» англійською «shop» або «store». «Magazine» — журнал.",
  },
  {
    id: "en-ff-speciality", lang: "en", category: "vocabulary", severity: "info",
    pattern: rx("\\b(my|by)\\s+(speciality|specialty)\\b", "giu"),
    fix: null,
    message: "For education or profession use 'field of study', 'degree in', or 'profession'.",
    why: "«Спеціальність» в CV англійською зазвичай «degree in ...», «field of study» або «profession». «Speciality» звучить як «фірмова страва».",
  },
  {
    id: "en-ff-sympathetic", lang: "en", category: "vocabulary", severity: "info",
    pattern: rx("\\bsympathetic\\b", "giu"),
    fix: null,
    message: "False friend: 'sympathetic' means compassionate, not nice-looking or pleasant.",
    why: "Хибний друг: «симпатичний» англійською «nice», «pleasant», «good-looking». «Sympathetic» — співчутливий.",
  },
  {
    id: "en-ff-according-to-me", lang: "en", category: "vocabulary", severity: "warning",
    pattern: rx("\\baccording\\s+to\\s+me\\b", "giu"),
    fix: "in my opinion",
    message: "English: in my opinion.",
    why: "Калька з «на мою думку / згідно зі мною». Англійською «in my opinion» або «I think».",
  },
  // ---------------- English: register ----------------
  {
    id: "en-informal-greeting", lang: "en", category: "register", severity: "warning",
    pattern: rx("^\\s*(hi|hey|hello|yo)\\b", "gimu"),
    fix: null,
    message: "Informal greeting for a formal letter; use 'Dear Mr/Ms Surname' or 'Dear Sir or Madam'.",
    why: "У діловому листі англійською пишуть «Dear Ms Smith,» або «Dear Sir or Madam,». «Hi/Hey» — для друзів і колег.",
  },
  {
    id: "en-i-want", lang: "en", category: "register", severity: "info",
    pattern: rx("\\bI\\s+want\\b", "gu"),
    fix: null,
    message: "In requests 'I would like' sounds more polite than 'I want'.",
    why: "Пряме «I want» у проханні звучить різко. Ввічливіше «I would like to ...», «Could you please ...».",
  },
  {
    id: "en-waiting-for-answer", lang: "en", category: "register", severity: "info",
    pattern: rx("\\b(waiting|wait)\\s+for\\s+your\\s+(answer|reply|response)\\b", "giu"),
    fix: null,
    message: "Standard closing: 'I look forward to hearing from you.'",
    why: "Калька з «чекаю на вашу відповідь». Стандартна англійська фраза: «I look forward to hearing from you.»",
  },
  // ---------------- Any language: script and punctuation ----------------
  {
    id: "any-cyrillic-left", lang: "any", category: "script", severity: "info",
    pattern: rx("[\\u0400-\\u04FF][\\u0400-\\u04FF\\s'’ʼ-]*[\\u0400-\\u04FF]", "gu"),
    fix: null,
    message: "Cyrillic text in the draft; the model will translate it.",
    why: "У чернетці є фрагменти кирилицею. Модель перекладе їх, але перевірте зворотний переклад, чи зміст збережено.",
  },
  {
    id: "any-repeated-word", lang: "any", category: "punctuation", severity: "warning",
    pattern: rx("\\b(\\p{L}{2,})\\s+\\1\\b", "giu"),
    fix: (m) => m[1],
    message: "Repeated word.",
    why: "Слово повторюється двічі поспіль.",
  },
  {
    id: "any-space-before-punct", lang: "any", category: "punctuation", severity: "info",
    pattern: rx("[\\p{L}\\p{N}](\\s+)([,.;:!?])", "gu"),
    fix: (m) => m[0][0] + m[2],
    message: "No space before punctuation in Polish or English.",
    why: "У польській та англійській перед комою, крапкою, знаком питання пробіл не ставлять.",
  },
];

const RULES = Object.freeze(definitions.map(buildRule));

function applyOneRule(rule, text) {
  const out = [];
  rule.pattern.lastIndex = 0;
  for (const m of text.matchAll(rule.pattern)) {
    if (out.length >= MAX_FINDINGS_PER_RULE) break;
    let fix = null;
    if (typeof rule.fix === "string") fix = keepCase(m[0], rule.fix);
    else if (typeof rule.fix === "function") fix = rule.fix(m);
    if (fix === m[0]) fix = null;
    out.push({
      ruleId: rule.id, lang: rule.lang, category: rule.category, severity: rule.severity,
      index: m.index, matched: m[0], fix, message: rule.message, why_uk: rule.why,
    });
  }
  return out;
}

// Apply non-overlapping fixes from the end of the text so indices stay valid.
function buildFixedText(text, findings) {
  const fixable = findings.filter((f) => f.fix !== null);
  let result = text;
  let floor = Infinity;
  for (let i = fixable.length - 1; i >= 0; i -= 1) {
    const f = fixable[i];
    const end = f.index + f.matched.length;
    if (end > floor) continue; // overlaps a fix already applied
    result = result.slice(0, f.index) + f.fix + result.slice(end);
    floor = f.index;
  }
  return result;
}

/**
 * Run all rules for a target language ("pl" or "en") on a draft.
 * @returns {{findings: object[], fixedText: string, summary: object}}
 */
function runRules(text, target) {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  if (!["pl", "en"].includes(target)) throw new TypeError("target must be pl or en");
  const findings = [];
  for (const rule of RULES) {
    if (rule.lang !== "any" && rule.lang !== target) continue;
    findings.push(...applyOneRule(rule, text));
  }
  findings.sort((a, b) => a.index - b.index || a.ruleId.localeCompare(b.ruleId));
  const summary = { total: findings.length, error: 0, warning: 0, info: 0, byCategory: {} };
  for (const f of findings) {
    summary[f.severity] += 1;
    summary.byCategory[f.category] = (summary.byCategory[f.category] ?? 0) + 1;
  }
  // Overlapping fixes are skipped in one pass, so run a second pass on the result.
  let fixedText = buildFixedText(text, findings);
  const second = [];
  for (const rule of RULES) {
    if (rule.lang !== "any" && rule.lang !== target) continue;
    second.push(...applyOneRule(rule, fixedText));
  }
  second.sort((a, b) => a.index - b.index);
  fixedText = buildFixedText(fixedText, second);
  return { findings, fixedText, summary };
}

export { RULES, runRules, buildRule, rx, keepCase };
