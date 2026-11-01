// Task templates. Each one is a preset that shapes the prompt: who reads the
// text, what register is expected, and the genre conventions that matter.

const TASKS = Object.freeze({
  job: {
    label_uk: "Заявка на роботу / супровідний лист",
    label: "Job application or cover letter",
    reader: "an employer or recruiter in Poland",
    guidance: "Genre: a cover letter (in Polish 'list motywacyjny') or a short application message. Polish format: opening 'Szanowni Państwo,' or 'Szanowna Pani / Szanowny Panie,' if the name is known; one sentence naming the position and where it was advertised if the draft says so; experience with exact years and places; availability; closing 'Z poważaniem,' and the name. Professional and confident, not boastful. Keep every fact, date and qualification exactly. Do not invent a recruiter name, a company name or skills. If the draft mentions a CV in Polish, remind in the register note that Polish CVs usually end with a consent clause for processing personal data (klauzula RODO).",
  },
  landlord: {
    label_uk: "Лист орендодавцю",
    label: "Letter to a landlord",
    reader: "a private landlord or property manager",
    guidance: "Genre: a polite written request or notice. State the problem, the facts (dates, amounts, what is broken), and one concrete request with a time frame if the draft gives one. Use formal address (Pan/Pani in Polish, Dear Mr/Ms in English).",
  },
  school: {
    label_uk: "Повідомлення вчителю (e-dziennik)",
    label: "Message to a teacher via the school e-diary",
    reader: "a teacher or form tutor, reading the message in the school e-diary (e-dziennik, for example Librus or Vulcan)",
    guidance: "Genre: a short e-diary message. Start with 'Dzień dobry,' or 'Szanowna Pani / Szanowny Panie,' and address the teacher as Pani/Pan, never with ty-forms. Name the child and class. Say clearly what is needed (absence excuse, meeting, homework, question) in two to five sentences. Close with 'Z poważaniem' or 'Pozdrawiam serdecznie' and the parent's name.",
  },
  office: {
    label_uk: "Лист до установи (ZUS, urząd, PUP)",
    label: "Letter to a public office (ZUS, urząd, PUP)",
    reader: "a clerk in a Polish public office (ZUS, urząd wojewódzki, urząd miasta or gminy, PUP)",
    guidance: "Genre: a formal letter or e-mail to an office. Name the matter in the first sentence (for example a PESEL UKR status, a residence card including the CUKR card for Ukrainian citizens, an 800 plus benefit, registration at PUP). Keep every number, date, PESEL and case reference (znak sprawy) exactly. Make one clear request. Polish opening 'Szanowni Państwo,' and closing 'Z poważaniem,' with the full name.",
  },
});

const TARGETS = Object.freeze({
  pl: { name: "Polish", name_uk: "польська" },
  en: { name: "English", name_uk: "англійська" },
});

export { TASKS, TARGETS };
