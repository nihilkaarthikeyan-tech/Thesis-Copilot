/**
 * Runtime values of the Prisma enums that other packages need to iterate.
 *
 * Prisma generates enum *types*, and with `prisma-client-js` the runtime objects are only reachable
 * through `Prisma.<Enum>Enum`. Re-exporting the list here keeps the parity test in
 * `test/enum-parity.spec.ts` honest: it compares this list against `packages/config`.
 */

import { $Enums } from '@prisma/client';

export const AI_ACTION_VALUES = Object.values($Enums.AiAction) as readonly string[];
