/**
 * The window that opens from the toolbar, the keyboard shortcut or the right-click item —
 * ADR-0031, ADR-0069, redrawn in 0.4.0 (ADR-0156). It works out what the tab offers (one paper, a
 * results page, a PDF), then draws the states of `state.ts`.
 *
 * Three parts, kept calm: a header (the mark, refresh, settings, close); one view — the page's
 * paper with one "Save to Thesis Copilot" button, or the settings; and the account row (who is
 * signed in, "Open Thesis Copilot", a "…" menu), or "Sign in".
 *
 * Everything shown comes from the page or from the API, so it is written with `textContent`,
 * never as HTML. The only markup is the static `popup.html`.
 */

import { WEB_URL } from './config.js';
import { BULK_MAX, itemsFrom, type RawListing, siteName } from './lists.js';
import type {
  Account,
  Collection,
  ItemResult,
  Progress,
  Reply,
  Request,
  SaveJob,
  SaveResult,
  Thesis,
} from './messages.js';
import { collectPageMeta, collectResultList } from './page.js';
import { isPdfUrl, type Paper, paperFrom, pdfFilename } from './paper.js';
import { freshPending, PENDING_KEY } from './pending.js';
import {
  INLINE_KEY,
  type InlineSettings,
  inlineOn,
  readInline,
  readTheme,
  siteKey,
  THEME_KEY,
  type Theme,
  withAll,
  withSite,
} from './settings.js';
import {
  type Event,
  initial,
  overCap,
  pendingKeys,
  reduce,
  singleResult,
  type Target,
  tally,
  type View,
} from './state.js';

const app = document.getElementById('app') as HTMLElement;
const settingsPanel = document.getElementById('settings') as HTMLElement;
const accountRow = document.getElementById('account') as HTMLElement;

// ---- Talking to the service worker -------------------------------------------------------------

function ask<T>(request: Request): Promise<Reply<T>> {
  return (chrome.runtime.sendMessage(request) as Promise<Reply<T>>).catch(
    (error: unknown): Reply<T> => ({ ok: false, status: 0, message: String(error).slice(0, 200) }),
  );
}

// ---- What the popup remembers -------------------------------------------------------------------

/** The thesis and collection chosen last. */
type Remembered = { lastDocumentId?: unknown; lastCollectionId?: unknown };

const context = {
  documentId: '',
  collectionId: '' as string, // '' = no collection
  collections: [] as Collection[],
  collectionsFor: '',
  creating: false,
  runId: '',
  attachPdf: true,
  /** A results page: the list is shown only after "Select several". */
  listOpen: false,
  /** "How it works" under "No paper found on this page". */
  howOpen: false,
  /** The tab's host, for "This site" in the settings; '' when it is not a website. */
  host: '',
  /** undefined: not known yet; null: signed out. */
  account: undefined as Account | null | undefined,
};

let view: View = initial;

function dispatch(event: Event): void {
  view = reduce(view, event);
  draw();
  drawAccount();
}

// ---- Small DOM helpers ----------------------------------------------------------------------------

type Options = {
  text?: string;
  className?: string;
  testId?: string;
  /** Names the element across redraws so focus stays where the student left it. */
  fid?: string;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: Options = {},
  ...children: Array<Node | null>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.text !== undefined) node.textContent = options.text;
  if (options.className) node.className = options.className;
  if (options.testId) node.dataset.testid = options.testId;
  if (options.fid) node.dataset.fid = options.fid;
  for (const child of children) if (child) node.append(child);
  return node;
}

function button(
  label: string,
  onClick: () => void,
  options: Options & { secondary?: boolean; small?: boolean; disabled?: boolean } = {},
): HTMLButtonElement {
  const classes = ['btn', options.secondary ? 'secondary' : '', options.small ? 'small' : '']
    .filter(Boolean)
    .join(' ');
  const node = el('button', { ...options, text: label, className: options.className ?? classes });
  node.type = 'button';
  node.disabled = Boolean(options.disabled);
  node.addEventListener('click', onClick);
  return node;
}

function linkButton(label: string, onClick: () => void, options: Options = {}): HTMLButtonElement {
  return button(label, onClick, { ...options, className: 'link-button' });
}

/** Opens Thesis Copilot at `path` in a new tab. No `tabs` permission is needed to open one. */
function openSite(path: string): void {
  void chrome.tabs.create({ url: `${WEB_URL}${path}` });
  window.close();
}

function siteButton(
  label: string,
  path: string,
  options: Options & { secondary?: boolean; small?: boolean } = {},
) {
  const node = button(label, () => openSite(path), { testId: 'open-site', ...options });
  node.dataset.href = `${WEB_URL}${path}`;
  return node;
}

const docPath = (documentId: string) => `/app/d/${encodeURIComponent(documentId)}`;
/** The paper in the reader — the in-app page for one source. */
const sourcePath = (documentId: string, sourceId: string) =>
  `${docPath(documentId)}/sources/${encodeURIComponent(sourceId)}`;

function spinnerLine(text: string): HTMLElement {
  const line = el('p', { className: 'muted small' });
  line.append(el('span', { className: 'spinner' }), document.createTextNode(text));
  return line;
}

/** One short line saying what went wrong, or what is worth knowing. */
function line(kind: 'error' | 'warn' | 'note', text: string): HTMLElement {
  return el('p', { className: `line ${kind}`, text, testId: 'message' });
}

const SVG = 'http://www.w3.org/2000/svg';
function checkIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'tick');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M20 6 9 17l-5-5');
  svg.append(path);
  return svg;
}

// ---- The paper ----------------------------------------------------------------------------------------

function paperCard(target: Extract<Target, { mode: 'single' }>): HTMLElement {
  const { paper } = target;
  const people = [paper.byline, paper.year].filter(Boolean).join(' · ');
  const eyebrow = target.fromLink ? 'From the link' : target.pdf ? 'PDF' : null;
  return el(
    'section',
    { className: 'paper', testId: 'paper' },
    eyebrow ? el('p', { className: 'eyebrow', text: eyebrow }) : null,
    el('p', { className: 'title', text: paper.title || 'Untitled paper' }),
    people ? el('p', { className: 'byline', text: people }) : null,
    paper.venue ? el('p', { className: 'venue', text: paper.venue }) : null,
  );
}

// ---- Thesis and collection pickers -------------------------------------------------------------------

function thesisTitle(theses: Thesis[]): string {
  return theses.find((t) => t.id === context.documentId)?.title || 'your thesis';
}

function pickers(theses: Thesis[], locked: boolean): HTMLElement {
  const thesis = el('select', { testId: 'thesis', fid: 'thesis' });
  thesis.id = 'thesis';
  for (const t of theses) {
    const option = el('option', { text: t.title || 'Untitled thesis' });
    option.value = t.id;
    thesis.append(option);
  }
  thesis.value = context.documentId;
  thesis.disabled = locked;
  thesis.addEventListener('change', () => {
    context.documentId = thesis.value;
    context.collectionId = '';
    void chrome.storage.local.set({ lastDocumentId: thesis.value });
    void loadCollections();
  });
  const thesisLabel = el('label', { text: 'Thesis' });
  thesisLabel.htmlFor = 'thesis';

  const collection = el('select', { testId: 'collection', fid: 'collection' });
  collection.id = 'collection';
  const none = el('option', { text: 'None' });
  none.value = '';
  collection.append(none);
  for (const c of context.collectionsFor === context.documentId ? context.collections : []) {
    const option = el('option', { text: `${c.name} (${c.count})` });
    option.value = c.id;
    collection.append(option);
  }
  const create = el('option', { text: 'New collection…' });
  create.value = '__new__';
  collection.append(create);
  collection.value = context.creating ? '__new__' : context.collectionId;
  collection.disabled = locked;
  collection.addEventListener('change', () => {
    context.creating = collection.value === '__new__';
    if (!context.creating) {
      context.collectionId = collection.value;
      void chrome.storage.local.set({ lastCollectionId: collection.value });
    }
    draw();
    if (context.creating) focusFid('new-collection');
  });
  const collectionLabel = el('label', { text: 'Collection' });
  collectionLabel.htmlFor = 'collection';

  const fields = el(
    'div',
    { className: 'pickers' },
    thesisLabel,
    thesis,
    collectionLabel,
    collection,
  );
  if (context.creating && !locked) fields.append(newCollectionRow());
  return fields;
}

function newCollectionRow(): HTMLElement {
  const input = el('input', { testId: 'new-collection', fid: 'new-collection' });
  input.type = 'text';
  input.maxLength = 60;
  input.placeholder = 'Name, e.g. Chapter 2';
  input.setAttribute('aria-label', 'New collection name');
  const status = el('p', { className: 'small muted' });
  const submit = async () => {
    const name = input.value.trim();
    if (!name) {
      status.textContent = 'Give the collection a name.';
      return;
    }
    add.disabled = true;
    const reply = await ask<Collection>({
      type: 'create-collection',
      documentId: context.documentId,
      name,
    });
    add.disabled = false;
    if (!reply.ok) {
      status.textContent = reply.message;
      return;
    }
    context.collections = [...context.collections, { ...reply.value, count: 0 }];
    context.collectionId = reply.value.id;
    context.creating = false;
    void chrome.storage.local.set({ lastCollectionId: reply.value.id });
    draw();
    focusFid('collection');
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      context.creating = false;
      draw();
      focusFid('collection');
    }
  });
  const add = button('Create', () => void submit(), {
    secondary: true,
    small: true,
    fid: 'create-collection',
  });
  return el(
    'div',
    { className: 'new-collection' },
    el('div', { className: 'inline-new' }, input, add),
    status,
  );
}

async function loadCollections(): Promise<void> {
  const documentId = context.documentId;
  context.collections = [];
  context.collectionsFor = '';
  draw();
  const reply = await ask<Collection[]>({ type: 'collections', documentId });
  if (documentId !== context.documentId) return;
  context.collections = reply.ok ? reply.value : [];
  context.collectionsFor = documentId;
  const stored = (await chrome.storage.local.get('lastCollectionId')) as Remembered;
  if (!context.collectionId && context.collections.some((c) => c.id === stored.lastCollectionId)) {
    context.collectionId = stored.lastCollectionId as string;
  }
  draw();
}

// ---- Saving ------------------------------------------------------------------------------------------

async function save(): Promise<void> {
  if (view.kind !== 'ready') return;
  const keys = pendingKeys(view);
  if (keys.length === 0) return;
  const { target } = view;
  const items: SaveJob['items'] =
    target.mode === 'single'
      ? [{ key: target.key, paper: target.paper }]
      : target.items
          .filter((i) => keys.includes(i.key))
          .map(({ key, ...paper }) => ({ key, paper }));
  const job: SaveJob = {
    runId: crypto.randomUUID(),
    documentId: context.documentId,
    collectionId: context.collectionId || null,
    items,
    // A PDF that is the only thing naming the paper is always sent: it is the paper.
    pdf:
      target.mode === 'single' && target.pdf && (context.attachPdf || target.pdf.onlyThePdf)
        ? target.pdf
        : null,
  };
  context.runId = job.runId;
  await chrome.storage.local.set({ lastDocumentId: job.documentId });
  dispatch({ type: 'save-start' });
  const reply = await ask<SaveResult>({ type: 'save', job });
  dispatch({ type: 'save-done', reply });
  focusFid(target.mode === 'single' ? 'open-source' : 'save');
}

chrome.runtime.onMessage.addListener((message: Progress, sender) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'progress') return;
  if (message.runId === context.runId) dispatch({ type: 'progress', results: message.results });
});

// ---- The states ----------------------------------------------------------------------------------------

function primaryButton(label: string, saving: boolean, testId: string, disabled = false) {
  const node = button(label, () => void save(), {
    testId,
    fid: 'save',
    disabled: saving || disabled,
    className: 'btn big',
  });
  if (saving) node.prepend(el('span', { className: 'spinner' }));
  node.setAttribute('aria-busy', String(saving));
  return node;
}

function drawSingle(
  v: Extract<View, { kind: 'ready' }>,
  target: Extract<Target, { mode: 'single' }>,
) {
  const result = singleResult(v);
  const saving = v.phase === 'saving';
  const nodes: Node[] = [paperCard(target)];

  if (v.phase !== 'done' || !result || result.status === 'failed' || v.error) {
    if (target.pdf && !target.pdf.onlyThePdf) {
      const box = el('input', { fid: 'attach-pdf', testId: 'attach-pdf' });
      box.type = 'checkbox';
      box.id = 'attach-pdf';
      box.checked = context.attachPdf;
      box.disabled = saving;
      box.addEventListener('change', () => {
        context.attachPdf = box.checked;
      });
      nodes.push(el('label', { className: 'check' }, box, el('span', { text: 'Attach this PDF' })));
    }
    nodes.push(pickers(v.theses, saving));
    const failure =
      v.error ?? (result?.status === 'failed' ? (result.message ?? 'It was not saved.') : null);
    if (failure) nodes.push(line('error', `Not saved: ${failure}`));
    const label = saving ? 'Saving…' : failure ? 'Try again' : 'Save to Thesis Copilot';
    nodes.push(primaryButton(label, saving, 'add'));
    return nodes;
  }

  // Saved, or already there: one line, and the way into Thesis Copilot.
  const saved = result.status === 'saved';
  const status = el(
    'div',
    { className: `done ${saved ? 'ok' : 'present'}`, testId: 'done' },
    el(
      'span',
      { className: 'done-what' },
      checkIcon(),
      document.createTextNode(saved ? 'Saved' : 'In your library'),
    ),
    el('span', { className: 'dot', text: '·' }),
  );
  const openPath = result.sourceId
    ? sourcePath(context.documentId, result.sourceId)
    : `${docPath(context.documentId)}/sources`;
  const open = linkButton('Open in Thesis Copilot', () => openSite(openPath), {
    fid: 'open-source',
    testId: 'open-source',
  });
  open.dataset.href = `${WEB_URL}${openPath}`;
  status.append(open);
  nodes.push(status);

  const notes: string[] = [`In “${thesisTitle(v.theses)}”`];
  const collection = context.collections.find((c) => c.id === context.collectionId);
  if (v.outcome?.collection === 'added' && collection) notes.push(`filed in “${collection.name}”`);
  nodes.push(el('p', { className: 'small muted', text: `${notes.join(', ')}.` }));
  const pdf = v.outcome?.pdf;
  if (pdf?.kind === 'attached') nodes.push(line('note', 'The PDF is attached.'));
  if (pdf?.kind === 'not-fetched') nodes.push(line('warn', pdf.message));
  if (pdf?.kind === 'rejected')
    nodes.push(line('warn', `The PDF was not attached: ${pdf.message}`));
  if (v.outcome?.collection === 'failed')
    nodes.push(line('warn', 'It could not be put in the collection.'));
  return nodes;
}

function pill(
  result: ItemResult | undefined,
  saving: boolean,
  selected: boolean,
): HTMLElement | null {
  if (!result)
    return saving && selected ? el('span', { className: 'pill', text: 'Saving…' }) : null;
  if (result.status === 'failed') {
    const node = el('span', { className: 'pill failed', text: 'Failed' });
    node.title = result.message ?? 'Not saved';
    return node;
  }
  const label = result.status === 'saved' ? 'Saved' : 'In library';
  if (!result.sourceId)
    return el('span', {
      className: `pill ${result.status === 'saved' ? 'ok' : 'present'}`,
      text: label,
    });
  const node = el('button', {
    className: `pill ${result.status === 'saved' ? 'ok' : 'present'}`,
    text: `${label} · Open`,
  });
  node.type = 'button';
  node.dataset.href = `${WEB_URL}${sourcePath(context.documentId, result.sourceId)}`;
  node.setAttribute('aria-label', `${label}. Open in Thesis Copilot`);
  node.addEventListener('click', () =>
    openSite(sourcePath(context.documentId, result.sourceId as string)),
  );
  return node;
}

function drawList(v: Extract<View, { kind: 'ready' }>, target: Extract<Target, { mode: 'list' }>) {
  const saving = v.phase === 'saving';
  const count = target.items.length;
  const summary = `${count} paper${count === 1 ? '' : 's'} on this ${siteName(target.site)} page`;

  // ADR-0156: a results page opens calm — one line, and "Select several (N)".
  if (!context.listOpen && v.phase === 'idle') {
    return [
      el('p', { className: 'lead', text: summary }),
      el(
        'p',
        { className: 'small muted' },
        document.createTextNode('Press Save beside a result on the page, or '),
        linkButton(
          `Select several (${count})`,
          () => {
            context.listOpen = true;
            draw();
            focusFid('select-all');
          },
          { testId: 'select-several', fid: 'select-several' },
        ),
      ),
    ];
  }

  const head = el(
    'div',
    { className: 'list-head' },
    el('p', { className: 'label', text: summary }),
    (() => {
      const all = el('button', {
        className: 'link-button',
        text: v.selected.length
          ? 'Clear'
          : `Select ${Math.min(count, BULK_MAX) === count ? 'all' : `first ${BULK_MAX}`}`,
        testId: 'select-all',
        fid: 'select-all',
      });
      all.type = 'button';
      all.disabled = saving;
      all.addEventListener('click', () => dispatch({ type: 'toggle-all' }));
      return all;
    })(),
  );

  const list = el('ul', { className: 'results', testId: 'results' });
  list.setAttribute('aria-label', 'Papers on this page');
  target.items.forEach((item, index) => {
    const result = v.results[item.key];
    const done = result && result.status !== 'failed';
    const box = el('input', { fid: `item-${index}` });
    box.type = 'checkbox';
    box.checked = done ? true : v.selected.includes(item.key);
    box.disabled = saving || Boolean(done);
    box.addEventListener('change', () => dispatch({ type: 'toggle', key: item.key }));
    const meta = [item.byline, item.year, item.venue].filter(Boolean).join(' · ');
    const label = el(
      'label',
      { className: 'check' },
      box,
      el(
        'span',
        {},
        el('span', { className: 'item-title', text: item.title }),
        meta ? el('span', { className: 'item-meta', text: meta }) : null,
        // The reason is written out, not left to a tooltip a keyboard cannot reach.
        result?.status === 'failed'
          ? el('span', { className: 'item-error', text: result.message ?? 'Not saved.' })
          : null,
      ),
    );
    const row = el(
      'li',
      { testId: 'result' },
      label,
      pill(result, saving, v.sending.includes(item.key)),
    );
    row.dataset.key = item.key;
    list.append(row);
  });

  const nodes: Node[] = [head, list];
  if (target.site === 'scholar') {
    nodes.push(
      el('p', {
        className: 'small muted',
        text: 'Scholar shows few DOIs, so most are matched by title.',
      }),
    );
  }
  nodes.push(pickers(v.theses, saving));

  if (saving) {
    const done = v.sending.filter((key) => v.results[key]).length;
    const bar = el('progress', {});
    bar.max = Math.max(v.sending.length, 1);
    bar.value = done;
    bar.setAttribute('aria-label', 'Saving');
    nodes.push(
      el(
        'div',
        { className: 'progress', testId: 'progress' },
        bar,
        el('p', { className: 'small muted', text: `Saving ${done} of ${v.sending.length}…` }),
      ),
    );
  }
  if (v.phase === 'done') {
    const t = tally(v);
    const parts = [
      t.saved ? `${t.saved} saved` : '',
      t.present ? `${t.present} already in your library` : '',
      t.failed ? `${t.failed} failed` : '',
    ].filter(Boolean);
    if (v.error) nodes.push(line('error', `Not saved: ${v.error}`));
    else if (parts.length) nodes.push(line(t.failed ? 'warn' : 'note', parts.join(' · ')));
    if (v.outcome?.collection === 'failed')
      nodes.push(line('warn', 'They could not be put in the collection.'));
  }

  const keys = pendingKeys(v);
  const retrying = keys.some((key) => v.results[key]?.status === 'failed');
  const label = saving
    ? 'Saving…'
    : keys.length === 0
      ? 'Tick the papers to save'
      : retrying
        ? `Retry failed (${keys.length})`
        : v.error
          ? `Try again (${keys.length})`
          : `Save ${keys.length} to Thesis Copilot`;
  nodes.push(primaryButton(label, saving, 'save-many', keys.length === 0));
  if (overCap(v)) {
    nodes.push(
      el('p', {
        className: 'small muted',
        text: `One save takes at most ${BULK_MAX}; the rest can go in the next.`,
      }),
    );
  }
  if (v.phase === 'done' && tally(v).saved + tally(v).present > 0) {
    nodes.push(
      linkButton(
        'Open in Thesis Copilot',
        () => openSite(`${docPath(context.documentId)}/sources`),
        {
          fid: 'open-library',
          testId: 'open-library',
        },
      ),
    );
  }
  return nodes;
}

/** "No paper found on this page", and one short paragraph behind "How it works". */
function drawEmpty(headline: string, how: string): Node[] {
  const nodes: Node[] = [
    el('p', { className: 'lead', text: headline, testId: 'empty' }),
    linkButton(
      context.howOpen ? 'Hide' : 'How it works',
      () => {
        context.howOpen = !context.howOpen;
        draw();
        focusFid('how');
      },
      { fid: 'how', testId: 'how' },
    ),
  ];
  if (context.howOpen)
    nodes.push(el('p', { className: 'small muted', text: how, testId: 'how-text' }));
  return nodes;
}

const HOW =
  'Open a paper’s own page, a page of search results or a PDF, then press refresh. On a paper’s page a “Save to Thesis Copilot” button also appears beside it. You can also right-click a DOI link.';

function draw(): void {
  const v = view;
  let nodes: Node[];
  switch (v.kind) {
    case 'reading':
      nodes = [spinnerLine('Reading this page…')];
      break;
    case 'loading':
      nodes = [
        ...(v.target.mode === 'single' ? [paperCard(v.target)] : []),
        spinnerLine('Finding your theses…'),
      ];
      break;
    case 'not-paper':
      nodes = v.restricted
        ? drawEmpty(
            'Chrome keeps this page private',
            'Add-ons cannot read Chrome’s own pages or the Web Store. Open a paper’s page, then press refresh.',
          )
        : ROBOT_CHECK.test(tabTitle)
          ? drawEmpty(
              'The site is checking you are not a robot',
              'Finish the check on the page, wait for the paper to appear, then press refresh.',
            )
          : drawEmpty('No paper found on this page', HOW);
      break;
    case 'signed-out':
      nodes = [
        ...(v.target.mode === 'single' ? [paperCard(v.target)] : []),
        el('p', {
          className: 'small muted',
          testId: 'message',
          text: 'Sign in to Thesis Copilot in this browser to save it.',
        }),
      ];
      break;
    case 'no-thesis':
      nodes = [
        ...(v.target.mode === 'single' ? [paperCard(v.target)] : []),
        el('p', {
          className: 'small muted',
          testId: 'message',
          text: 'Papers are saved into a thesis. Start one first.',
        }),
        siteButton('Start a thesis', '/app/new', { fid: 'start', className: 'btn big' }),
      ];
      break;
    case 'load-failed':
      nodes = [
        line('error', `Could not reach Thesis Copilot. ${v.message}`),
        button(
          'Try again',
          () => {
            dispatch({ type: 'retry-load' });
            void loadTheses();
          },
          { fid: 'retry-load', testId: 'retry-load', className: 'btn big' },
        ),
      ];
      break;
    case 'ready':
      nodes = v.target.mode === 'single' ? drawSingle(v, v.target) : drawList(v, v.target);
      break;
  }

  // Keep the student's place: focus and the list's scroll survive the redraw.
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.fid;
  const scroll = app.querySelector('.results')?.scrollTop ?? 0;
  app.replaceChildren(el('div', { className: 'state' }, ...nodes));
  app.setAttribute(
    'aria-busy',
    String(
      v.kind === 'reading' || v.kind === 'loading' || (v.kind === 'ready' && v.phase === 'saving'),
    ),
  );
  const list = app.querySelector('.results');
  if (list) list.scrollTop = scroll;
  if (focused) focusFid(focused);
}

function focusFid(fid: string): void {
  const node = document.querySelector<HTMLElement>(`[data-fid="${CSS.escape(fid)}"]`);
  if (node && !(node as HTMLButtonElement).disabled) node.focus();
}

// ---- The account row --------------------------------------------------------------------------------

let menuOpen = false;

function menuItem(label: string, onClick: () => void, testId: string): HTMLButtonElement {
  const item = el('button', { className: 'menu-item', text: label, testId });
  item.type = 'button';
  item.setAttribute('role', 'menuitem');
  item.addEventListener('click', onClick);
  return item;
}

function drawAccount(): void {
  // The theses' 401 is as good as the session route's "nobody".
  const signedOut = context.account === null || view.kind === 'signed-out';
  if (signedOut) {
    accountRow.replaceChildren(
      el('span', { className: 'who-text muted', text: 'Not signed in' }),
      siteButton('Sign in', '/sign-in', { fid: 'sign-in', testId: 'sign-in', small: true }),
    );
    return;
  }
  const account = context.account;
  const name = account?.name || account?.email || '';
  const avatar = el('span', { className: 'avatar', text: (name[0] ?? '·').toUpperCase() });
  avatar.setAttribute('aria-hidden', 'true');
  const who = el(
    'span',
    { className: 'who-text' },
    el('span', { className: 'name', text: account ? account.name || account.email : '…' }),
    account?.name ? el('span', { className: 'email', text: account.email }) : null,
  );
  const more = el('button', { className: 'icon', testId: 'more', fid: 'more' });
  more.type = 'button';
  more.setAttribute('aria-label', 'More');
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', String(menuOpen));
  more.append(dotsIcon());
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    menuOpen = !menuOpen;
    drawAccount();
    if (menuOpen) accountRow.querySelector<HTMLElement>('.menu-item')?.focus();
  });
  const nodes: Node[] = [
    el('span', { className: 'who' }, avatar, who),
    siteButton(
      'Open Thesis Copilot',
      context.documentId ? `${docPath(context.documentId)}/sources` : '/app',
      { fid: 'open-app', testId: 'open-app', secondary: true, small: true },
    ),
    more,
  ];
  if (menuOpen) {
    const menu = el(
      'div',
      { className: 'menu', testId: 'menu' },
      // Better Auth accepts a sign-out only from the site itself, so it is done there (ADR-0156).
      menuItem('Sign out…', () => openSite('/app'), 'menu-sign-out'),
      menuItem('Help', () => openSite('/help'), 'menu-help'),
      menuItem('Report a problem', () => openSite('/contact'), 'menu-report'),
    );
    menu.setAttribute('role', 'menu');
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        menuOpen = false;
        drawAccount();
        focusFid('more');
      }
    });
    nodes.push(menu);
  }
  accountRow.replaceChildren(...nodes);
}

function dotsIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const cx of ['5', '12', '19']) {
    const dot = document.createElementNS(SVG, 'circle');
    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', '12');
    dot.setAttribute('r', '1.6');
    dot.setAttribute('class', 'fill');
    svg.append(dot);
  }
  return svg;
}

document.addEventListener('click', (event) => {
  if (menuOpen && !(event.target as Element | null)?.closest('.menu')) {
    menuOpen = false;
    drawAccount();
  }
});

async function loadAccount(): Promise<void> {
  const reply = await ask<Account | null>({ type: 'account' });
  // An unreachable site says nothing about who is signed in; the theses' answer will.
  context.account = reply.ok ? reply.value : undefined;
  drawAccount();
}

// ---- Settings ---------------------------------------------------------------------------------------

let inline: InlineSettings = readInline(undefined);
let theme: Theme = 'system';

function applyTheme(next: Theme): void {
  theme = next;
  if (next === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
}

function switchRow(
  id: string,
  label: string,
  on: boolean,
  disabled: boolean,
  onChange: (on: boolean) => void,
  sub?: string,
): HTMLElement {
  const box = el('input', { testId: id, fid: id });
  box.type = 'checkbox';
  box.id = id;
  box.setAttribute('role', 'switch');
  box.checked = on;
  box.disabled = disabled;
  box.addEventListener('change', () => onChange(box.checked));
  const text = el(
    'span',
    { className: 'switch-text' },
    el('span', { text: label }),
    sub ? el('span', { className: 'small muted', text: sub }) : null,
  );
  const row = el('label', { className: 'switch' }, text, box);
  row.htmlFor = id;
  return row;
}

async function saveInline(next: InlineSettings): Promise<void> {
  inline = next;
  drawSettings();
  try {
    await chrome.storage.local.set({ [INLINE_KEY]: next });
  } catch {
    // The switch shows what was asked; the pages keep the last stored choice.
  }
}

let shortcut = '';

function drawSettings(): void {
  const back = linkButton('‹ Back', () => toggleSettings(false), { fid: 'settings-back' });
  const group = (title: string, ...children: Array<Node | null>) =>
    el('section', { className: 'group' }, el('h2', { text: title }), ...children);

  const themes = el('div', { className: 'segmented', testId: 'theme' });
  themes.setAttribute('role', 'radiogroup');
  themes.setAttribute('aria-label', 'Theme');
  for (const [value, label] of [
    ['system', 'System'],
    ['light', 'Light'],
    ['dark', 'Dark'],
  ] as const) {
    const option = el('button', { text: label, fid: `theme-${value}`, testId: `theme-${value}` });
    option.type = 'button';
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-checked', String(theme === value));
    option.addEventListener('click', () => {
      applyTheme(value);
      void chrome.storage.local.set({ [THEME_KEY]: value }).catch(() => undefined);
      drawSettings();
      focusFid(`theme-${value}`);
    });
    themes.append(option);
  }

  const site = context.host ? siteKey(context.host) : '';
  const buttons = group(
    'Save buttons in pages',
    switchRow('inline-all', 'On all sites', inline.all, false, (on) => {
      void saveInline(withAll(inline, on));
    }),
    switchRow(
      'inline-site',
      site ? `This site: ${site}` : 'This site',
      site ? inlineOn(inline, site) : false,
      !site || !inline.all,
      (on) => {
        if (site) void saveInline(withSite(inline, site, on));
      },
      site ? undefined : 'Not a web page',
    ),
  );

  const keys = el('div', { className: 'setting-line' });
  if (shortcut) keys.append(el('kbd', { text: shortcut }));
  else keys.append(el('span', { className: 'muted', text: 'Not set' }));
  const change = linkButton(shortcut ? 'Change' : 'Set one', () => {
    void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    window.close();
  });
  keys.append(change);

  settingsPanel.replaceChildren(
    el('div', { className: 'settings-head' }, back, el('h1', { text: 'Settings' })),
    group('Theme', themes),
    buttons,
    group('Keyboard shortcut', keys),
    group(
      'Version',
      el('p', { className: 'muted', text: `Version ${chrome.runtime.getManifest().version}` }),
    ),
  );
}

function toggleSettings(open = settingsPanel.hidden): void {
  settingsPanel.hidden = !open;
  app.hidden = open;
  const gear = document.getElementById('settings-toggle') as HTMLButtonElement;
  gear.setAttribute('aria-expanded', String(open));
  gear.classList.toggle('on', open);
  if (open) {
    drawSettings();
    focusFid('settings-back');
  } else gear.focus();
}

async function loadSettings(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([INLINE_KEY, THEME_KEY]);
    inline = readInline(stored[INLINE_KEY]);
    applyTheme(readTheme(stored[THEME_KEY]));
  } catch {
    // Defaults: buttons on, the system's theme.
  }
  try {
    const commands = await chrome.commands.getAll();
    shortcut = commands.find((c) => c.name === '_execute_action')?.shortcut ?? '';
  } catch {
    shortcut = '';
  }
}

// ---- Reading the tab ------------------------------------------------------------------------------------

/**
 * Which tab to read. From the toolbar, the one in front. Opened as a page — by a test, or by
 * anything that links to it — it is told the tab with `?tab=`, because the tab in front is then
 * the popup itself.
 */
async function targetTab(): Promise<chrome.tabs.Tab | null> {
  const named = Number(new URLSearchParams(location.search).get('tab'));
  try {
    if (Number.isInteger(named) && named > 0) return await chrome.tabs.get(named);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
  } catch {
    return null;
  }
}

const RESTRICTED = /^(chrome|edge|about|chrome-extension|devtools|view-source|file):/i;

function pdfTarget(paper: Paper | null, url: string, title: string): Target {
  const filename = pdfFilename(url);
  return {
    mode: 'single',
    key: paper?.doi ?? 'pdf',
    paper: paper ?? {
      title: title && !/\.pdf$/i.test(title) ? title.slice(0, 500) : filename,
      doi: null,
      reference: filename,
      byline: null,
      year: null,
      venue: null,
    },
    pdf: { url, filename, onlyThePdf: !paper },
    fromLink: false,
  };
}

/** The tab's title, for telling a robot check apart from a page with no paper. */
let tabTitle = '';
const ROBOT_CHECK =
  /captcha|client challenge|checking your browser|just a moment|verify you are human|are you a robot|access denied|unusual traffic/i;

async function readTarget(): Promise<{ target: Target | null; restricted: boolean }> {
  const tab = await targetTab();
  const url = tab?.url ?? '';
  try {
    const parsed = new URL(url);
    context.host = parsed.protocol === 'https:' ? parsed.hostname : '';
  } catch {
    context.host = '';
  }

  // A right-clicked link waits in session storage for the popup it opened.
  const stored = await chrome.storage.session.get(PENDING_KEY);
  await chrome.storage.session.remove(PENDING_KEY);
  void chrome.action.setBadgeText({ text: '' });
  const pending = freshPending(stored[PENDING_KEY], Date.now());
  if (pending) {
    return {
      target: {
        mode: 'single',
        key: pending.paper.doi ?? 'link',
        paper: pending.paper,
        pdf: null,
        fromLink: true,
      },
      restricted: false,
    };
  }

  tabTitle = tab?.title ?? '';
  if (!tab?.id || !url) return { target: null, restricted: true };
  if (RESTRICTED.test(url) || /^https:\/\/chrome(webstore)?\.google\.com\/webstore/i.test(url)) {
    return { target: null, restricted: true };
  }

  let meta: ReturnType<typeof collectPageMeta> | null = null;
  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectPageMeta,
    });
    meta = (injected?.result as ReturnType<typeof collectPageMeta> | undefined) ?? null;
  } catch {
    // Chrome's PDF viewer cannot be read — but the address of a PDF (arxiv.org/pdf/…, a
    // publisher's /doi/pdf/…) often still names the paper.
  }
  const page = meta ?? { url, title: tab.title ?? '', meta: [] };
  const paper = paperFrom(page);
  const pdf = isPdfUrl(url) || meta?.contentType === 'application/pdf';
  if (pdf) return { target: pdfTarget(paper, url, page.title), restricted: false };
  if (paper) {
    return {
      target: { mode: 'single', key: paper.doi ?? 'page', paper, pdf: null, fromLink: false },
      restricted: false,
    };
  }
  if (!meta) return { target: null, restricted: false };

  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectResultList,
    });
    const items = itemsFrom(injected?.result as RawListing | null | undefined);
    const site = (injected?.result as RawListing | null | undefined)?.site;
    if (items.length && site) return { target: { mode: 'list', site, items }, restricted: false };
  } catch {
    // Nothing more to read.
  }
  return { target: null, restricted: false };
}

async function loadTheses(): Promise<void> {
  const reply = await ask<Thesis[]>({ type: 'theses' });
  if (reply.ok && reply.value.length) {
    const stored = (await chrome.storage.local.get(['lastDocumentId'])) as Remembered;
    context.documentId = reply.value.some((t) => t.id === stored.lastDocumentId)
      ? (stored.lastDocumentId as string)
      : (reply.value[0] as Thesis).id;
  }
  dispatch({ type: 'theses', reply });
  if (view.kind === 'ready') {
    void loadCollections();
    focusFid(view.target.mode === 'single' ? 'save' : 'select-several');
  } else if (view.kind === 'signed-out') focusFid('sign-in');
  else if (view.kind === 'no-thesis') focusFid('start');
}

async function main(): Promise<void> {
  (document.getElementById('close') as HTMLButtonElement).addEventListener('click', () =>
    window.close(),
  );
  (document.getElementById('refresh') as HTMLButtonElement).addEventListener('click', () =>
    location.reload(),
  );
  (document.getElementById('settings-toggle') as HTMLButtonElement).addEventListener('click', () =>
    toggleSettings(),
  );
  await loadSettings();
  drawAccount();
  void loadAccount();
  const { target, restricted } = await readTarget();
  dispatch({ type: 'read', target, restricted });
  if (view.kind === 'loading') await loadTheses();
}

void main();
