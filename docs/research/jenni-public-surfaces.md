# Jenni AI — public, non-app surfaces (digest)

Researched 2026-10-04 with web fetch and web search only (no browser, no sign-in). Everything below
is paraphrased. Each claim is marked with its source; "[Jenni]" means a jenni.ai or docs.jenni.ai
page, "[3rd party]" means anything else and should be treated as unverified unless it quotes Jenni
directly. Fetches went through a summariser, so exact figures were re-checked where they mattered
(noted).

---

## 1. Marketing site

### Homepage (jenni.ai) [Jenni]
- Positioning: an AI workspace where researchers read, write and cite, "with every claim traceable
  to the source"; explicitly framed as built for academic writing, not a chatbot with citations
  bolted on.
- Features named: source library (drag PDFs, import from Zotero/Mendeley), search over **200M+
  papers** and **10M+ open-access full texts**, semantic search, citations traceable to the exact
  location in the PDF, **10,000+ citation styles**, "Reviews" that flag unsupported or weak claims,
  real-time collaboration with comments and version history, AI Chat across the whole library,
  citation filters (year, impact factor, citation count).
- Numbers claimed: 6M+ academics (the pricing page still says 5M+), 15M+ papers written on Jenni,
  5.2 hours saved per paper, work published in 100+ journals (IEEE, Springer, Elsevier named).
- Testimonials on the homepage: a transport-planning PhD ("Michelle"), Dr Gareth Dyke (editor-in-chief,
  Taylor & Francis), Dr Josmel Mendoza (information management). The researcher pages add
  physicist Sabine Hossenfelder, praising Claim Confidence.
- FAQ questions shown (answers are in collapsed accordions the fetcher could not read): does Jenni
  plagiarise; mobile support; multilingual; are citations up to date; what are citations; **which AI
  models does Jenni use**. The answers could not be retrieved — see §6.
- Footer links a set of SEO "tool" pages (literature review generator, thesis writing assistant,
  paraphrasing tool, essay outline generator, expand my essay, AI essay writer, summarizer,
  paragraph generator) and an affiliate link to tinywow.com.

### Pricing (jenni.ai/pricing) [Jenni]
| | Free | Plus | Pro |
|---|---|---|---|
| Headline price | $0 | **$12/mo** | **$29/mo** |
| AI Autocomplete | 10/day (resets 00:00 UTC) | 5,000/month | Unlimited |
| AI Chat | 5 messages (**one-time, lifetime**) | 500/month | Unlimited |
| AI Edits | 3 (**one-time**) | 500/month | Unlimited |
| PDF uploads | 10 | Unlimited | Unlimited |
| PDF size / pages | 25 MB / 150 pp | 100 MB / 500 pp | unlimited size / 1,000 pp |
| Reviews | 3 | 10/month | Unlimited |
| Workflows (lit review, gap analysis) | 3 (**lifetime**) | 10/month | Unlimited |
| Other | citations in 10,000+ styles, editor export, limited support | unlimited citations, live-chat support, all export formats | priority support, web extension, version history, document publishing |

- **The $12 and $29 are the annual price expressed per month.** The page shows a "Save 60%"
  Monthly/Annual toggle. Jenni's own comparison articles (Sept 2026) give yearly prices of
  **$144 (Plus) and $348 (Pro)** and monthly-billed prices of **$30 (Plus) and $73 (Pro)**
  (jenni.ai/tool-reviews/jenni-ai-vs-paperpal). $12 × 12 = $144 and 60% off $30 ≈ $12, so the
  numbers agree. A student paying monthly pays roughly 2.5× the headline figure.
- USD on the page; "local currency available in app". The help centre says **purchasing-power-parity
  discounts** apply automatically at checkout in eligible regions [Jenni, docs plans-and-billing].
  Actual PPP prices (e.g. INR) were not visible without signing in — not verified.
- No student discount is mentioned anywhere. "No credit card required, cancel anytime."
- Unused allowances do not carry over. Plus allowances reset at the start of the billing cycle.
- Inconsistency: the pricing page lists the web extension as a Pro feature; the web-clipper page
  and the Chrome listing present it as free to install. What a Free user can do with it was not
  verifiable.

### Teams / institutions (jenni.ai/teams) [Jenni]
- Contact-sales / book-a-demo; "volume discounts", lower per-seat price at scale; no list price.
- Single invoice, admin dashboard for seats and members, dedicated support channel, staff product
  coaching, early access. **No SSO, SOC 2, GDPR or FERPA claims on the page.**
- Named institutions with case-study numbers: **Lovely Professional University (India)** — 375+
  hours saved, 109 manuscripts; **Chulalongkorn University (Thailand)** — 750+ hours, 354
  manuscripts; **UNESCO OWSD** — 830+ hours, 28+ manuscripts.
- Data claim: no user text, prompts, citations or uploads are used to train or fine-tune any model.
- Jenni Academy (jenni.ai/academy): four webinars, 2025 — with Nnamdi Azikiwe University and TCC
  Africa, NUST and Makerere (open access), Avi Staiman (AI for research), Gareth Dyke (peer review).
  The institutional push is visibly aimed at India, South-East Asia and Africa.
- A **medical-writers** page and a **Microsoft Word add-in** page exist; the Word add-in is
  **waitlist only** (chat, library, one-click cite, bibliography inside Word) — not released.

### About / careers [Jenni]
- CEO David Park named; mission phrased as removing friction from research; values listed as bold,
  lean, unorthodox, scholarly. About a dozen staff shown. Founding year, funding and HQ not stated.
- Careers: remote, open applications, no specific roles listed.
- Legal entity (from the Terms): **Jenni AI, Inc.**, a Delaware corporation (Wilmington registered
  address). A UK "Jenni AI Limited" is mentioned only by third parties — unverified.

### Feature / SEO tool pages [Jenni]
- `/ai-essay-writer` explicitly says Jenni does **not** generate entire essays and does not endorse
  cheating; it frames itself as an assistant. Yet the page exists to rank for "AI essay writer".
- Other tool pages from the sitemap: `/paraphraser`, `/simplify-lengthen`, `/improve-fluency`,
  `/write-opposing-arguement` (sic), `/ai-summarizer`, `/autocomplete`, `/ai-chat`,
  `/for-researchers`, `/thesis-writing-assistant`, `/literature-review-generator`, `/start`.
- `/for-researchers` and `/thesis-writing-assistant` describe a four-part pre-submission review:
  peer review (rubric scoring), claim confidence, proofread, tone of voice. The thesis page cites
  **2,600+** styles (homepage says 10,000+; the extension listing says 1,700+). It endorses the
  OECD AI Principles and UNESCO ethics guidance and says "you stay the author".

### Comparison pages [Jenni]
Under `/tool-reviews/`: **Jenni vs ChatGPT**, **vs Claude**, **vs Paperpal** (all Sept 2026, hands-on
tests on one 201-word paragraph about lipid nanoparticles). Older `/blog/` comparisons: vs QuillBot,
Copy.ai, scite, Grammarly, Yomu AI, Afforai, plus ~14 "ChatGPT alternative" pages.
- vs ChatGPT (tested "GPT-5.6"): Jenni claims source suggestions before typing a query, citations
  that file into the reference list on insert, export with live Word citation fields. It concedes
  ChatGPT gave a deeper claim-by-claim critique, and reports 3 of 8 ChatGPT references wrong.
- vs Claude (tested "Claude Opus 5, high effort"): concedes Claude checked claims against the source
  text more carefully and refused to source unsupported claims; one wrong first author in chat,
  corrected in the generated file.
- vs Paperpal: concedes Paperpal's Word add-in, Google Docs/Overleaf extensions, 30+ journal
  pre-submission checks and PDF export; concludes "write in Jenni, check in Paperpal inside Word".
- These pages are unusually candid about the competitor's strengths.

### Testimonials page [Jenni]
Nine testimonials: PhDs, associate professors, a senior researcher, a journal editor. Institutions:
Eskisehir Osmangazi University, Munich Center for Mathematical Philosophy, Notre Dame of Marbel
University, Universiti Teknologi MARA, plus LPU, Chulalongkorn, UNESCO OWSD. No Trustpilot/G2
ratings cited.

### Published papers / whitepaper [Jenni]
- `/published-papers`: 100+ peer-reviewed papers (2023–2026) said to be written with Jenni —
  MDPI, IEEE Access, Frontiers, veterinary/medical/agri/engineering journals.
- `/whitepaper`: "Beyond Detection: A Framework for Disclosure". Argues integrity rests on disclosure
  norms rather than detection; promotes an **AI Declaration** feature (a generated disclosure
  statement aligned with OECD/UNESCO). The PDF itself was not reachable.
- Whitepaper privacy line: Jenni does not train on user writing and its **upstream AI providers are
  contractually prohibited** from training on Jenni user data. (It does not name them.)

### Trust, privacy, terms, refunds [Jenni]
- **Privacy policy** (updated 28 Sept 2026): collects usage data, IP addresses, account data via
  **Firebase**; analytics via **PostHog**; the extension may call the **NIH PMC ID-conversion API**;
  Slack for user-initiated issue reports. **No LLM provider is named** (no OpenAI, Anthropic,
  Google AI, Azure). No GDPR/CCPA section; no entity or address in the policy. Retention: support
  mail 24 months; deleted session snapshots purged within 30 days, from backups within 60.
  Extension: no browsing-history tracking, snapshots made locally and uploaded only on confirm,
  analytics without page content; Google Docs import uses the user's existing Google session.
- Help-centre privacy page: writing not used to train Jenni models; third parties may process
  content "when needed" for an AI feature; only the minimum context is sent; no selling of
  documents; account deletion from Settings, some billing/legal records kept.
- **Terms** (last updated **27 April 2024** — older than the product): Delaware law; minimum age 13,
  parental permission under 18; auto-renew; cancel any time, effective at term end; not
  HIPAA/FISMA compliant. Submissions clause grants Jenni broad unrestricted use — the summariser
  read this as covering user submissions generally; it is most likely the standard feedback/ideas
  clause, but the wording was not checked verbatim. **No statement on AI detection, AI output
  ownership or academic integrity in the Terms.**
- **Refund policy** (jenni.ai/r): payments generally non-refundable; a refund is considered only
  for a product bug or service error that the user **demonstrates on a support call**. Terms add a
  14-day refund right for **EU users**. Cancellation is desktop-only (help centre); on downgrade all
  documents and library are kept, only limits change.
- AI-detection stance: nowhere does Jenni claim to evade detectors. Its stance is disclosure
  (AI Declaration, whitepaper) rather than detection. A 2023 blog post advises running work through
  a plagiarism checker and frames Jenni as a "co-writer". Third-party sites claim GPTZero flags
  Jenni output almost always — unverified.

---

## 2. Changelog (jenni.ai/changelog)

Only **five entries** are reachable. The changelog page has no pagination, archive, RSS or
previous/next links; the sitemap lists only `/changelog` itself; the Wayback Machine could not be
fetched. Older history could not be recovered with the permitted tools.

| Date | Title | One line |
|---|---|---|
| 2026-07-29 | Visualize Concepts | AI Chat draws concept/framework diagrams as Mermaid blocks (toggle diagram/code); also email change in Settings, "cited by" and "include preprints" filters, accessibility, mobile and export fixes. |
| 2026-08-12 | Citation Filters | Chat answers filterable by year, impact factor, citation count, preprint status; restrict sources to a collection; section-level context; better outline/title/autocomplete quality; equation repair; docx import fixes; large Mendeley imports fixed. |
| 2026-08-26 | Prompt Guidance | Directions typed into autocomplete persist as section prompts; document-level prompts; prompts sidebar; Zotero group libraries; dark PDF reader; chat input up to 50,000 characters; proofread moved server-side; proration shown before upgrade; localised dates. |
| 2026-09-09 | Charts | Native charts in the document from AI Chat (grouped/stacked bars, line, log-axis scatter, error bars, 95% CI bands, box, violin, histogram, forest, funnel); Sources button; citations inside peer-review comments; bold/italic kept in LaTeX/Word export; DOI resolution in search; peer/lit reviews survive closing the tab; Workflows on mobile. |
| 2026-09-23 | Viewer and Commenter Roles | Share as viewer or commenter (not only editor), explicitly pitched at supervisors; one-click "request edit access" emails the owner; **Research Gap Analysis workflow (beta)**; background document reviews; chat quality. |

**Cadence:** exactly every two weeks (14-day intervals, Tuesdays/Wednesdays), each a bundled
release with one headline feature and a long tail of improvements and fixes.

**Direction:** (a) from writing assistant toward a full research workspace — workflows for
literature review and gap analysis that run without a document; (b) **verification and review**
(claim confidence, source quality, peer review, background reviews); (c) the **supervisor/
collaboration** loop (roles, comments); (d) richer academic output (charts, diagrams, equations,
LaTeX/Word fidelity); (e) source control for students (filters by impact factor and citations,
collection-only grounding); (f) steady mobile, accessibility and localisation work (15 site
languages). The Word add-in waitlist suggests Word integration is next.

---

## 3. Blog (jenni.ai/blog)

- The English sitemap lists **~460 blog URLs**, plus SEO sections `/chat-gpt/` (77),
  `/artificial-intelligence/` (65), `/research-writing/` (21), `/research/` (21), `/essay/`,
  `/thesis-writing/`, `/academy/`, `/reviews/`, `/tool-reviews/`. The site is published in
  **15 languages** (sitemaps for it, es, ar, de, fr, hi, ko, pt, ja, zh-Hans, zh-Hant, tr, id, ru).
- Current output is about **one post a day**, all tagged "Guide" (late Aug 2026: single vs double
  blind review, results section, discussion section, keywords, abstract vs introduction, APA
  abstract, abstract length, conference proceedings, abstract examples, poster presentations).
- Themes (from sitemap slugs): research methods (sampling, cohort studies, thematic analysis,
  meta-analysis vs systematic review); essay types (argumentative, narrative, expository, college
  and personal statements, NHS essays); **citation-style how-tos** (APA vs MLA, Chicago, Vancouver,
  IEEE, Nature, AMA, citing websites/blogs); literature review (checklists, outlines, scoping vs
  systematic, research gaps, scholarly vs peer-reviewed sources); thesis (how to write one, defence
  prep, capstone, research proposal, grant writing, medical writing); and **competitor reviews**
  (Caktus, HyperWrite, Smodin, Charley, EssayGenius, Easy Essay) and "best AI writing software".
- **SEO strategy:** high-volume informational queries at both undergraduate essay level and
  postgraduate/research level, citation-style queries (high intent for a citation tool), and
  "X alternative"/"X vs Y" pages that capture competitors' brand traffic.
- Posts describing how Jenni's own citation search works: **none found** on the blog. The help
  centre (below) is the only first-party description, and it does not name data sources.

---

## 4. Browser extension

- Chrome Web Store: **"Jenni Web Importer"** (store slug `jenni-beta`, id
  `knofkelobfihppebfpbcbnfeeifldfgf`). **5.0 stars from 11 ratings, 20,000 users**, v1.22, updated
  10 Sept 2026, 1.63 MiB. Developer contact marc@jenni.ai; not declared as a trader (so EU
  consumer-rights notice applies).
- Purpose: save references and PDFs to the Jenni library from the page you are on; extracts
  title/authors/date/journal/DOI (also PMID, PMCID); saves to a chosen collection; "Save full PDF"
  for open-access papers; chat with clipped PDFs. Listing mentions autocomplete, paraphrasing and
  **1,700+** citation styles.
- Supported sites (help centre): arXiv, Nature, JSTOR, bioRxiv, PubMed, Lens.org, any `.pdf` link,
  any page with DOI/PMID/PMCID metadata; web-clipper page adds Google Scholar and Taylor & Francis.
  Unsupported: YouTube, Figma, Google Maps, Google Search results, chrome:// pages.
- Browsers: Chrome, Firefox (a "Jenni Web Importer" Firefox add-on exists), Edge, other Chromium.
- Permissions: the listing says it reads website content; it declares no sale of data. The exact
  manifest permission list was not visible to the fetcher. The privacy policy adds: no history
  tracking, local snapshots uploaded only on confirmation, Google Docs import via the user's own
  Google session.
- Observation: 20,000 users against a claimed 6M academics — the extension is a minor surface.

---

## 5. Video, tutorials, community

- Official tutorials: a YouTube playlist "Jenni AI Tutorial Series" linked from the help centre
  (`youtube.com/playlist?list=PLU-hRJV7r0RFJuMh_gYY4UqwGIayZLtJo`). **Video titles could not be
  retrieved** — YouTube returned only page chrome to the fetcher. Channel subscriber count unknown.
- Help centre (docs.jenni.ai, also served at help.jenni.ai): ~30 articles in seven groups —
  Getting started (incl. a "writing course"), Writing (editor, outline builder, equations, images,
  version history), AI tools (autocomplete, section prompts, chat, saved prompts, editing,
  reviews), Research (citation management, library, PDF reader, extension, open-access papers,
  academic terminology), Collaboration (sharing, comments, publishing, cloning), Export/Import,
  Account (billing, settings, language, login, mobile, privacy).
- Jenni Academy webinars (see §1).
- **Discord / community: none found.** No Discord link on the site or help centre; searches found
  only unrelated servers.
- Distribution is creator-led: an **influencer programme** paying **up to 30% commission**, aimed
  at TikTok, Instagram and Twitter creators with #collegetips/#studentlife content (contact
  justin@jenni.ai). The CEO has said influencer marketing (TikTok/Instagram) drove growth
  [3rd party: Sacra interview].

---

## 6. Technology, data and company facts

**Data sources**
- Jenni's public pages and help centre **do not name** their scholarly data providers. They say
  only "200M+ papers", "10M+ open-access full texts", and that open-access papers come "from
  publishers and repositories".
- The privacy policy names one scholarly API: NIH PMC ID conversion (extension only).
- Third parties (Sacra; paperguide.ai, a competitor) say Jenni's help material once stated citation
  metadata comes from **OpenAlex** and full text only from attached PDFs; others say "250M works via
  OpenAlex". 200–250M is consistent with OpenAlex's size. **Not verified on any current Jenni page.**
- Citation styles: from the Zotero CSL repository (help centre); five in the default dropdown.
- Import: BibTeX, Zotero (incl. group libraries), Mendeley, PDF with metadata extraction,
  DOI/PMID/PMCID/arXiv IDs, URLs. AI Chat sources: the current document, the library, and "web
  search" (provider not named), each switchable Off/Ask/On.
- Search filters: year, citation count, impact factor, peer-review status, preprints.

**Models**
- No current Jenni page names a model vendor. The FAQ question "Which AI models does Jenni use?"
  exists but its answer could not be read. The whitepaper refers to unnamed "upstream AI providers".
- [3rd party] Sacra (April 2024) reports Jenni was built on OpenAI's API with OpenAI spend of
  $20–30K/month then; the CEO in interview credited GPT-3 as the turning point. Current vendor
  mix is unknown.

**Company**
- Jenni AI, Inc. (Delaware) [Jenni, Terms]. CEO David Park [Jenni].
- [3rd party, unverified] Started 2019 as an SEO copywriting app on fine-tuned GPT-2; moved to
  GPT-3 SaaS in 2020; narrowed to academic essay writing in 2022. Teams in San Diego and Malaysia.
  Funding small (≈$850K estimated; AI Grant; an angel cheque from Jason Calacanis reported). ARR
  estimated $5.1M (Apr 2024, +481% YoY), with later reports of ~$10M revenue in 2025 and a
  23-person team; ~83% gross margin and ~16% monthly churn (Sacra estimates). The CEO said users
  split roughly half undergraduate, half graduate.

**Institutional partnerships** [Jenni]: LPU (India), Chulalongkorn (Thailand), UNESCO OWSD, Academy
webinars with Nnamdi Azikiwe University, TCC Africa, NUST, Makerere; testimonials from UiTM
(Malaysia), Eskisehir Osmangazi (Turkey), Notre Dame of Marbel (Philippines).

---

## Not found / not verified

- Changelog entries before 2026-07-29.
- FAQ answers (models, multilingual, mobile, plagiarism, citation freshness).
- Actual PPP prices for India or elsewhere; team list prices.
- YouTube video titles and channel size; any Discord.
- Exact Chrome extension permission manifest.
- Named LLM vendors and scholarly data providers on any current first-party page.
- Security certifications (SOC 2, ISO 27001), GDPR/FERPA statements — none published.

---

## Implications for a competitor (observations, not recommendations)

1. **The headline price is the annual price.** $12/$29 a month means $144/$348 a year up front;
   month-to-month is about $30/$73. A student comparing monthly prices sees a figure Jenni does not
   actually charge monthly.
2. **The free tier is a trial in disguise.** Five chat messages, three AI edits and three workflow
   runs are lifetime, not monthly; only autocomplete (10/day) renews.
3. **Refunds are hard to get.** Non-refundable except a bug demonstrated on a support call (EU users
   get 14 days). Cancellation is desktop-only.
4. **PPP pricing exists** and is applied automatically, and the institutional push targets India,
   Thailand, Malaysia, the Philippines, Turkey and Africa — the same price-sensitive markets.
5. **Supervisor workflows are a current focus.** The 23 Sept 2026 release added viewer/commenter
   roles explicitly for supervisors, with "request edit access" by email.
6. **Verification is the marketing centre:** claim confidence with five verdicts (unsupported, weakly
   supported, overstated, misrepresented, contradicted), source quality, peer-review simulation,
   and "every claim traceable to the PDF location".
7. **Integrity position is disclosure, not detection.** An AI Declaration generator and an
   OECD/UNESCO-aligned whitepaper; no detector-evasion claims; the "AI essay writer" page says it
   will not write whole essays — while still ranking for that phrase.
8. **Fast, regular shipping:** a fortnightly release train with one headline feature each, recently
   charts, Mermaid diagrams, citation filters, document/section prompts, research-gap workflow.
9. **Workflows run without a document** (literature review, research gap analysis), with results
   persisting if the tab is closed.
10. **Students can filter sources by impact factor, citation count, year and preprint status**, and
    restrict chat to one collection.
11. **Data-source opacity:** 200M+ papers is claimed but the provider is never named on current
    pages; third parties attribute it to OpenAlex metadata with full text only from attached PDFs.
12. **Model opacity:** no vendor named in the privacy policy or FAQ text that could be read; only
    "upstream AI providers ... contractually prohibited from training".
13. **Thin compliance story for institutions:** no SOC 2, GDPR, FERPA or SSO claims; privacy policy
    names no entity, address or LLM subprocessors; Terms dated April 2024.
14. **Inconsistent numbers across their own pages:** 5M vs 6M academics; 1,700+ vs 2,600+ vs
    10,000+ citation styles; extension listed as Pro-only on pricing but free elsewhere.
15. **Word is not yet covered:** the Word add-in is waitlist-only; Paperpal's Word/Google Docs/Overleaf
    presence is the gap Jenni concedes in its own comparison.
16. **Distribution is SEO plus student influencers:** ~460 English blog posts (one a day), 15
    languages, "ChatGPT alternative" and "X vs Y" pages, and a 30%-commission TikTok/Instagram
    creator programme aimed at undergraduates.
17. **Candid head-to-heads:** their own comparison pages admit ChatGPT and Claude critique claims
    more deeply; Jenni's pitch is the workflow (cite-on-insert, live Word citation fields), not
    smarter answers.
18. **The extension is small:** 20,000 users and 11 ratings, against a claimed 6M user base.
19. **No community channel:** no Discord or forum; support is live chat (Plus) and priority (Pro).
