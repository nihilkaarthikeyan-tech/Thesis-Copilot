/**
 * Collections (folders) in the library — the one rule the screen and the API must share. The API
 * refuses a longer name (`apps/api/src/modules/sources/collections.service.ts`); the name box on
 * the Library tab stops typing at the same length (`CollectionsStrip.tsx`), so a student can never
 * type a name the server will refuse.
 */
export const COLLECTION_NAME_MAX = 60;
