/**
 * `/app/d/:id/review` — the review queue (PRD §5.7, Appendix D.2.4).
 */

import { ReviewQueue } from './ReviewQueue';

export const metadata = { title: 'Review' };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewQueue documentId={id} />;
}
