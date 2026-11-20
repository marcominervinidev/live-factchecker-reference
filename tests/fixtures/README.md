# Test fixtures

Golden Set fixtures are references, never copies (`.claude/rules/tests.md`). A test names a window as
`golden: <slug> mm:ss-mm:ss`; `golden-window.mjs` cuts it at run time from `evals/golden/<slug>/` (recording
`mitschnitt/deepgram-nova3-v1.jsonl` or `transcript.json`) and prints it; nothing is written to disk.

Licence: in this public reference copy the excerpts under `evals/golden/` are synthetic (`evals/golden/README.md`):
they keep the structure and the times of an excerpt of the private Golden Set and carry generated pseudo-words
instead of speech. They are free to use with this repository. In the private project the same references point
at excerpts of real recordings, which stay private.

Windows in use: `golden: synt-2026-10-06-a 01:10-01:55` (issue #27: STT recording and reference transcript),
`golden: synt-2026-10-06-b 03:40-04:10` (issue #27: reference transcript with Turns marked overlap).
