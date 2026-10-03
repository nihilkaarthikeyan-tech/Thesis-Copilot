# ADR-0044 — A SHA-256 fingerprint on every thesis export

**Status:** accepted · **Date:** 2026-10-03 · **Builds on:** the submission bundle
(`ThesisExportService`, Appendix D.3).

## Context

A thesis export leaves the product as a file the student downloads and then uploads somewhere else —
a committee portal, an email, a university system. Between here and there, nothing tied the file to
what we produced: a student could not prove the PDF they submitted is the one that passed the
compliance checks, and a committee could not tell an altered file from the original. The owner asked
to build the integrity-safe improvements one at a time; this is the fifth and last of the set.

## Decision

Fingerprint every export. When `ThesisExportService` stores an exported file (`docx`, `pdf`,
`latex`, `html`), it computes the SHA-256 of the exact bytes it stored, records an `ExportArtifact`
row (document, user, format, filename, storage key, size, hash, time), and returns the hash in the
export result. The Submit screen shows it under each download, selectable, with a hint on how to
recompute it (`sha256sum` / `Get-FileHash`). `GET /documents/:id/export/artifacts` lists the recent
fingerprints for a thesis.

- Migration `0028_export_artifact`; additive, no change to existing data.
- No metered unit: hashing bytes already in hand costs nothing and calls no provider.

## What it is, stated honestly

It is a **content fingerprint (checksum)**, not a cryptographic signature and not a certificate of
authorship. Its guarantee is exactly a checksum's: anyone who has the file can recompute its SHA-256
and check it equals the value on the student's receipt and in our record, and so detect any change
to the bytes. The user-facing copy says "fingerprint" and shows how to verify; it does not claim the
file is signed by, endorsed by, or certified by anyone. An HMAC with a server secret was considered
to make the stamp forgeable only by us, but it would move verification behind the server for no real
gain over a recomputable public hash, so a plain SHA-256 is the boring, honest choice (§0.3 rule 5).

## Alternatives considered

- **Embedding the hash inside the PDF/DOCX metadata.** Rejected for now: it complicates the document
  builders and a reader cannot verify a self-referential hash without stripping it first. The record
  plus the receipt is simpler and verifiable with a standard tool.
- **A cryptographic signature (HMAC or asymmetric).** Deferred: see above. The interface could be
  extended to sign the fingerprint later without changing what is stored.
