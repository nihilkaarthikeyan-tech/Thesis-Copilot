/**
 * `/app/d/:id/write/:chapterId` — the Stage 4 editor (PRD §6.1, §6.2).
 *
 * PHASES task 0.8: "renders an empty page titled 'Editor — coming in week 1'". The real editor is
 * Phase 1 week 1 (Appendix B) and must not be started before Gate G0 is ticked.
 */

import Link from 'next/link';

export const metadata = { title: 'Editor — coming in week 1' };

export default async function EditorPlaceholderPage({
  params,
}: {
  params: Promise<{ id: string; chapterId: string }>;
}) {
  const { id, chapterId } = await params;

  return (
    <main className="mx-auto max-w-[72ch] px-6 py-16">
      <h1 className="font-serif text-2xl">Editor — coming in week 1</h1>
      <p className="mt-3 text-sm text-muted">
        Document <code className="font-mono">{id}</code>, chapter{' '}
        <code className="font-mono">{chapterId}</code>. The TipTap editor, ghost-text Assist mode
        and Draft mode land in Phase 1 week 1 (PRD Appendix B).
      </p>
      <p className="mt-6 text-sm">
        <Link href="/app" className="underline">
          Back to your theses
        </Link>
      </p>
    </main>
  );
}
