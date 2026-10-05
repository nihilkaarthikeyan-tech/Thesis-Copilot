# 0077 — The strong model for chat and drafting

Date: 2026-10-05
Status: accepted (the owner's decision)
Follows: the side-by-side study, item C4.

## Context

The side-by-side study found Jenni's chat answers far richer than ours. Ours ran one retrieval
and one call to the fast tier (`gpt-4.1-mini` since ADR-0051). The owner was asked whether chat
and drafting should use the stronger model, and decided yes.

## Decision

- **Drafting** already ran on the strong tier (`gpt-5-mini`): the `draftModeStrongTier` flag is
  on in production, and the PRD default is strong. Nothing to change.
- **Chat** answers move to the strong tier (`gpt-5-mini`).
  - The switch is one constant in `packages/ai` (`CHAT.tier`), made as part of C2's research chat
    (ADR-0074), which also evaluates its answers on the strong tier.
  - The cost profile moves now (`ACTION_PROFILES.CHAT`: strong; 4,000 in, 4,000 cached and 1,600
    out). A reasoning model bills its thinking as output, so the 600-token answer is priced with
    ~1,000 tokens of reasoning on top.

## Cost

- **Per question:** ₹0.3741 on `gpt-5-mini`, up from ₹0.03–0.22 on the fast tier.
- **Per student**, worst case for a fully active one (15 questions a month on a paid plan):
  - production configuration (Assist on `gpt-4.1-mini`, strong on `gpt-5-mini`): **₹88.19**, was
    ₹85.82;
  - with `gpt-5-nano` on the fast tier: ₹69.06, was ₹63.89.
- **Ceiling:** within ₹100. The runtime hard stop at ₹100 of real spend (`UsageService.consume`)
  holds regardless.
- **The PRD self-check** (ADR-0030: the PRD's own six §11.3 rows at its reference prices) now
  prices them with the PRD's own §11.2 shapes (`PRD_ACTION_PROFILES`), where chat is a fast-tier
  action, so it still checks what the PRD printed. At the PRD's reference strong-tier prices, a
  strong-tier chat would not fit: about ₹140 a month.
- **A pricier strong-tier model** (a larger reasoning model, or Anthropic's) would need this
  re-checked before switching. `pnpm ai:verify` prints the budget for whatever is configured.

## Tests

`packages/config/test/cost-model.spec.ts`:
- the PRD self-check uses `PRD_ACTION_PROFILES`;
- the production totals are pinned at ₹69.06 and ₹88.19;
- 83 pass.
