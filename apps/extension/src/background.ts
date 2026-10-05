/**
 * The add-on's service worker — ADR-0031, ADR-0069. It makes the calls to Thesis Copilot for the
 * popup (the student's theses, a thesis's collections, saving), and owns the right-click item.
 *
 * It signs nobody in. The student's own session cookie for the site goes with each request, the
 * same one the website uses, so a student signed in to Thesis Copilot in this browser is signed in
 * here, and signing out there signs the add-on out too.
 */

import { fetchPdf, makeApi } from './api.js';
import { API_URL } from './config.js';
import type { Failure, Progress, Request } from './messages.js';
import { paperFromLink } from './paper.js';
import { PENDING_KEY, type PendingLink } from './pending.js';
import { runSave } from './save.js';

const api = makeApi(API_URL);
const MENU_ID = 'add-link';

/**
 * Links that name one paper: DOI links, publishers' `/doi/…` article paths, arXiv abstracts and
 * PDFs. Chrome shows the item only on these; `paperFromLink` checks the address again on click.
 */
const LINK_PATTERNS = [
  '*://doi.org/*',
  '*://dx.doi.org/*',
  '*://*/doi/*',
  '*://arxiv.org/abs/*',
  '*://arxiv.org/pdf/*',
  '*://www.arxiv.org/abs/*',
  '*://www.arxiv.org/pdf/*',
];

chrome.runtime.onInstalled.addListener(() => {
  void chrome.contextMenus.removeAll().then(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Add to Thesis Copilot',
      contexts: ['link'],
      targetUrlPatterns: LINK_PATTERNS,
    });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID || !info.linkUrl) return;
  const paper = paperFromLink(info.linkUrl);
  if (!paper) return;
  const pending: PendingLink = { paper, at: Date.now() };
  // `storage.session` lives in memory only and is gone when the browser closes.
  void chrome.storage.session.set({ [PENDING_KEY]: pending }).then(async () => {
    try {
      // Opens the same window as the toolbar button, showing the linked paper (Chrome 127+).
      await chrome.action.openPopup();
    } catch {
      // No focused window to open it in: the badge says there is something to add.
      await chrome.action.setBadgeBackgroundColor({ color: '#2743c4' });
      await chrome.action.setBadgeText({ text: '1' });
      await chrome.action.setTitle({ title: 'Thesis Copilot: click to add the linked paper' });
    }
  });
});

chrome.runtime.onMessage.addListener((message: Request, sender, sendResponse) => {
  // Only this add-on's own pages talk to it; a web page cannot reach `onMessage`.
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return false;
  let work: Promise<unknown>;
  switch (message.type) {
    case 'theses':
      work = api.theses();
      break;
    case 'collections':
      work = api.collections(message.documentId);
      break;
    case 'create-collection':
      work = api.createCollection(message.documentId, message.name);
      break;
    case 'save': {
      const { job } = message;
      const total = job.items.length;
      work = runSave(job, { api, fetchPdf: (url) => fetchPdf(url) }, (results) => {
        const update: Progress = { type: 'progress', runId: job.runId, results, total };
        // The popup may have closed; the save carries on regardless.
        chrome.runtime.sendMessage(update).catch(() => undefined);
      }).then((value) => ({ ok: true, value }));
      break;
    }
    default:
      return false;
  }
  work.then(sendResponse, (error: unknown) => {
    const failure: Failure = { ok: false, status: 0, message: String(error).slice(0, 300) };
    sendResponse(failure);
  });
  // The answer is sent later, so the channel must stay open.
  return true;
});
