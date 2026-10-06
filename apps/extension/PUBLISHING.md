# Publishing the Chrome add-on — step by step

For someone who has never published an extension. Allow an hour for the first time, then a few
days for Google's review. `STORE.md` has every piece of text to paste; this file says where it goes.

## 0. Before you start

- A Google account you will keep for the product (a shared work account is better than a personal
  one: whoever owns it owns the listing). Turn on **2-Step Verification** for it — the Chrome Web
  Store requires it to publish.
- A card for the **one-time developer registration fee** (US$5 at the time of writing; the
  dashboard shows the current amount). It is paid once per account, not per extension.
- The site's privacy page live with the add-on section (`/privacy` → "The Chrome add-on"). It ships
  with the next release of the site; publish the add-on after that release, because the store
  form asks for the privacy policy link and the reviewer may read it.

## 1. Build the zip

On the machine with the repository:

```bash
pnpm i
pnpm --filter @tc/extension build
```

The last line says `Wrote thesis-copilot-chrome-0.2.1.zip`. The file is
`apps/extension/thesis-copilot-chrome-0.2.1.zip`; it holds the contents of `dist/` (the manifest at
its top level), which is what the store wants.

Try it once before uploading: Chrome → `chrome://extensions` → switch on **Developer mode** →
**Load unpacked** → choose `apps/extension/dist`. Sign in at https://thesis.rademics.ai, open any
article page and click the add-on.

## 2. Register as a developer (once)

1. Go to https://chrome.google.com/webstore/devconsole and sign in with the account from step 0.
2. Accept the developer agreement, pay the fee.
3. **Account** tab: set the publisher name people will see (e.g. "Rademics"), a contact email, and
   verify that email when Google writes to it.
4. If the dashboard asks whether you are a **trader** (the EU's Digital Services Act question):
   a business offering a product is a trader; give the business address and contact it asks for.

## 3. Upload

1. **Items** → **New item** → choose `thesis-copilot-chrome-0.2.1.zip`.
2. The dashboard reads the name, version (0.2.1), description and icon from the zip.

## 4. Fill the tabs

### Store listing

| Field | What to put |
|---|---|
| Description | "Description" from `STORE.md` |
| Category | Education |
| Language | English |
| Store icon | `apps/extension/static/icons/icon-128.png` |
| Screenshots | `apps/extension/store/screenshot-1-save-a-paper.png`, then `apps/extension/store/screenshot-2-save-results.png` (both exactly 1280×800) |
| Small promo tile | `apps/extension/store/promo-small-440x280.png` |
| Marquee promo tile | Leave empty (only used if Google features the item) |
| Official URL / Homepage | https://thesis.rademics.ai |
| Support URL | https://thesis.rademics.ai, or a support email page |

### Privacy practices

Copy each box from `STORE.md` → "Privacy practices tab":

1. **Single purpose description.**
2. **Permission justification** — one box per permission: `activeTab`, `scripting`, `storage`,
   `contextMenus`, and the host permission. The dashboard lists exactly the ones in the manifest;
   if it shows one that `STORE.md` does not explain, stop: the build is not the one described here.
3. **Remote code:** "No, I am not using remote code".
4. **Data usage:** tick **Website content** only, and the three certifications.
5. **Privacy policy URL:** https://thesis.rademics.ai/privacy

### Distribution

- **Payments:** Free.
- **Visibility:** choose **Unlisted** for the first release (only people with the link can install
  it; good for a pilot), or **Public**. You can change it later without a new review.
- **Regions:** All regions, or the ones you sell in.

## 5. Submit

**Submit for review**. You may tick "publish automatically after approval", or leave it off and
press **Publish** yourself when the email arrives.

**How long:** Google says most reviews finish within a few days and some take up to a few weeks.
New developers and new items take longer than updates. If it has been more than three weeks,
contact developer support from the dashboard.

## 6. If it is rejected

The email names the policy. The common ones, and why this add-on should pass them:

| Reason | Where this add-on stands |
|---|---|
| **Permissions not justified, or broader than needed** | Five permissions, each explained in `STORE.md`; no `<all_urls>`, no `tabs`, no content scripts. If a reviewer queries one, reply quoting the justification. |
| **Misleading or keyword-stuffed description** | The description says only what the add-on does; no other product's name is used to attract searches. Keep it that way when you edit it. |
| **Missing or inadequate privacy policy** | The `/privacy` page must be live and must mention the add-on, results pages and PDFs (it does from the release carrying ADR-0069). |
| **Single purpose unclear** | "Save scholarly papers you are viewing to your Thesis Copilot library" — every feature is a way of doing that. |
| **Remote code / obfuscation** | None: the code in the zip is the compiled TypeScript, readable, with no bundler and no downloaded scripts. |
| **Functionality not testable** | The reviewer needs an account. In the dashboard's "Test instructions" (if shown), give a test account's email and say sign-in is by an emailed code — or create a reviewer account with a password (ADR-0033) and give that. |

Fix what the email names, bump the version (below) and submit again.

## 7. Publishing an update later

1. Change the code. Add a line to `apps/extension/CHANGELOG.md`.
2. Raise `"version"` in `apps/extension/package.json` (e.g. 0.2.1 → 0.2.2). The store refuses a zip
   whose version is not higher than the published one.
3. `pnpm --filter @tc/extension build` → `apps/extension/thesis-copilot-chrome-<version>.zip`.
4. If the popup looks different, `node apps/extension/scripts/store-assets.mjs` redraws the
   screenshots; upload the new ones.
5. Dashboard → the item → **Package** → **Upload new package** → the new zip → update any tab whose
   facts changed (a **new permission needs a new justification**, and Chrome will ask existing
   users to approve a permission that adds a warning) → **Submit for review**.
6. After approval, installed copies update themselves within a few hours.

## 8. After publishing

- Put the store link on the site (for example in the library's empty state) and in
  `docs/PENDING.md`.
- The dashboard's **Analytics** shows installs; the add-on itself collects nothing.
