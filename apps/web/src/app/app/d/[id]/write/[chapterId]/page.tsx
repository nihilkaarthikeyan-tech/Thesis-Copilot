/**
 * `/app/d/:id/write/:chapterId` — the Stage 4 editor (PRD §6.1, §6.2, Appendix B).
 */

import 'katex/dist/katex.min.css';
import '../../../../../editor.css';
import { ThesisEditor } from '@/components/editor/ThesisEditor';

export const metadata = { title: 'Write' };

export default async function WritePage({
  params,
}: {
  params: Promise<{ id: string; chapterId: string }>;
}) {
  const { id, chapterId } = await params;
  return <ThesisEditor documentId={id} chapterId={chapterId} />;
}
