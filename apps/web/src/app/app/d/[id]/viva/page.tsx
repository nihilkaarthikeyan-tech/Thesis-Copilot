/**
 * `/app/d/:id/viva` — viva preparation (ADR-0030).
 */

import { VivaScreen } from './VivaScreen';

export const metadata = { title: 'Viva preparation' };

export default async function VivaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VivaScreen documentId={id} />;
}
