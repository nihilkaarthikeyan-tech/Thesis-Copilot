-- Idempotency key for events that arrive from outside and may arrive twice.
--
-- The billing webhook deduplicated by reading `AuditEvent` and then acting, which two concurrent
-- Razorpay retries can both pass — and the subscription was updated before the marker row was
-- written, so both would extend the paid period. A unique column lets the database refuse the
-- second one instead.
ALTER TABLE "AuditEvent" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "AuditEvent_dedupeKey_key" ON "AuditEvent"("dedupeKey");
