/**
 * `/app/d/:id/submit` — thesis details, template and the compliance checklist (PRD Appendix D.3).
 */

import { SubmitScreen } from './SubmitScreen';

export const metadata = { title: 'Submit' };

export default async function SubmitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SubmitScreen documentId={id} />;
}
