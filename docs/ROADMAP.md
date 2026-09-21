# ROADMAP — what the agent still has to build

`docs/PENDING.md` is work **only a human can do**: keys, cards, credentials, fixture papers,
judgement calls. This file is the other half — work the agent can do and has not done yet, kept
here so it is not rediscovered by accident a third time.

Started 2026-09-21, after a competitor audit found that an entire class of feature (the formatting
toolbar) had been missing since the editor was built and nobody had noticed, because every test
passed.

**The rule this file exists to enforce:** a feature is not done when it is written, it is done when
it has been driven in a browser *and* the artefact it produces has been opened. Both faults found
on 2026-09-21 — equations missing from the `.docx`, figures missing from the whole-thesis export —
were invisible to typecheck, lint and 1,200 passing tests.

---

## Now — parity gaps still open

- [x] **Verify the whole-thesis export end to end.** Done 2026-09-21,
      `apps/web/e2e/thesis-export.spec.ts`. Three faults, none of them in the export: inserting a
      block deleted the block inserted before it, the app had its own copy of `uploadImage` so the
      one in `@tc/ui` had never run, and a figure inside a table cell was dropped from the thesis
      while the chapter export of the same document showed it.
- [x] **JPEG and GIF figures through the real path.** Done 2026-09-21, in the same spec, with 4x3
      files from a real encoder — so the aspect ratio in the `.docx` is the check that
      `imageSize`'s header walkers read real dimensions rather than a default.
- [x] **Drive the three chat scopes in a browser.** Done 2026-09-21,
      `apps/web/e2e/chat-scopes.spec.ts`. `web` behaves as ADR-0016 says: real OpenAlex records, no
      assistant turn, no model call. `document` found a live fault — A.4 refuses in *library*
      words for a passage sitting in the draft. That is a prompt, so it is the owner's
      (`docs/PENDING.md`); the advice underneath it was ours and is fixed.
- [x] **Drive the `@` cite picker in a browser**, including the case that matters: pick a source,
      then check the bibliography actually gains the entry after a save and re-render. Done
      2026-09-21, in `proposal-sources.spec.ts` beside the library fixtures. It also turned up two
      existing specs selecting the panel tabs by `role="button"`, which cannot match a
      `role="tab"` element — neither had run far enough to find out.

## Next — things a student will hit

- [ ] **A figure caption.** `ThesisImage` has a `caption` attribute, the exporters number figures
      from the template (`Figure 3.2`), and nothing in the editor lets anyone type one. Same shape
      of gap as the toolbar: the schema is ahead of the UI.
- [ ] **Table header/caption controls.** Tables insert with a header row and there is no way to
      toggle it, merge cells or caption the table, though `mergeCells`/`splitCell` exist in the
      extension.
- [ ] **Paste an image.** The toolbar has a file picker; pasting a screenshot — which is how
      figures actually arrive — does nothing.
- [ ] **Re-sign expired figure URLs.** `GET /chapters/:id/figures/link` exists and nothing calls
      it. A chapter reopened after the signed URL expires will show broken images until someone
      does.
- [x] **An in-editor review mode.** Done 2026-09-21: a Review tab, the supervisor's comments drawn
      on the passages they are about, accept the suggested revision without leaving the chapter.
      `commentAnchor` stays inert on purpose — ADR-0017 says why.

## Later — deliberately not started

- [ ] **Typeset equations in the export.** They currently carry their LaTeX source through. Proper
      Office maths is LaTeX → MathML → OMML and `docx` has no OMML support, so this is a project.
- [x] **Onboarding checklist** ("complete setup 3/5"). Built 2026-09-21 on the owner's list, and
      built to disappear: it renders nothing once all five steps are done. The "what next"
      recommendation stays, because it is the better thing for somebody who knows the product.
- [ ] **Browser extension.** A separate product with its own store review. Not a feature of this
      codebase.
- [ ] **Tutorials.** Video content, not code.

## Standing checks, easy to let slip

- [ ] **The E2E suite assumes `AI_PROVIDER=mock`; the local `.env` does not have it.** CI rewrites
      the variable before running Playwright (`ci.yml`); a developer machine running the real
      providers fails every spec that asserts the mock's canned suggestion — `proposal-sources`
      3.5 and 4.2, `onboarding`, `outline-commands-chat`. Those failures look like product bugs
      and are not. Run `AI_PROVIDER=mock EMBED_PROVIDER=mock` against a separate stack, or read
      the failure before believing it.

- [ ] Run `pnpm ai:shakedown` after any change to a provider, a model id or a schema. It has not
      run since the free-text gap was recorded in PENDING.
- [ ] After editing any `packages/*`, rebuild it — the apps consume `dist`. Cost a 404 on
      2026-09-21 when the figures route existed in source and not in the running API.
- [ ] Never write a regex, a backtick or a backslash through a double-quoted bash string. Three
      separate mangled files on 2026-09-21 alone; use the Write/Edit tools.
