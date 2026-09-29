# ADR-0035: Superadmin controls, and an administrator may read a thesis openly

Date: 2026-09-29 · Status: accepted (the owner, from the approved design PDF)

## Context

The owner asked for "overall control of the platform" in the superadmin screens: search and
suspend accounts, sign them out, give extra allowance, manage and delete their theses, delete an
account, a growth overview, an activity log, background jobs, a feedback inbox and storage totals.
They also asked that an administrator be able to "sneak inside" a student's account and work.

Until now the privacy page promised that administrators see email, plan, usage and document titles
"and not your chapters", and `UsersService` was written to titles-only on purpose (PHASES 5.9,
§12.2). Secret access would have broken that promise without telling anyone.

## Decision

Asked to choose, the owner chose **open, read-only access**:

- A superadmin can open any thesis read-only (`/admin/theses/:id`). No editor is mounted; the saved
  content is drawn as HTML. Nothing on the page can change it.
- Every open is written to `AuditEvent` (`THESIS_VIEWED`, and `CHAPTER_VIEWED` per chapter read),
  with the admin as actor.
- The student is emailed when an administrator opens their thesis. A reopen by the same admin
  inside ten minutes is logged but not mailed again, so a refresh is not an alarm.
- The privacy page says so, in the words the owner approved.
- Existing students are told by a one-off email, `node apps/api/dist/privacy-notice.js --send` inside the API container, run only
  after the owner approves the text at send time. The script is a dry run without `--send`.

The rest of the controls, all SUPERADMIN-only and all logged with the admin as actor:

- **Suspend / unsuspend** (`User.suspendedAt`, `suspendedReason`). Suspending deletes every
  session; Better Auth's `session.create.before` hook refuses a new one by any sign-in method
  (403 `ACCOUNT_SUSPENDED` with a sentence; the Google callback can carry no message, so it
  refuses the session and the web page explains `unable_to_create_session`).
- **Sign out of every device**.
- **Extra allowance** (`UsageLedger.bonus`): units of one action for the current month only. The
  cap check stays one atomic statement: `WHERE count < cap + bonus`. It cannot lift the ₹100
  per-student ceiling or the site-wide budget; those checks run first, unchanged.
- **Delete a thesis** (admin, with a reason the student is emailed) and **delete own thesis**
  (student, `DELETE /documents/:id`). Both go through `DocumentEraser`, which account erasure
  now uses too; it also removes figures and version snapshots, which erasure used to leave behind.
- **Start / cancel account deletion** — the same seven-day deletion a student can start.
- An admin cannot suspend, sign out or delete their own account from these screens.

## Not done, on purpose

- **Extend free trial.** Nothing ends a free trial today: `effectivePlan` returns `FREE_TRIAL` for
  as long as there is no subscription, and `trialDays: 14` is never enforced, while the landing
  page, sign-up and terms say "14-day free trial". Extending something that never ends would be a
  button that does nothing. The owner decides whether to enforce 14 days or to call it a free plan
  (docs/PENDING.md).
- **Impersonation** (signing in as the student). Read-only viewing covers support; acting as the
  student would let an admin write into a thesis under the student's name, which "Flag, don't fix"
  and the privacy promise both forbid.
