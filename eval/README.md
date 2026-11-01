# Kładka eval

A small, honest check that the pipeline works end to end on one laptop. It is not a quality benchmark.

## What is in here

- `drafts.json`: 20 **synthetic** drafts written by the author. No real people, messages or case numbers. They cover the 4 task presets and both target languages (12 Polish, 8 English); 9 contain Ukrainian Cyrillic fragments. Each draft lists the rule ids it should trigger, the facts (names, numbers, dates) that must survive, and, for 12 clear cases, the expected register.
- `run.mjs`: runs every draft through the full pipeline (rules, model call, validation, back-translation) and writes `results.json`, including every model output so anyone can read them.
- `derive.mjs`: adds metrics computed from the stored outputs, without calling the model.
- `results.json`: the main run, `-c 8192`.
- `results-c4096.json`: a 5-draft run with `-c 4096`, to measure memory.

Run it with the model running: `npm run eval`.

## Setup of the measured run

- Apple M3 Pro, 11 cores, 36 GB RAM, macOS 26 (Darwin 25.6). 16 GB machines, Windows and Linux are untested.
- llama.cpp `llama-server` 0.8.0 (build 11960), Metal, all layers on GPU (`-ngl 99`), one slot, `--no-jinja`.
- EuroLLM-9B-Instruct-2512, Q4_K_M GGUF, 5.58 GB.
- temperature 0.2, top_p 0.9, seed 42, JSON-schema-constrained output, back-translation on.
- 1 run (2026-11-01). No repeat runs, so there are no error bars.

## Results (20 drafts, `-c 8192`)

| Metric | Value |
|---|---|
| Seconds per draft (both model calls), median | 39.5 s |
| Seconds per draft, mean / p90 / max | 51.0 / 128.1 / 141.6 s |
| Generation speed, mean (min) | 21.4 (18.5) tokens/s |
| Prompt processing, mean | 187 tokens/s |
| llama-server RSS idle / peak | 6,452 / 7,222 MB |
| Node process RSS peak | 55 MB |
| Coach JSON usable on first attempt | 17/20 |
| Coach JSON usable after retries | 20/20 |
| Explanations in Ukrainian, corrected text without Cyrillic | 20/20 |
| Back-translation JSON valid on first attempt | 20/20 |
| Facts preserved in the model's full version | 72/78 |
| Drafts where the full version contains a number not in the draft | 1/20 |
| Model changes that can be shown inline in the writer's text | 77/83 |
| Model changes whose reason was replaced by a curated rule reason | 54/83 |
| Rule hits, total | 64 |
| Expected rule hits found | 62/62 |
| Rule engine time, max | 82 ms |
| Register: model alone agrees with label | 8/12 |
| Register: model alone catches clearly informal drafts | 0/4 |
| Register: model plus register rules agrees with label | 12/12 |

## Memory with `-c 4096` (5 drafts)

| Metric | Value |
|---|---|
| llama-server RSS idle / peak | 6,055 / 6,745 MB |
| macOS `footprint` (dirty memory, excludes the mapped model file) | 1,500 MB |
| Seconds per draft, median | 37.6 s |
| Generation speed, mean | 21.8 tokens/s |
| Coach JSON usable on first attempt | 5/5 |

RSS includes the 5.2 GB model file, which is memory-mapped. On Apple Silicon the GPU shares this memory. A 16 GB machine should have room for it next to a browser, but that has not been measured.

## What the numbers mean

- **Usable on first attempt**: the first, grammar-constrained answer parsed, matched the schema, and passed the fatal checks (corrected text not mostly Cyrillic, not under half the draft length). The 3 failures were 2 answers with no JSON object and 1 invalid JSON; all 3 were fixed by the retry with another seed. Those retries are why p90 and max are over 2 minutes.
- **Facts preserved**: exact substring match of each listed fact in the full version. All 6 misses are the writer's name: the model dropped the signature even though the prompt asks it to keep it. In the coach view the writer's own text is the base, so a dropped signature in the full version does not remove it from what the writer copies.
- **Number not in the draft**: office-pl-2's full version contained made-up numbers (1 and 1234567890). The UI warns about this.
- **Shown inline**: the model's "from" fragment was found word for word (ignoring case and surrounding quotes) in the draft. Others are listed for manual editing.
- **Curated rule reason**: when a model change covers a fragment the rule engine flagged, the UI shows the rule's reviewed Ukrainian explanation instead of the model's.
- **Register**: labels were written by the same author who wrote the register rules, so the combined 12/12 is optimistic. The model alone called all 4 clearly informal drafts "ok" or "too formal".

## What this eval does not show

- No human rating of correction quality or explanation quality. Reading the outputs in `results.json`, the Polish and English corrections are mostly fluent, but many model-written Ukrainian explanations are vague or wrong about grammar, some suggestions make a phrase worse, and the model kept the false friend "accurate" in the job example. The back-translation once invented a signature name that was in neither text. These are the main reasons Kładka shows suggestions one by one for the writer to accept, not a finished letter.
- No real users. The drafts are synthetic and the author also wrote the rules, so the rule results are optimistic.
- Speed on a typical 16 GB laptop without Apple Silicon or a GPU will be lower. Not measured.
