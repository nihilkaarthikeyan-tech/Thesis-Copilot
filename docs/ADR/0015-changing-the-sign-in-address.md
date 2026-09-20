# ADR-0015 — a student can change the address they sign in with

**Date:** 2026-09-20
**Status:** Accepted
**Extends:** PRD §12 (account and privacy), which does not mention this at all.

## Why this was missing

PRD §7.2 chose Better Auth with **email OTP and no password**. That decision is right and is not
being revisited — there is no credential to lose, reset or leak, and the OTP doubles as email
verification on every sign-in.

It has one consequence nobody wrote down: **the address is the credential.** "Change my email" is
not a profile setting here the way it is in a product with passwords; it is the whole of how a
person gets back in. So it fell between §12's privacy items and §2's product surface and was
simply never specified, and the account page had no route to it.

The failure it produces is quiet and total. A student signs up with a university address, works on
a thesis for eighteen months, graduates, and the university closes the mailbox. There is now no
way to sign in and no way to ask for one, because every recovery path also ends at that mailbox.
The thesis is still there and still paid for and cannot be reached. Found by auditing the account
surface on 2026-09-14 and recorded in `docs/PENDING.md` as a question rather than a defect; this
is the answer.

## Decision

**Use Better Auth's own `changeEmail` flow on the `emailOTP` plugin, with the code going to the
new address, and wrap it for the things the library has no opinion about.**

The library half is not reimplemented (§0.3 rule 5). Better Auth 1.7.2 already does the hard
parts, and does them better than a hand-rolled version would: a single-use OTP with an atomic
consume so a correct code can only ever be spent once, an attempt budget, and a request step that
is deliberately enumeration-safe — it returns success and sends nothing when the target address
already belongs to an account.

`EmailChangeService` adds three things around it:

- **a warning to the address being left**, sent at request time;
- **an `EMAIL_CHANGED` audit row** carrying both addresses, because after the update the `User`
  row no longer remembers where the account came from;
- **a refusal while a deletion is pending**, since moving an account out from under a scheduled
  erasure is the next move of someone who should not have the session.

## `verifyCurrentEmail: false`, deliberately

Better Auth offers a stricter mode that also demands a code at the *current* address. It is off.

Requiring the old mailbox in order to leave the old mailbox defeats the only case this feature
exists for. A student who can still read their university mail has no urgent problem; the one who
cannot is exactly the person this is for, and the strict mode locks them out of the escape hatch.

What is actually being proved is control of the **new** address, and that is what the code proves.

## What the warning does and does not cover

Honest accounting, because this is the security-load-bearing part and it is only half a defence.

The residual risk is a **live session in the wrong hands** — a shared or stolen laptop. Whoever
holds it can move the account to an address they control and the real owner is locked out
permanently. The mitigations are the warning to the old address at request time, while the change
still needs a code that has not been entered yet, and the audit row afterwards.

That warning lands in the old mailbox, so it protects the student who still reads it and does
nothing for the student who has already lost it. There is no version of this that covers both:
the same property that makes the feature useful — not needing the old mailbox — is the property
that makes the warning skippable. Accepted knowingly rather than papered over.

The destination is **masked** in that warning (`ka•••••@gmail.com`). If the request was hostile,
the warning is a message from us to the victim naming the attacker's inbox; if it was legitimate,
two characters and the domain are plenty to recognise. Enough to answer "no, that isn't me", not
enough to be a new fact.

**Not** signing every device out on success, which is the reflex for a credential change. The
person who just proved the new mailbox is the student, and the address is their only way back in;
signing them out would mean immediately re-entering a code, and would achieve nothing against an
attacker who is holding the session that did it.

## Consequences

**`GET /account/deletion` and the email routes now interlock.** The student has to resolve a
pending deletion before changing the address, which forces the two decisions to be taken one at a
time instead of in a sequence that hides one inside the other.

**Better Auth's `APIError` is translated at this boundary.** Found the first time the flow ran end
to end: `auth.api.*` throws an error class Nest does not recognise, so a mistyped six-digit code
came back **500 Internal Server Error** — the student told the server is broken when they had
fat-fingered a digit, and a server fault in the log that never happened. `asAppError` maps by
status code, never by matching message text, so an upstream copy-edit cannot turn it back into a
500.

**The address is still not a recovery mechanism.** This lets a student move an account they can
still reach. It does nothing for one already locked out, and deliberately so — a route that moved
an account without proving control of either mailbox would be a takeover feature. That case stays
a support matter, and `docs/PENDING.md` keeps it open.
