# csv-reader-speed
[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Hellboys87/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Hellboys87/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast broken-CSV reader: the same answers as csv-reader 1.0.0, without its
character-at-a-time loop. It reads `{text, header}` and returns
`{columns, rows, errors}` — the header (or `null`), every other record padded
or cut to the first record's width, and an error record for every broken thing
it met (`stray_cr`, `unterminated_quote`, `quote_junk`, `short_row`,
`long_row`), with the exact line and row each one belongs to.

It is fast because it never builds a field one character at a time: it scans
with `indexOf` for the next comma, quote or line break, takes field spans
with `slice`, reads a whole plain line with one `split(',')`, and caches the
positions of the next quote, CR and LF so no character is scanned for any of
them more than once per pass. Quoted fields are still handled exactly as
csv-reader 1.0.0 reads them — doubled quotes collapse to one, CR and CRLF
inside quotes read as LF, junk after a closing quote is appended as it stands,
and a quote that never closes is a literal character with the rest re-read as
unquoted. Dependency-free, no network, no native code.

## Run it

```sh
MAKEFUN_INPUT_DIR=<dir holding cases.json> MAKEFUN_OUTPUT_DIR=<dir for answers.json> node main.ts
```

`main.ts` reads every case from `cases.json`, answers each one alone with
`run()` from `solve.js`, and writes `answers.json`.

<sub>Entered on [make.fun](https://make.fun/?ref=9xcq3bkm&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
