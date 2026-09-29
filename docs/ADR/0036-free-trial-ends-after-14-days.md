# ADR-0036: The free trial ends after 14 days

Date: 2026-09-29 · Status: accepted (the owner: "make the trial end after 14 days")

## Context

The landing page, sign-up and terms promised a "14-day free trial", and `PLAN_LIMITS.FREE_TRIAL`
carried `trialDays: 14`, but nothing ever read it. `effectivePlan` returns `FREE_TRIAL` for as
long as there is no subscription, so the trial was a free plan with no end (found while building
ADR-0035). Asked to choose between enforcing 14 days and calling it a free plan, the owner chose
to enforce it.

## Decision

- `User.trialEndsAt`, defaulted by the database to `now() + 14 days`, so every way an account is
  created (OTP, password, Google) gets it without code in each path.
- In `UsageService.consume`, the one place every metered action passes: on `FREE_TRIAL` with
  `trialEndsAt` in the past, the plan cap is 0. An admin's extra allowance (`bonus`) still counts,
  so a grant can help someone finish. Paid and institution plans never read the date.
- The refusal is `CAP_EXCEEDED` (so every screen that already shows a refused action shows it),
  status 402, with no `resetsAt` and `trialEnded: true`, and says: the trial ended on <date>, the
  theses are safe, keep writing, subscribe to use the AI again.
- Nothing else stops: writing, editing, citations already in the document, export and the
  theses themselves are untouched.
- The student is told before it matters: the thesis list and the account page show the days left
  through the last week, and after the end say what still works, with a link to the plans.
- Admin: the date on the user list and page, "Extend free trial" (days from today or from the
  current end, whichever is later; logged as `TRIAL_EXTENDED` with a reason), and "Trials ending
  in 3 days" on the overview.
- The terms now say what happens when the trial ends, and that a lapsed paid plan pauses the AI
  features rather than falling back to trial allowances (which would now be none).

## Existing accounts

Migration 0024 gives every account that existed before the release `now() + 14 days`, except
accounts still inside their first 14 days, which keep sign-up + 14 days. Nobody lost the AI
features on the day this shipped without having been told.

## Not done

A reminder email a few days before the end. The in-app notice covers students who open the app;
an email would reach the ones who do not, and is a small follow-up if the owner wants it.
