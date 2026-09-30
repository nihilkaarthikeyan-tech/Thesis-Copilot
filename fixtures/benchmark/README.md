# Benchmark against Jenni.ai — spec §13.4

Each release, 20–30 matched inputs per discipline are written with both tools and scored two
ways: the deterministic check suite (this folder, run by `pnpm --filter @tc/ai benchmark`), and a
blind expert rating (a person). The agent writes neither the Jenni text nor the rating.

## One case

```
fixtures/benchmark/<case-slug>/
  case.json    { "title": "...", "discipline": "engineering_core_v1", "objectives": ["..."],
                 "chapterRole": "LITERATURE", "passages": [{ "id": "S1#c1", "text": "..." }] }
  ours.md      the chapter (or section) built here — paste the accepted text, or the draft
  jenni.md     the same input written with Jenni, pasted as plain text
```

`passages` are optional: with them, E8 (twelve-word copying) and E9 (numbers with no data) can
run on both sides; without them those two checks say nothing.

Discipline ids are the profile ids in `packages/config/src/profiles/disciplines.ts`. Pass one as
the script's argument to run only that discipline's cases.

## What the script prints

Per case, one line per check that raised anything on either side, then blocking totals and copied
runs; then the totals over all cases. Fewer issues is better. Publish the table internally with
the expert scores beside it (spec §13.4: "publish the result internally").
