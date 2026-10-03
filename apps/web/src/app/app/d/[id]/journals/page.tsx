/**
 * `/app/d/:id/journals` — journal matching (ADR-0040).
 */

import { JournalsScreen } from './JournalsScreen';

export const metadata = { title: 'Journal matches' };

export default async function JournalsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JournalsScreen documentId={id} />;
}
