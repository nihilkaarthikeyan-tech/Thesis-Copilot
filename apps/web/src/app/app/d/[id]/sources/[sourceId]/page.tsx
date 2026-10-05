/**
 * `/app/d/:id/sources/:sourceId` — the paper reader (ADR-0068). The Chrome add-on deep-links to
 * this exact path; `lib/reader.ts` `readerHref` is the one place it is spelled in the app.
 */

import { Suspense } from 'react';
import { PaperReader } from './PaperReader';

export const metadata = { title: 'Paper' };

export default async function PaperPage({
  params,
}: {
  params: Promise<{ id: string; sourceId: string }>;
}) {
  const { id, sourceId } = await params;
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted">Opening the paper…</p>}>
      <PaperReader documentId={id} sourceId={sourceId} />
    </Suspense>
  );
}
