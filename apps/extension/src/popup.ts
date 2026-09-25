/**
 * The window that opens from the toolbar — ADR-0031. It reads the paper on the tab, lists the
 * student's theses, and adds the paper to the one they pick.
 *
 * Everything shown comes from the page or from the API, so it is written with `textContent`,
 * never as HTML.
 */

import { WEB_URL } from './config.js';
import type { Added, Reply, Request, Thesis } from './messages.js';
import { collectPageMeta } from './page.js';
import { type Paper, paperFrom } from './paper.js';

const app = document.getElementById('app') as HTMLElement;

function ask<T>(request: Request): Promise<Reply<T>> {
  return chrome.runtime.sendMessage(request) as Promise<Reply<T>>;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { text?: string; className?: string; testId?: string } = {},
  ...children: Node[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.text !== undefined) node.textContent = options.text;
  if (options.className) node.className = options.className;
  if (options.testId) node.dataset.testid = options.testId;
  node.append(...children);
  return node;
}

const render = (...nodes: Node[]) =>
  app.replaceChildren(el('p', { text: 'Thesis Copilot', className: 'brand' }), ...nodes);

const message = (text: string, className = 'note') =>
  el('p', { text, className, testId: 'message' });

/** A button that opens Thesis Copilot at `path` in a new tab and closes the popup. */
function openButton(label: string, path: string): HTMLButtonElement {
  const button = el('button', { text: label, className: 'secondary', testId: 'open-site' });
  button.type = 'button';
  button.dataset.href = `${WEB_URL}${path}`;
  button.addEventListener('click', () => {
    void chrome.tabs.create({ url: `${WEB_URL}${path}` });
    window.close();
  });
  return button;
}

function paperCard(paper: Paper): HTMLElement {
  return el(
    'section',
    { className: 'paper', testId: 'paper' },
    el('p', { text: paper.title, className: 'title' }),
    el('p', {
      text: paper.doi
        ? `DOI ${paper.doi}`
        : 'No DOI on this page — it will be matched by its title.',
      className: 'muted',
    }),
  );
}

/**
 * Which tab to read. From the toolbar, the one in front. Opened as a page — by a test, or by
 * anything that links to it — it is told the tab with `?tab=`, because the tab in front is then
 * the popup itself.
 */
async function targetTab(): Promise<number | null> {
  const named = Number(new URLSearchParams(location.search).get('tab'));
  if (Number.isInteger(named) && named > 0) return named;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function readPaper(tabId: number): Promise<Paper | null> {
  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectPageMeta,
    });
    if (injected?.result) return paperFrom(injected.result);
  } catch {
    // Chrome's own pages, the Web Store and its PDF viewer cannot be read — but the address of
    // a PDF (arxiv.org/pdf/…, a publisher's /doi/pdf/…) often still names the paper.
  }
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url ? paperFrom({ url: tab.url, title: tab.title ?? '', meta: [] }) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const tabId = await targetTab();
  const paper = tabId === null ? null : await readPaper(tabId);
  if (!paper) {
    render(
      message(
        'No paper found on this page. Open the paper’s own page — the one with its abstract — and click the add-on again.',
      ),
    );
    return;
  }

  render(paperCard(paper), message('Finding your theses…', 'muted'));
  const theses = await ask<Thesis[]>({ type: 'theses' });
  if (!theses.ok) {
    if (theses.status === 401) {
      render(
        paperCard(paper),
        message('Sign in to Thesis Copilot in this browser first, then click the add-on again.'),
        openButton('Open Thesis Copilot', '/sign-in'),
      );
    } else {
      render(paperCard(paper), message(theses.message, 'error'));
    }
    return;
  }
  if (theses.value.length === 0) {
    render(
      paperCard(paper),
      message('You have no thesis yet. Start one in Thesis Copilot, then add papers to it.'),
      openButton('Open Thesis Copilot', '/app'),
    );
    return;
  }

  const stored = (await chrome.storage.local.get('lastDocumentId')) as { lastDocumentId?: unknown };
  const select = el('select', { testId: 'thesis' });
  select.id = 'thesis';
  for (const thesis of theses.value) {
    const option = el('option', { text: thesis.title || 'Untitled thesis' });
    option.value = thesis.id;
    select.append(option);
  }
  if (theses.value.some((t) => t.id === stored.lastDocumentId)) {
    select.value = stored.lastDocumentId as string;
  }
  const label = el('label', { text: 'Add to' });
  label.htmlFor = 'thesis';

  const addButton = el('button', { text: 'Add to library', testId: 'add' });
  addButton.type = 'button';
  const status = el('div', { className: 'status' });

  addButton.addEventListener('click', async () => {
    const documentId = select.value;
    const thesisTitle = select.selectedOptions[0]?.textContent ?? 'your thesis';
    addButton.disabled = true;
    select.disabled = true;
    addButton.textContent = 'Adding…';
    await chrome.storage.local.set({ lastDocumentId: documentId });
    const reply = await ask<Added>({ type: 'add', documentId, paper });
    if (!reply.ok) {
      addButton.disabled = false;
      select.disabled = false;
      addButton.textContent = 'Add to library';
      status.replaceChildren(message(reply.message, 'error'));
      return;
    }
    addButton.remove();
    select.disabled = true;
    const text = reply.value.added
      ? `Added to “${thesisTitle}”. It is being looked up now and will appear in the library in a moment.`
      : reply.value.alreadyPresent
        ? `Already in the library of “${thesisTitle}”.`
        : 'Nothing was added.';
    status.replaceChildren(
      message(text, reply.value.added ? 'success' : 'note'),
      openButton('Open the library', `/app/d/${encodeURIComponent(documentId)}/sources`),
    );
  });

  render(paperCard(paper), el('div', { className: 'field' }, label, select), addButton, status);
}

void main();
