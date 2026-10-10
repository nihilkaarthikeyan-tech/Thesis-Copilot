/**
 * The add-on's service worker — ADR-0031, ADR-0069, ADR-0125. It makes the calls to Thesis
 * Copilot for the popup and for the in-page buttons (the student's theses, a thesis's
 * collections, a lookup, saving), and owns the right-click item.
 *
 * It signs nobody in. The student's own session cookie for the site goes with each request, the
 * same one the website uses, so a student signed in to Thesis Copilot in this browser is signed in
 * here, and signing out there signs the add-on out too.
 */

import { anywhereGranted, chromeAnywhere, neverHere, ownHosts, syncAnywhere } from './anywhere.js';
import { fetchPdf, makeApi } from './api.js';
import { API_URL, WEB_URL } from './config.js';
import { senderMay } from './hosts.js';
import { type Failure, INPAGE_REQUESTS, type Progress, type Request } from './messages.js';
import { paperFromLink } from './paper.js';
import { PENDING_KEY, type PendingLink } from './pending.js';
import { checkRef, refQuery } from './refs.js';
import { checkSaveManyJob, checkSaveOneJob, runSave, saveMany, saveOne } from './save.js';

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

/** A request a content script sent that does not check out. */
const refused = (message: string): Promise<Failure> =>
  Promise.resolve({ ok: false, status: 400, message });

// ADR-0154: the every-site buttons follow the access Chrome holds — on every wake of the service
// worker, and whenever the student grants or removes it (the popup's switch, or chrome://extensions).
const own = ownHosts([API_URL, WEB_URL]);
const sync = () => syncAnywhere(chromeAnywhere(), own).catch(() => false);
void sync();
chrome.permissions.onAdded.addListener(() => void sync());
chrome.permissions.onRemoved.addListener(() => void sync());

chrome.runtime.onMessage.addListener((message: Request, sender, sendResponse) => {
  // Only this add-on talks to it; a web page itself cannot reach `onMessage`.
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return false;
  const ownOrigin = chrome.runtime.getURL('');
  // The popup may ask anything; a content script only what the in-page card needs (ADR-0125).
  if (senderMay(sender, message.type, ownOrigin, INPAGE_REQUESTS)) {
    return answer(message, sendResponse);
  }
  // A content script on another site: only while the student has the every-site buttons on.
  const anywhere = { never: (host: string) => neverHere(host, own) };
  if (!senderMay(sender, message.type, ownOrigin, INPAGE_REQUESTS, anywhere)) return false;
  void anywhereGranted(chromeAnywhere()).then((granted) => {
    if (granted) answer(message, sendResponse);
    else
      sendResponse({
        ok: false,
        status: 403,
        message: 'Save buttons on every site are turned off. Turn them on in the add-on’s window.',
      } satisfies Failure);
  });
  return true;
});

/** Starts the work a request asks for and answers when it is done; false for an unknown request. */
function answer(message: Request, sendResponse: (reply: unknown) => void): boolean {
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
    case 'lookup': {
      const ref = checkRef(message.ref);
      work = ref
        ? api.lookupId(message.documentId, refQuery(ref))
        : refused('That is not a DOI, an arXiv id or a PubMed id.');
      break;
    }
    case 'save-one': {
      const job = checkSaveOneJob(message.job);
      work = job
        ? saveOne(job, { api }).then((value) => ({ ok: true, value }))
        : refused('The add-on could not read what to save. Reload the page and try again.');
      break;
    }
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
    case 'save-many': {
      const job = checkSaveManyJob(message.job);
      work = job
        ? saveMany(job, { api }).then((value) => ({ ok: true, value }))
        : refused('The add-on could not read what to save. Reload the page and try again.');
      break;
    }
    case 'anywhere-sync':
      work = sync().then((value) => ({ ok: true, value }));
      break;
    default:
      return false;
  }
  work.then(sendResponse, (error: unknown) => {
    const failure: Failure = { ok: false, status: 0, message: String(error).slice(0, 300) };
    sendResponse(failure);
  });
  // The answer is sent later, so the channel must stay open.
  return true;
}
