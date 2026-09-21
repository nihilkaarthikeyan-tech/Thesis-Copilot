/**
 * Makes TipTap's command types visible to this app.
 *
 * Every TipTap extension declares its commands by augmenting `Commands<ReturnType>` in
 * `@tiptap/core`. An augmentation only exists for a compilation that actually loads the file
 * declaring it, so `editor.chain().toggleBold()` is a type error in any package that does not
 * itself depend on `@tiptap/extension-bold` — even though the command is there at run time,
 * because `packages/ui` registered the extension.
 *
 * That is exactly this app's position: it renders the editor and drives it from
 * `components/editor/FormatToolbar.tsx`, while the extensions are configured one package away in
 * `@tc/ui`. `packages/ui`'s emitted `.d.ts` does not reference these packages — it returns
 * `Extensions`, so nothing forces them into its public types — and the augmentations stop there.
 *
 * These imports are **type-only**. Nothing here is bundled: the extensions are instantiated once,
 * by `thesisExtensions`, and pnpm resolves both packages to the same 2.27.3 copy, so there is no
 * second TipTap in the build.
 *
 * The alternative was moving the toolbar into `packages/ui`. It was rejected because that package
 * styles with plain CSS class names and has neither Tailwind nor `lucide-react`; the toolbar would
 * have had to be rewritten against conventions it does not share, to solve a types problem.
 */

import '@tiptap/starter-kit';
import '@tiptap/extension-image';
import '@tiptap/extension-link';
import '@tiptap/extension-subscript';
import '@tiptap/extension-superscript';
import '@tiptap/extension-table';
import '@tiptap/extension-underline';
