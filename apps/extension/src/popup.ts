/**
 * The window that opens from the toolbar, the keyboard shortcut or the right-click item —
 * ADR-0031, ADR-0069. It works out what the tab offers (one paper, a results page, a PDF), then
 * draws the states of `state.ts`.
 *
 * Everything shown comes from the page or from the API, so it is written with `textContent`,
 * never as HTML. The only markup is the static `popup.html`.
 */

import { WEB_URL } from './config.js';
import { BULK_MAX, itemsFrom, type RawListing, siteName } from './lists.js';
import type {
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

// ---- Talking to the service worker -------------------------------------------------------------

function ask<T>(request: Request): Promise<Reply<T>> {
  return (chrome.runtime.sendMessage(request) as Promise<Reply<T>>).catch(
    (error: unknown): Reply<T> => ({ ok: false, status: 0, message: String(error).slice(0, 200) }),
  );
}

// ---- What the popup remembers -------------------------------------------------------------------

/** The only things the add-on stores: the thesis and collection chosen last. */
type Remembered = { lastDocumentId?: unknown; lastCollectionId?: unknown };

const context = {
  documentId: '',
  collectionId: '' as string, // '' = no collection
  collections: [] as Collection[],
  collectionsFor: '',
  creating: false,
  runId: '',
  attachPdf: true,
};

let view: View = initial;

function dispatch(event: Event): void {
  view = reduce(view, event);
  draw();
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

/** Opens Thesis Copilot at `path` in a new tab. No `tabs` permission is needed to open one. */
function openSite(path: string): void {
  void chrome.tabs.create({ url: `${WEB_URL}${path}` });
  window.close();
}

function siteButton(label: string, path: string, options: Options & { secondary?: boolean } = {}) {
  const node = button(label, () => openSite(path), { testId: 'open-site', ...options });
  node.dataset.href = `${WEB_URL}${path}`;
  return node;
}

const docPath = (documentId: string) => `/app/d/${encodeURIComponent(documentId)}`;
/** The paper in the reader — the in-app page for one source. */
const sourcePath = (documentId: string, sourceId: string) =>
  `${docPath(documentId)}/sources/${encodeURIComponent(sourceId)}`;

function notice(kind: 'ok' | 'warn' | 'error' | 'note', title: string, ...lines: string[]) {
  return el(
    'div',
    { className: `notice ${kind === 'note' ? '' : kind}`.trim(), testId: 'message' },
    el('strong', { text: title }),
    ...lines.filter(Boolean).map((line) => el('p', { text: line })),
  );
}

function spinnerLine(text: string): HTMLElement {
  const line = el('p', { className: 'muted' });
  line.append(el('span', { className: 'spinner' }), document.createTextNode(text));
  return line;
}

// ---- The paper card --------------------------------------------------------------------------------

function paperCard(target: Extract<Target, { mode: 'single' }>): HTMLElement {
  const { paper } = target;
  const eyebrow = target.fromLink ? 'From the link' : target.pdf ? 'PDF' : 'This page';
  const details = [paper.byline, paper.year, paper.venue].filter(Boolean).join(' · ');
  return el(
    'section',
    { className: 'paper', testId: 'paper' },
    el('p', { className: 'eyebrow', text: eyebrow }),
    el('p', { className: 'title', text: paper.title || 'Untitled paper' }),
    details ? el('p', { className: 'byline', text: details }) : null,
    el('p', {
      className: 'doi',
      text: paper.doi
        ? `DOI ${paper.doi}`
        : target.pdf?.onlyThePdf
          ? 'No DOI found — the PDF itself will be saved.'
          : 'No DOI on this page — it will be matched by its title.',
    }),
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
  const thesisLabel = el('label', { text: 'Save to' });
  thesisLabel.htmlFor = 'thesis';

  const collection = el('select', { testId: 'collection', fid: 'collection' });
  collection.id = 'collection';
  const none = el('option', { text: 'No collection' });
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
  const collectionLabel = el('label', { text: 'Collection (optional)' });
  collectionLabel.htmlFor = 'collection';

  const fields = el(
    'div',
    { className: 'fields' },
    el('div', { className: 'field' }, thesisLabel, thesis),
    el('div', { className: 'field' }, collectionLabel, collection),
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
    { className: 'field' },
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
      const label = el(
        'label',
        { className: 'check' },
        box,
        el('span', { text: 'Attach this PDF, so it can be read at once' }),
      );
      nodes.push(el('div', { className: 'fields' }, label));
    }
    nodes.push(pickers(v.theses, saving));
    const failure =
      v.error ?? (result?.status === 'failed' ? (result.message ?? 'It was not saved.') : null);
    if (failure) {
      nodes.push(el('div', { className: 'actions' }, notice('error', 'Not saved', failure)));
    }
    const label = saving ? 'Saving…' : failure ? 'Try again' : 'Save to library';
    const primary = button(label, () => void save(), {
      testId: 'add',
      fid: 'save',
      disabled: saving,
    });
    if (saving) primary.prepend(el('span', { className: 'spinner' }));
    primary.setAttribute('aria-busy', String(saving));
    nodes.push(el('div', { className: 'actions' }, primary));
    return nodes;
  }

  const title = thesisTitle(v.theses);
  const lines: string[] = [];
  if (result.status === 'saved') {
    lines.push('It is being looked up and read now, and appears in the library in a moment.');
  }
  const pdf = v.outcome?.pdf;
  if (pdf?.kind === 'attached')
    lines.push('The PDF is attached, so the paper can be read at once.');
  if (pdf?.kind === 'already-has-file') lines.push('Its PDF was already there.');
  const warnings: string[] = [];
  if (pdf?.kind === 'not-fetched') {
    warnings.push(
      `${pdf.message} ${target.paper.doi ? 'Saved by its DOI; the free full text is fetched where there is one.' : ''}`.trim(),
    );
  }
  if (pdf?.kind === 'rejected') warnings.push(`The PDF was not attached: ${pdf.message}`);
  const collection = context.collections.find((c) => c.id === context.collectionId);
  if (v.outcome?.collection === 'added' && collection) lines.push(`Filed in “${collection.name}”.`);
  if (v.outcome?.collection === 'failed') warnings.push('It could not be put in the collection.');

  nodes.push(
    result.status === 'saved'
      ? notice('ok', `Saved to “${title}”`, ...lines)
      : notice('note', `Already in the library of “${title}”`, ...lines),
  );
  if (warnings.length) nodes.push(notice('warn', 'Note', ...warnings));
  const actions = el('div', { className: 'actions' });
  if (result.sourceId) {
    actions.append(
      siteButton('Open in Thesis Copilot', sourcePath(context.documentId, result.sourceId), {
        fid: 'open-source',
        testId: 'open-source',
      }),
    );
  }
  actions.append(
    siteButton('Open the library', `${docPath(context.documentId)}/sources`, {
      secondary: true,
      fid: 'open-library',
    }),
  );
  nodes.push(actions);
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
  const head = el(
    'div',
    { className: 'list-head' },
    el('p', {
      className: 'label',
      text: `${count} paper${count === 1 ? '' : 's'} on this ${siteName(target.site)} page`,
    }),
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
        text: 'Google Scholar shows few DOIs, so most of these are matched by title. Any that cannot be matched surely are kept for you to fix in the library.',
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
      t.present ? `${t.present} already in the library` : '',
      t.failed ? `${t.failed} failed` : '',
    ].filter(Boolean);
    if (v.error) nodes.push(notice('error', 'Not saved', v.error));
    else if (parts.length) {
      const lines = [
        v.outcome?.collection === 'failed' ? 'They could not be put in the collection.' : '',
        t.failed ? 'Hover a “Failed” label for the reason; “Retry failed” sends them again.' : '',
      ];
      nodes.push(notice(t.failed ? 'warn' : 'ok', parts.join(' · '), ...lines));
    }
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
          : `Save (${keys.length})`;
  const primary = button(label, () => void save(), {
    testId: 'save-many',
    fid: 'save',
    disabled: saving || keys.length === 0,
  });
  if (saving) primary.prepend(el('span', { className: 'spinner' }));
  const actions = el('div', { className: 'actions' }, primary);
  if (overCap(v)) {
    actions.append(
      el('p', {
        className: 'small muted',
        text: `One save takes at most ${BULK_MAX}; the rest can go in the next.`,
      }),
    );
  }
  if (v.phase === 'done' && tally(v).saved + tally(v).present > 0) {
    actions.append(
      siteButton('Open the library', `${docPath(context.documentId)}/sources`, {
        secondary: true,
        fid: 'open-library',
      }),
    );
  }
  nodes.push(actions);
  return nodes;
}

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
      nodes = [
        el('h1', {
          text: v.restricted ? 'Chrome keeps this page private' : 'No paper on this page',
        }),
        el('p', {
          className: 'muted',
          testId: 'message',
          text: v.restricted
            ? 'Add-ons cannot read Chrome’s own pages or the Web Store. Open a paper’s page and click again.'
            : 'Open a paper’s own page — the one with its abstract — or a page of search results, and click again.',
        }),
        el(
          'ul',
          { className: 'plain small' },
          el('li', { text: 'Journal and publisher article pages' }),
          el('li', { text: 'PubMed, arXiv and Google Scholar results' }),
          el('li', { text: 'A paper’s PDF' }),
          el('li', { text: 'Right-click a DOI or arXiv link: “Add to Thesis Copilot”' }),
        ),
      ];
      break;
    case 'signed-out':
      nodes = [
        ...(v.target.mode === 'single' ? [paperCard(v.target)] : []),
        notice(
          'note',
          'Sign in to Thesis Copilot',
          'The add-on uses your Thesis Copilot sign-in in this browser. Sign in, then click the add-on again.',
        ),
        el(
          'div',
          { className: 'actions' },
          siteButton('Sign in to Thesis Copilot', '/sign-in', { fid: 'sign-in' }),
        ),
      ];
      break;
    case 'no-thesis':
      nodes = [
        ...(v.target.mode === 'single' ? [paperCard(v.target)] : []),
        notice(
          'note',
          'Start a thesis first',
          'Papers are saved into a thesis library. Start one, then click the add-on again.',
        ),
        el(
          'div',
          { className: 'actions' },
          siteButton('Start a thesis', '/app/new', { fid: 'start' }),
        ),
      ];
      break;
    case 'load-failed':
      nodes = [
        notice('error', 'Could not reach Thesis Copilot', v.message),
        el(
          'div',
          { className: 'actions' },
          button(
            'Try again',
            () => {
              dispatch({ type: 'retry-load' });
              void loadTheses();
            },
            { fid: 'retry-load', testId: 'retry-load' },
          ),
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
  const node = app.querySelector<HTMLElement>(`[data-fid="${CSS.escape(fid)}"]`);
  if (node && !(node as HTMLButtonElement).disabled) node.focus();
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

async function readTarget(): Promise<{ target: Target | null; restricted: boolean }> {
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

  const tab = await targetTab();
  const url = tab?.url ?? '';
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
    focusFid(view.target.mode === 'single' ? 'save' : 'select-all');
  } else if (view.kind === 'signed-out') focusFid('sign-in');
  else if (view.kind === 'no-thesis') focusFid('start');
}

async function footer(): Promise<void> {
  (document.getElementById('version') as HTMLElement).textContent =
    `v${chrome.runtime.getManifest().version}`;
  const slot = document.getElementById('shortcut') as HTMLElement;
  let shortcut = '';
  try {
    const commands = await chrome.commands.getAll();
    shortcut = commands.find((c) => c.name === '_execute_action')?.shortcut ?? '';
  } catch {
    // No shortcut to show.
  }
  if (shortcut) {
    slot.append(document.createTextNode('Open with '), el('kbd', { text: shortcut }));
  } else {
    const set = el('button', { className: 'link-button', text: 'Set a keyboard shortcut' });
    set.type = 'button';
    set.addEventListener('click', () => {
      void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
      window.close();
    });
    slot.append(set);
  }
}

async function main(): Promise<void> {
  (document.getElementById('open-app') as HTMLButtonElement).addEventListener('click', () =>
    openSite(context.documentId ? `${docPath(context.documentId)}/sources` : '/app'),
  );
  void footer();
  const { target, restricted } = await readTarget();
  dispatch({ type: 'read', target, restricted });
  if (view.kind === 'loading') await loadTheses();
}

void main();
