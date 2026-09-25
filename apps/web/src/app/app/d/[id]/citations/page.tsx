/**
 * `/app/d/:id/citations` — the pre-submission citation report (2026-09-25).
 */

import { CitationReport } from './CitationReport';

export const metadata = { title: 'Citation report' };

export default async function CitationReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CitationReport documentId={id} />;
}
