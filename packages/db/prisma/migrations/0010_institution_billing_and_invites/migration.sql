-- ADR-0009: an institution needs a rate to invoice against and a way to hold a seat for an
-- address that has no account yet.
--
-- PRD section 11.6 prices an institution seat at "INR 200-250 negotiated" — a band, per
-- department. `PRICING.INSTITUTION_SEAT` is priceInr: 0 with "Negotiated per department", which is
-- right for the pricing page and useless for an invoice, so the agreed rate lives on the row.
--
-- Seats likewise cannot be counted from `Institution.users`: an invite goes to an address with no
-- account, so 30 seats could be invited 300 times and the overcount would only surface when the
-- 31st person accepted. A pending invite holds a seat.

ALTER TABLE "Institution" ADD COLUMN "seatPriceInr" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Institution" ADD COLUMN "billingPeriod" TEXT NOT NULL DEFAULT 'yearly';
ALTER TABLE "Institution" ADD COLUMN "billingEmail" TEXT;

CREATE TABLE "InstitutionInvite" (
  "id"            UUID NOT NULL DEFAULT uuid_generate_v7(),
  "institutionId" UUID NOT NULL,
  "email"         TEXT NOT NULL,
  "invitedById"   UUID NOT NULL,
  "acceptedAt"    TIMESTAMP(3),
  "acceptedById"  UUID,
  "revokedAt"     TIMESTAMP(3),
  "expiresAt"     TIMESTAMP(3) NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InstitutionInvite_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InstitutionInvite"
  ADD CONSTRAINT "InstitutionInvite_institutionId_fkey"
  FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One live invite per address per institution; re-inviting updates the row rather than adding a
-- second seat hold.
CREATE UNIQUE INDEX "InstitutionInvite_institutionId_email_key"
  ON "InstitutionInvite"("institutionId", "email");

-- Sign-in looks an address up here to attach the new account to its institution.
CREATE INDEX "InstitutionInvite_email_idx" ON "InstitutionInvite"("email");
