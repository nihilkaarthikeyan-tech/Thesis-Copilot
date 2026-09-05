/**
 * `/app/d/:id/outline` — the Stage 3 screen (PRD §6.1, FR-3.1–3.5).
 */

import { OutlineScreen } from './OutlineScreen';

export const metadata = { title: 'Outline' };

export default async function OutlinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OutlineScreen documentId={id} />;
}
