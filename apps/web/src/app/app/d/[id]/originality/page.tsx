/**
 * `/app/d/:id/originality` — read-only overlap check (ADR-0042).
 */

import { OriginalityScreen } from './OriginalityScreen';

export const metadata = { title: 'Originality check' };

export default async function OriginalityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OriginalityScreen documentId={id} />;
}
