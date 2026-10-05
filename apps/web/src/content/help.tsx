/**
 * The help articles behind `/help` (2026-10-04, from the Jenni study: Jenni has a help centre).
 *
 * Short, task-based, for a master's or PhD student in India. Every claim was checked against the
 * screens and the API on the day it was written — labels are quoted as the screens print them,
 * and the allowance numbers are read from `@tc/config`, so they cannot drift from what the
 * product charges. Where the code was unclear (the trial's export scope, the Chrome add-on, which
 * is not published), the article says nothing rather than guess. When a screen's wording changes,
 * change the article with it.
 */

import { METERED_ACTIONS, PLAN_LIMITS } from '@tc/config';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Kbd } from '@/components/ui/primitives';
import { allowanceName } from '@/lib/action-names';

export type HelpArticle = {
  slug: string;
  title: string;
  /** One line for the index. */
  summary: string;
  body: () => ReactNode;
};

const H2 = ({ children }: { children: ReactNode }) => (
  <h2 className="mt-8 text-balance text-[17px] font-bold leading-snug text-ink">{children}</h2>
);
const P = ({ children }: { children: ReactNode }) => <p className="mt-2 text-muted">{children}</p>;
const Steps = ({ children }: { children: ReactNode }) => (
  <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted">{children}</ol>
);
const List = ({ children }: { children: ReactNode }) => (
  <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">{children}</ul>
);
/** A label exactly as the screen prints it. */
const L = ({ children }: { children: ReactNode }) => (
  <strong className="font-semibold text-ink">{children}</strong>
);
const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="underline">
    {children}
  </Link>
);

const TRIAL = PLAN_LIMITS.FREE_TRIAL;
const STUDENT = PLAN_LIMITS.STUDENT_MONTHLY;
const TRIAL_DAYS = TRIAL.trialDays ?? 14;
const MB = 1024 * 1024;

export const HELP_ARTICLES: readonly HelpArticle[] = [
  {
    slug: 'getting-started',
    title: 'Getting started: proposal, outline, writing',
    summary: 'Create a thesis, turn it into a proposal, get an outline with all its chapters.',
    body: () => (
      <>
        <P>
          A thesis here moves through three screens: the proposal, the outline and the chapters you
          write in. You can go back to any of them at any time.
        </P>
        <H2>1. Create the thesis</H2>
        <Steps>
          <li>
            On <A href="/app">Your theses</A>, give it a <L>Working title</L>. You can change it
            later.
          </li>
          <li>
            Choose where it starts: <L>A paper I have written</L> (it reads the paper and builds the
            proposal around it) or <L>A topic</L> (it checks the literature and helps you find the
            gap).
          </li>
          <li>
            Optionally pick a <L>Citation style</L>. Skip it to keep APA 7; you can change it at any
            time and every citation follows. A preview shows how a citation will look.
          </li>
          <li>
            Press <L>Create thesis</L>. You land on the proposal.
          </li>
        </Steps>
        <H2>2. The proposal</H2>
        <List>
          <li>
            <strong>From a paper:</strong> upload your paper (PDF or Word). It is read once, and its
            references become your starting library. This takes a minute or two.
          </li>
          <li>
            <strong>From a topic:</strong> answer two or three questions in a short conversation.
            You can tap an option or type your own answer, and change an earlier answer with{' '}
            <L>Edit</L> while turns remain. <L>Fill it in myself instead</L> skips the conversation.
          </li>
        </List>
        <P>
          Either way you end with a form you can edit: working title, problem statement, objectives
          and <L>Why this is not yet fully answered</L>. Write that last one yourself; it is the
          part a committee reads closely.
        </P>
        <H2>3. The outline</H2>
        <P>
          Press <L>Continue to the editor</L>. If the thesis has only its first empty chapter, the
          outline is built in the background and its chapters appear in the chapter list within a
          minute. On the <L>Outline</L> screen you can regenerate it, add, move, rename and delete
          chapters and sections, and keep a glossary. Chapters you have written in are never
          overwritten or deleted by a regeneration.
        </P>
        <H2>4. Write</H2>
        <P>
          Open a chapter and write as you normally would. Ask for a suggestion when you want one
          (see <A href="/help/suggestions">Suggestions</A>); the tools panel beside the text has
          your sources, papers, citations, chat, checks and comments. Every change is saved as you
          type.
        </P>
        <P>
          To reorder your text, put the cursor in a paragraph, table or figure and press{' '}
          <Kbd>Ctrl+Shift+↑</Kbd> or <Kbd>Ctrl+Shift+↓</Kbd> (<Kbd>⌘+Shift</Kbd> on a Mac). The
          chapter title never moves, and nothing moves while a suggestion is showing.
        </P>
        <H2>Building a whole chapter</H2>
        <P>
          From a thesis&rsquo;s <L>More</L> menu, <L>Build a chapter</L> plans a chapter from your
          objectives, writes each section from your library, checks it and has an examiner read it.
          Planning is free; the build is one unit of your monthly allowance. Every section arrives
          in your chapter as a draft: nothing enters the thesis until you accept it.
        </P>
      </>
    ),
  },
  {
    slug: 'suggestions',
    title: 'Suggestions',
    summary: 'Ask for one, keep all or part of it, refine it, rate it, or dismiss it.',
    body: () => (
      <>
        <P>
          A suggestion is the next sentence or two, written in grey after your cursor. It is not in
          your chapter until you accept it.
        </P>
        <H2>Ask for one</H2>
        <List>
          <li>
            Press <Kbd>Ctrl+/</Kbd> (<Kbd>⌘+/</Kbd> on a Mac) or the <L>Suggest</L> button.
          </li>
          <li>
            Or turn on <L>Suggest without my asking</L> in <A href="/app/settings">Settings</A>: a
            suggestion then appears about a second after you stop typing.
          </li>
          <li>
            <Kbd>Shift+→</Kbd> lets you say first what the next sentence should do.
          </li>
        </List>
        <H2>Keep it, or part of it</H2>
        <List>
          <li>
            <Kbd>Tab</Kbd> or <Kbd>→</Kbd>, or <L>Accept</L>: keep the whole suggestion.
          </li>
          <li>
            <Kbd>Alt+→</Kbd> or <L>One word</L>: keep one word at a time.
          </li>
          <li>
            <Kbd>Esc</Kbd> or <L>Dismiss</L>: throw it away.
          </li>
        </List>
        <P>The buttons are on the bar under the text, so all of this works on a phone too.</P>
        <H2>Refine it</H2>
        <P>
          <L>Refine</L> asks again with a change: <L>Shorter</L>, <L>More formal</L>,{' '}
          <L>Stay closer to my topic</L>, <L>Complete this paragraph</L>,{' '}
          <L>A contrasting finding</L>, or <L>Your own instruction…</L>. Each refined suggestion
          uses one of your Assist suggestions.
        </P>
        <P>
          After a refine, <L>‹</L> and <L>›</L> on the bar step back to the earlier suggestions at
          the same place, so a better first try is not lost.
        </P>
        <H2>Rate it</H2>
        <P>
          The thumbs up and down mark a suggestion as useful or not. Rating it does not keep or
          dismiss it, and it uses nothing from your allowance.
        </P>
        <H2>Why it only cites your library</H2>
        <P>
          A suggestion sees your chapter around the cursor, your outline and glossary, and passages
          from the papers in your library — or only from the sources you pinned in the{' '}
          <L>Sources</L> tab, if you pinned some. It may only cite a passage it was given. If it
          names anything else, that citation is removed before you see it. This is how every
          citation in your thesis stays traceable to something you can open and read.
        </P>
        <P>
          When a suggestion cites a paper, <L>Evidence</L> on the bar opens the passage it stands
          on. Read it before you keep the sentence: a citation is a pointer to a passage, not proof.
        </P>
        <H2>What counts</H2>
        <P>
          A suggestion counts against your month when it is generated, whether you keep it or
          dismiss it. Nothing you type counts. Every accepted suggestion stays marked as AI-written
          in your document.
        </P>
      </>
    ),
  },
  {
    slug: 'citations',
    title: 'Citations and styles',
    summary: 'Insert a citation, change the style, the bibliography, and the Word file.',
    body: () => (
      <>
        <H2>Insert a citation</H2>
        <List>
          <li>
            Type <Kbd>@</Kbd> after a space or a bracket. A list of your library opens; choose a
            source with the arrow keys and press <Kbd>Enter</Kbd>.
          </li>
          <li>Accept a suggestion that cites a source; the citation comes with it.</li>
          <li>
            In the <L>Papers</L> tab, search, <L>Add to library</L>, then <L>Cite here</L> puts the
            citation at your cursor.
          </li>
          <li>
            After a sentence that makes a claim, a box <L>Sources that may support that sentence</L>{' '}
            may appear with <L>Insert citation</L> on each. This uses your citation suggestions
            allowance only when it finds something.
          </li>
          <li>
            Not sure yet? Type <Kbd>/</Kbd> and choose <L>Citation needed</L> to leave a marker to
            come back to.
          </li>
        </List>
        <H2>Change the style</H2>
        <Steps>
          <li>
            Open the <L>Citations</L> tab beside your chapter.
          </li>
          <li>
            Pick a style from <L>Citation style</L>, or search all of them by name, journal or
            publisher.
          </li>
          <li>
            A preview shows one citation and one bibliography entry in the style you are on, for an
            example reference.
          </li>
        </Steps>
        <P>
          Changing the style re-renders every citation in the thesis; none of your text is edited.
          Footnote styles turn each citation into a numbered note.
        </P>
        <H2>The bibliography</H2>
        <P>
          The <L>Bibliography</L> list shows what your chapters actually cite, never the whole
          library. <L>Checks</L> lists citations without a source, sources nothing cites and
          citations typed as plain text. <L>Paste a reference</L> looks references up in Crossref
          before they can be added.
        </P>
        <H2>The Word file</H2>
        <P>
          On <L>Submit</L>, under <L>Citations in the .docx</L>:
        </P>
        <List>
          <li>
            <L>Plain text.</L> As they appear in the editor.
          </li>
          <li>
            <L>Linked to the references.</L> Each citation links to its entry in the reference list.
            Works in Word, LibreOffice and Google Docs.
          </li>
          <li>
            <L>Word citations.</L> Your sources go into Word&rsquo;s References › Manage Sources,
            and you can restyle or update them there. Microsoft Word only.
          </li>
        </List>
        <P>
          The PDF always uses plain citations. The chapter <L>Export .docx</L> in the editor is
          always plain. There are also a LaTeX project for Overleaf and a single web page.
        </P>
        <P>
          Before you submit, the <L>Citation report</L> lists every citation problem in the thesis
          on one page. No AI runs when you open it.
        </P>
      </>
    ),
  },
  {
    slug: 'library',
    title: 'Your library',
    summary: 'Add papers and PDFs, what the badges mean, duplicates, papers without full text.',
    body: () => (
      <>
        <P>
          Everything the AI may cite comes from your library, on the <L>Sources</L> page of each
          thesis. Each thesis has its own.
        </P>
        <H2>Add papers</H2>
        <List>
          <li>
            <L>Add a PDF</L> — the paper is read in full.
          </li>
          <li>
            <L>Import .bib / .ris</L> from Zotero, Mendeley, EndNote or any reference manager.
          </li>
          <li>
            <L>Discover</L> searches the literature for your thesis and groups what it finds by
            theme. Tick the papers you want and add them; nothing enters your library until you do.
          </li>
          <li>
            The <L>Papers</L> tab in the editor and the <L>Find papers</L> chat scope have{' '}
            <L>Add to library</L> on each result.
          </li>
          <li>
            <L>Paste a reference</L> in the <L>Citations</L> tab.
          </li>
          <li>If you started from your own paper, its references were added for you.</li>
        </List>
        <P>
          PDF limits: on the free trial, {TRIAL.libraryPdfs} library PDFs of up to{' '}
          {TRIAL.pdfMaxBytes / MB} MB and {TRIAL.pdfMaxPages} pages each; on a paid plan,{' '}
          {STUDENT.libraryPdfs} PDFs of up to {STUDENT.pdfMaxBytes / MB} MB and{' '}
          {STUDENT.pdfMaxPages} pages.
        </P>
        <H2>The badges</H2>
        <List>
          <li>
            <L>Full text</L> — the whole paper was read; the AI can quote any part of it.
          </li>
          <li>
            <L>Abstract only</L> — only the abstract could be read.
          </li>
          <li>
            <L>Looking it up…</L> — still being matched and fetched.
          </li>
          <li>
            <L>Not found</L> — the reference could not be matched. <L>Fix this reference</L> lets
            you correct it or give its DOI.
          </li>
          <li>
            <L>Added automatically</L> — found for you because nothing in your library covered what
            you were writing (switch this off with <L>Find sources for me</L> in Settings).
          </li>
          <li>
            <L>Cited by</L>, <L>Open access</L> and <L>Journal citedness</L> — hover each for what
            it means. A retracted paper and a preprint are marked as such.
          </li>
        </List>
        <H2>Duplicates</H2>
        <P>
          <L>Possible duplicates</L> lists the same work held twice, which would appear twice in
          your bibliography. <L>Merge</L> keeps one and moves the other&rsquo;s citations and pins
          onto it. Nothing is merged unless you press it.
        </P>
        <H2>Papers without full text</H2>
        <P>
          The <L>Without full text</L> filter lists papers the AI can only quote from the abstract,
          with the reason. If you have the paper, <L>Add the PDF</L> and it is read in full; the
          badge changes to <L>Full text</L> when it is done.
        </P>
        <H2>Pins and export</H2>
        <P>
          In the editor&rsquo;s <L>Sources</L> tab, pin some papers to make a chapter&rsquo;s
          suggestions draw only on them. <L>Export</L> on the Sources page downloads the library as
          .bib, .ris or .csv.
        </P>
      </>
    ),
  },
  {
    slug: 'chat',
    title: 'Chat',
    summary: 'Ask your library or your own thesis, name a paper with @, reuse prompts with /.',
    body: () => (
      <>
        <H2>Three scopes</H2>
        <List>
          <li>
            <L>Library</L> — answers come only from your library, and cite the passage they came
            from.
          </li>
          <li>
            <L>This thesis</L> — answers come only from what you have written. Nothing there is
            citable: your own draft is not a source.
          </li>
          <li>
            <L>Find papers</L> — searches the literature and shows real papers, with{' '}
            <L>Add to library</L>. It does not answer the question, and it uses no allowance.
          </li>
        </List>
        <P>
          A question in Library or This thesis uses one of your questions to your library. If chat
          refuses — because nothing in your library relates to the question, or your filters left
          nothing — the question is given back.
        </P>
        <H2>Research deeply</H2>
        <P>
          For a question that deserves a literature review rather than an answer, switch on{' '}
          <L>Research deeply</L> under the chat box before you ask. The question is planned in three
          to five parts, your library and the scholarly indexes are searched for each part, and the
          answer comes part by part with a citation on every finding, where the studies disagree,
          what they do not cover, and a few lines on how to use it in your section. It takes about a
          minute, every step is shown, and it uses one deep research question (one on the trial,
          three a month on the student plan), not a chat question. Papers it found are listed under
          the answer with <L>Add to library</L>; nothing is cited in your thesis until it is in your
          library.
        </P>
        <H2>Name a paper with @</H2>
        <P>
          In the Library scope, type <Kbd>@</Kbd> and choose a paper. The answer then comes only
          from the papers you named. A paper with no readable text yet is marked.
        </P>
        <H2>Reuse a prompt with /</H2>
        <Steps>
          <li>
            Write a question you will ask again, then <L>Save as prompt</L>.
          </li>
          <li>
            Next time, type <Kbd>/</Kbd> at the start of the box and choose it. It fills the box;
            nothing is sent until you press <L>Ask</L>.
          </li>
        </Steps>
        <H2>Ask about a passage</H2>
        <P>
          Select at least a sentence in your chapter and press <L>Ask chat</L> on the toolbar that
          appears. The passage is put in the chat box for you to finish the question.
        </P>
        <H2>Use an answer</H2>
        <P>
          <L>Copy</L> copies an answer as plain text. <L>Add to document</L> puts it in your chapter
          with its citations, marked as AI-written.
        </P>
      </>
    ),
  },
  {
    slug: 'checks',
    title: 'Checks before submission',
    summary: 'Every check in one place: what each does and what it uses.',
    body: () => (
      <>
        <P>
          The <L>Flags</L> tab beside your chapter starts with <L>Every check, in one list</L>. What
          each one does:
        </P>
        <H2>Coherence and claim support</H2>
        <P>
          <L>Check coherence</L> looks for contradictions between chapters, terms used against your
          glossary, claims with no citation, claims your sources do not support, and drift from
          scope. Findings arrive as flags you can go to, resolve or ignore with a reason. One
          coherence check from your monthly allowance (not included in the free trial).
        </P>
        <H2>Examiner review</H2>
        <P>
          <L>Examiner review</L> has a strict examiner read each section of a chapter you wrote
          against the passages it cites, and flag sentences. Write at least three sentences of your
          own first. One examiner review from your allowance.
        </P>
        <H2>Proofreading</H2>
        <P>
          <L>Proofread this chapter</L> finds spelling, grammar and punctuation mistakes, up to
          2,000 words a run. Each correction is shown to you, and nothing changes until you accept
          it. It corrects mistakes; it does not swap your words for different ones. One section
          command per run.
        </P>
        <H2>Too close to a source</H2>
        <P>
          <L>Check this chapter</L> finds sentences that reuse a cited paper&rsquo;s wording. If
          they are its words, quote them and cite the page. Nothing is sent to a model; it uses no
          allowance. The <L>Originality check</L> page does the same for a pasted paragraph.
        </P>
        <H2>Citation report</H2>
        <P>
          One page with every citation problem: retracted papers, weak or unsupported citations,
          sources never cited, &ldquo;citation needed&rdquo; markers. No AI runs when you open it.
          Its support findings come from the coherence check.
        </P>
        <H2>Formatting</H2>
        <P>
          On <L>Submit</L>, ten checks against your university template: front matter, abstract
          length, headings, captions, contents list, citations, page setup and word bounds. Each
          names exactly what is wrong. The .docx is always available; the PDF waits for the checks,
          or for <L>Build the PDF anyway</L> with your reason.
        </P>
        <H2>Viva practice</H2>
        <P>
          <L>Ask me questions</L> gives questions an examiner could ask about what you wrote. Type
          an answer as you would say it and <L>Get feedback</L>. A question set, or feedback on one
          answer, is one viva use.
        </P>
      </>
    ),
  },
  {
    slug: 'guide',
    title: 'Working with your guide',
    summary: 'Share with roles, comments, the review queue, the response table, read-only links.',
    body: () => (
      <>
        <H2>Share</H2>
        <Steps>
          <li>
            In the editor, press <L>Share</L>.
          </li>
          <li>
            Enter their email and choose a role: <L>Guide / committee</L> (can comment and suggest),{' '}
            <L>Reader</L> (can read), or, where offered, <L>Co-author</L> (can edit with you, live).
          </li>
          <li>
            Press <L>Send</L>. They sign in with that address.
          </li>
        </Steps>
        <P>
          People you share with see what you have written — never your sources, your AI or your
          usage. Change a role or <L>Remove</L> someone under <L>Who has access</L>; their comments
          are kept.
        </P>
        <H2>A read-only link</H2>
        <P>
          <L>Turn on a read-only link</L> lets anyone with the link read the text: no comments, no
          sources, no email, and never editing. The link is shown once; copy it then.{' '}
          <L>Turn off</L> stops it at once, and <L>Make a new link</L> replaces it.
        </P>
        <H2>Comments</H2>
        <P>
          Your guide selects a passage and writes a comment. You see it in the <L>Review</L> tab on
          that passage, and on the <L>Review</L> page for the whole thesis. You can comment on your
          own text too: select it and press <L>Comment</L>.
        </P>
        <P>
          Feedback that came by email? Paste it and <L>Split into comments</L>. A Word file your
          guide marked up? Upload it and every comment comes across with its sentence.
        </P>
        <H2>Answer each comment</H2>
        <List>
          <li>
            <L>I revised it myself</L>, or <L>Not changing it</L> with your reason.
          </li>
          <li>
            <L>Suggest a revision</L> drafts a change for you to read first; <L>Accept</L> applies
            it, and the earlier text stays in version history. It uses one section command.
          </li>
          <li>
            <L>Mark round complete</L> emails your guide a summary and checks what changed.
          </li>
        </List>
        <P>
          <L>Export the response table</L> gives a Word table of every comment, where it was and
          what you did — the response to committee most departments ask for.
        </P>
        <H2>Make a copy</H2>
        <P>
          <L>Make a copy</L> creates a separate thesis of your own with the chapters, outline and
          library. Nobody you shared with comes with it, and it uses none of your allowance.
        </P>
      </>
    ),
  },
  {
    slug: 'allowances',
    title: 'Allowances and the free trial',
    summary: 'What counts against your month, what is free, and what happens when the trial ends.',
    body: () => (
      <>
        <H2>Each month</H2>
        <P>
          The AI features have a monthly allowance. It resets at 00:00 UTC on the 1st of each month.
          Your usage is on your <A href="/app/account">account page</A>.
        </P>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="help-allowances">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="py-1.5 pr-3 font-semibold">Allowance</th>
                <th className="py-1.5 pr-3 font-semibold">Free trial</th>
                <th className="py-1.5 font-semibold">Paid plan</th>
              </tr>
            </thead>
            <tbody>
              {METERED_ACTIONS.map((action) => (
                <tr key={action} className="border-b border-line">
                  <td className="py-1.5 pr-3 text-ink">{allowanceName(action)}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-muted">
                    {TRIAL.caps[action] > 0 ? TRIAL.caps[action] : 'Not included'}
                  </td>
                  <td className="py-1.5 tabular-nums text-muted">{STUDENT.caps[action]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          Prices are on the <A href="/pricing">pricing page</A>.
        </P>
        <H2>What counts</H2>
        <List>
          <li>
            A suggestion counts when it is generated, kept or dismissed. A refine is one more.
          </li>
          <li>
            Section commands cover the selection commands (Expand, Formalise, Simplify, Shorten,
            Check consistency), proofreading, <L>Suggest a revision</L> on a comment and{' '}
            <L>Suggest fix</L> on a flag.
          </li>
          <li>If the AI fails, or chat refuses a question, the unit is given back.</li>
          <li>Nothing you type counts.</li>
        </List>
        <H2>What is free</H2>
        <P>
          Writing, editing and exporting; the too-close-to-a-source and originality checks; the
          citation report; the formatting checks; finding papers; sharing; comments; making a copy;
          planning a chapter build.
        </P>
        <H2>When an allowance runs out</H2>
        <P>
          That one feature stops until the 1st. Everything else carries on, and your documents are
          untouched.
        </P>
        <H2>The free trial</H2>
        <P>
          The free trial lasts {TRIAL_DAYS} days from sign-up. The days left are shown on your
          theses and account pages. When it ends, your theses stay and you can keep writing, editing
          and exporting; the AI features need a plan.
        </P>
      </>
    ),
  },
  {
    slug: 'privacy',
    title: 'Privacy',
    summary: 'What happens to your text. The full statement is on the privacy page.',
    body: () => (
      <>
        <P>
          The full statement is <A href="/privacy">What we do with your text</A>. In short, from
          that page:
        </P>
        <List>
          <li>
            Your thesis, sources and prompts are never used to train a model, and requests are
            marked so the AI provider does not keep them.
          </li>
          <li>
            Text is sent only when you ask for something, unless you switch on suggestions without
            asking, and then only after you pause.
          </li>
          <li>
            Every AI call is recorded with its model, tokens, cost and time, but not your text.
          </li>
          <li>
            Only you, and the people you share a thesis with, in the role you chose, can see it. An
            administrator can open a thesis to read it, never to change it; every time, it is
            recorded and you are emailed.
          </li>
          <li>
            You can export any chapter at any time, and delete your account from the account page.
            After seven days your work is erased; backups age out within thirty days.
          </li>
          <li>
            We do not build &ldquo;humanising&rdquo; or detector-evasion features, and what the AI
            wrote stays marked in your document.
          </li>
        </List>
      </>
    ),
  },
];

export function helpArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.slug === slug);
}
