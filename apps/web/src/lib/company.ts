/**
 * Who runs Thesis Copilot — the details the Terms and Contact pages print (2026-09-25).
 *
 * A payment gateway's approval (Razorpay's included) reads these pages, and a paying customer must
 * be able to reach the business behind a charge. None of it may be guessed, so each value stays
 * `null` until the owner supplies it (`docs/PENDING.md`), and the pages say a detail is still to
 * be added rather than print an invented one. Nothing is released with a `null` here.
 */

export const COMPANY: {
  /** The registered legal name, as on the company or GST registration. */
  legalName: string | null;
  /** The registered address, in full. */
  address: string | null;
  /** Where students write for help; read by a person. */
  supportEmail: string | null;
  phone: string | null;
  /** The city whose courts the Terms name. */
  jurisdictionCity: string | null;
} = {
  legalName: null,
  address: null,
  supportEmail: null,
  phone: null,
  jurisdictionCity: null,
};

/** The operator's name for running text: the legal name once known. */
export const operatorName = (): string => COMPANY.legalName ?? 'the operator of Thesis Copilot';
