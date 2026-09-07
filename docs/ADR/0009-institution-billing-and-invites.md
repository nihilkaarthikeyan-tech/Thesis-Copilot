# 0009 — Institutions need a seat rate and a pending-invite row

Date: 2026-09-07
Status: accepted
Amends: PRD §8 `model Institution`.

## Context

FR-9.6 asks for institution admin: "create institution, invite students, seat count, usage by
student, invoice PDF". PRD §8 gives `Institution { id, name, seats, templateId, users, createdAt }`.

Two things in FR-9.6 cannot be built against that model.

**There is nothing to invoice against.** §11.6 prices an institution seat at "₹200–250
negotiated" — a range, per department, settled in a conversation. `PRICING.INSTITUTION_SEAT` is
`priceInr: 0` with the blurb "Negotiated per department", which is correct for the pricing page
and useless for an invoice. An invoice needs the number that was actually agreed with *this*
institution.

**Seats cannot be counted before people sign up.** `Institution.users` counts accounts that exist.
An invite is sent to an address that has no account yet, so an institution with 30 seats could
invite 300 people and only discover the overcount when the 31st accepted. §11.3 makes
`INSTITUTION_SEAT` a real plan with real caps, so an uncounted seat is uncapped spend.

## Decision

Three columns on `Institution` and one new table.

- `seatPriceInr Int @default(0)` — the negotiated rate, set when the institution is created.
- `billingPeriod String @default("yearly")` — what one seat charge buys.
- `billingEmail String?` — where the invoice goes; falls back to the admin's own address.
- `model InstitutionInvite { institutionId, email, invitedById, acceptedAt, acceptedById,
  revokedAt, expiresAt }`, unique on `(institutionId, email)`.

**A pending invite holds a seat.** Seats used = members + invites that are neither accepted,
revoked, nor expired. Inviting past the seat count is refused with the numbers in the message.

`seatPriceInr` is deliberately per-institution rather than a constant in `packages/config`: the
price is negotiated, so there is no single right value to put there, and §0.3 rule 4 forbids
guessing one. The default of 0 means an institution created without a rate produces a ₹0 invoice
that says so, rather than a plausible wrong number.

## Consequences

- Migration `0010_institution_billing_and_invites`.
- The invoice is per **period** (a month or a year of seats), unlike the student invoice which is
  per charge from a `BILLING_EVENT` row. Institutions are billed by agreement, not by Razorpay, so
  there is no charge event to build one from.
- `docs/PENDING.md` keeps §11.6's price confirmation: the ₹200–250 band is a PRD estimate and each
  institution's actual rate is a human decision typed into this column.
