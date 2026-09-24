'use client';

/**
 * The editor a co-author gets — ADR-0028.
 *
 * The student's editor with everything that is the student's taken off: no Assist, no drafts,
 * no chat, no citations picker, no uploads, no exports. Those spend the owner's caps or read the
 * owner's library. What is left is the text, the formatting bar, tables, undo, and everyone's
 * cursors — enough to write a chapter together, and nothing that spends or reveals.
 *
 * There is no autosave here and no `content`: the document arrives over the socket and is stored
 * by the room. Until the first sync the page says so rather than showing an empty chapter that
 * looks like one somebody deleted.
 */

import { thesisExtensions } from '@tc/ui';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useMemo, useState } from 'react';
import { COLLAB_CLOSE, connectLive, createLiveDoc, type LiveDoc, othersIn } from '@/lib/collab';
import { FormatToolbar } from './FormatToolbar';

export function CoAuthorEditor({
  chapterId,
  chapterTitle,
  email,
}: {
  chapterId: string;
  chapterTitle: string;
  /** The co-author's own address, for the name on their cursor. */
  email: string;
}) {
  const [live] = useState<LiveDoc>(() => createLiveDoc(email));
  const [synced, setSynced] = useState(false);
  const [online, setOnline] = useState(true);
  const [others, setOthers] = useState<string[]>([]);
  const [closed, setClosed] = useState<number | null>(null);

  useEffect(() => {
    const provider = connectLive(chapterId, live);
    const onSync = (state: boolean) => setSynced(state);
    const onStatus = ({ status }: { status: string }) => setOnline(status === 'connected');
    const onClose = (event: { code: number } | null) => {
      if (event && event.code >= 4400 && event.code < 4500) setClosed(event.code);
    };
    const onAwareness = () => setOthers(othersIn(live));
    provider.on('sync', onSync);
    provider.on('status', onStatus);
    provider.on('connection-close', onClose);
    live.awareness.on('change', onAwareness);
    return () => {
      live.awareness.off('change', onAwareness);
      provider.destroy();
    };
  }, [chapterId, live]);

  const extensions = useMemo(
    () =>
      thesisExtensions({
        ghostText: {
          chapterId,
          // Assist is the student's: it spends their cap and reads their library.
          request: () => {
            throw new Error('Suggestions are only available to the thesis owner.');
          },
        },
        resizableTables: true,
        collaboration: {
          document: live.doc,
          provider: { awareness: live.awareness },
          user: live.user,
        },
      }),
    [chapterId, live],
  );

  const editor = useEditor({
    extensions,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'thesis-editor',
        spellcheck: 'true',
        'aria-label': `${chapterTitle} — live editor`,
      },
    },
  });

  return (
    <div data-testid="coauthor-editor">
      <p className="mb-2 text-xs text-muted" data-testid="live-status">
        {closed === COLLAB_CLOSE.changedElsewhere
          ? 'The chapter changed elsewhere. Reload to keep editing.'
          : closed !== null
            ? 'Live editing is not available for this chapter.'
            : !online
              ? 'Reconnecting…'
              : !synced
                ? 'Connecting…'
                : others.length === 0
                  ? 'Live · only you here'
                  : `Live with ${others.join(', ')}`}
      </p>
      {/* No image or chart: uploads belong to the owner's account. */}
      <FormatToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
