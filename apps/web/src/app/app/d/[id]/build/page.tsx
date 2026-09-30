/**
 * `/app/d/:id/build` — chapter build (ADR-0039).
 */

import { BuildScreen } from './BuildScreen';

export const metadata = { title: 'Build a chapter' };

export default async function BuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BuildScreen documentId={id} />;
}
