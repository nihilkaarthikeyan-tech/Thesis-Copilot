/**
 * Figures in a chapter, as the server hands them to a browser or an exporter.
 *
 * ## Fresh links on every read
 *
 * A figure's `src` is a presigned URL that lasts fifteen minutes (`SIGNED_URL_TTL_SECONDS`), and
 * it is saved into the chapter along with everything else. Until 2026-09-24 nothing minted a new
 * one: `GET /chapters/:id/figures/link` existed for exactly this and nothing called it, so every
 * figure showed as a broken image once its chapter was reopened a quarter of an hour after the
 * upload. A link stored on 09-21 answered 403 on 09-24. Every read that reaches a browser now
 * re-signs, and signing is an HMAC over the key, so doing it per read costs nothing to speak of.
 *
 * ## Only this document's own figures
 *
 * The key is part of content the client wrote. Signing — or, for an export, reading — whatever key
 * a chapter names would let anyone who learned another thesis's key put it in their own chapter
 * and get the picture back. So both paths accept only keys under the document's own prefix, the
 * rule `FiguresService.link` has always applied to the one key it is asked about.
 */

type JsonNode = { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };

/** The prefix every figure a document owns is stored under (`figureKey`). */
export function figurePrefix(documentId: string): string {
  return `figures/${documentId}/`;
}

export function ownsFigureKey(documentId: string, key: unknown): key is string {
  return typeof key === 'string' && key.startsWith(figurePrefix(documentId)) && !key.includes('..');
}

/** Every `image` node in a ProseMirror document, at any depth. */
export function imageNodesIn(doc: unknown): JsonNode[] {
  const out: JsonNode[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as JsonNode;
    if (n.type === 'image') out.push(n);
    if (Array.isArray(n.content)) for (const child of n.content) walk(child);
  };
  walk(doc);
  return out;
}

/**
 * The chapter with a fresh `src` on every figure this document owns. The content is a value read
 * for this response, so it is updated in place; a figure naming someone else's key keeps whatever
 * `src` it had, which is a dead link, and is not signed.
 */
export async function withFreshFigureLinks<T>(
  content: T,
  documentId: string,
  sign: (key: string) => Promise<string>,
): Promise<T> {
  const figures = imageNodesIn(content).filter((node) =>
    ownsFigureKey(documentId, node.attrs?.key),
  );
  await Promise.all(
    figures.map(async (node) => {
      const attrs = node.attrs as Record<string, unknown>;
      attrs.src = await sign(attrs.key as string);
    }),
  );
  return content;
}
