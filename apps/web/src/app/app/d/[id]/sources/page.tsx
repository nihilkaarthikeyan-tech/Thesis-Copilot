/**
 * `/app/d/:id/sources` — the Stage 2 library (PRD §6.1, FR-2.1 to FR-2.3).
 */

import { SourcesScreen } from './SourcesScreen';

export const metadata = { title: 'Sources' };

export default async function SourcesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SourcesScreen documentId={id} />;
}
