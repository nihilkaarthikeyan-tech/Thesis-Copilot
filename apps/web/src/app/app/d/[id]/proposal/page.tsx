/**
 * `/app/d/:id/proposal` — the Stage 1 screen (PRD §6.1, FR-1.3, FR-1.4).
 */

import { ProposalScreen } from './ProposalScreen';

export const metadata = { title: 'Proposal' };

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProposalScreen documentId={id} />;
}
