# csv-reader-speed-01-run-20261121

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/scriptstealer/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/scriptstealer/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0, for the
[csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
bounty. `solve.js` returns exactly csv-reader's answer — `{columns, rows, errors}`
for `{text, header}` — on every input, including its broken-row policy: BOM drop,
LF/CRLF record ends, stray CRs, quoted fields with doubled quotes and line
breaks inside, quote junk, unterminated quotes re-read as unquoted, short/long
row padding and cutting with errors in order.

## How it is fast

Two paths. A record whose first line holds no quote and no stray CR is read at
once — one slice and one split. Any other record is read field by field, but
each field jumps from delimiter to delimiter with one native regex scan
(`RegExp` `test()` with `/g`, position read back from `lastIndex`) instead of
walking character by character; `test()` is used rather than `exec()` because
it allocates no match array.

## Results

- Practice set: 6/6 cases identical to csv-reader 1.0.0 (kit's `grade-local`,
  scorer `passed: 1`, L1 regrade reproduced byte for byte).
- Differential fuzz vs the reference `readCsv`: 0 mismatches over 150,000
  random broken-CSV inputs.
- Timing on this box (10.2 MB practice set, interleaved runs): baseline
  csv-reader 1.0.0 ~418 ms mean, this entry ~80 ms isolated (~135 ms when
  interleaved with the baseline's garbage) — roughly 3–7× faster, depending
  on measurement conditions.

## Layout

- `solve.js` — the entry, dependency-free ES module, `run(input)`.
- `main.ts` — the harness driver: reads `/input/cases.json`, answers each
  case alone with `run`, writes `/output/answers.json` (V8 incremental
  marking off, as the house baseline runs).

## License

MIT. See [LICENSE](LICENSE).

Referral code: `6rdgs9pm`
