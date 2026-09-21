/**
 * Fetches the figures a document body references, ready for `chapterToDocx`/`thesisToDocx`.
 *
 * Without this the exporter's `images` option was never supplied by anyone, so every figure a
 * student inserted became the italic placeholder `[image]` in the file they submitted. The
 * exporter had the code to embed pictures; nothing had ever handed it any.
 *
 * Resolution is by the node's `key` — the stable object-storage path — never by `src`, which is a
 * signed URL that is re-minted every time the chapter is opened and therefore never matches
 * anything collected earlier.
 *
 * A figure that cannot be read is skipped rather than fatal. An export is the last step before a
 * submission deadline, and failing the whole document because one picture is missing is the wrong
 * trade: the exporter already prints a visible placeholder where it was.
 */

import type { Logger } from '@nestjs/common';
import { fitToColumn, imageSize } from '@tc/export';
import type { StorageService } from '../../common/storage.service.js';

/** What `ExportOptions.images` wants, keyed by object-storage key. */
export type FigureBytes = Record<
  string,
  { data: Uint8Array; width: number; height: number; type?: 'png' | 'jpg' | 'gif' }
>;

const TYPE_BY_EXTENSION: Record<string, 'png' | 'jpg' | 'gif'> = {
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpg',
  gif: 'gif',
};

/** Every `image` node's storage key, anywhere in a ProseMirror document. */
export function figureKeysIn(doc: unknown): string[] {
  const keys = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (n.type === 'image' && typeof n.attrs?.key === 'string' && n.attrs.key) {
      keys.add(n.attrs.key);
    }
    if (Array.isArray(n.content)) for (const child of n.content) walk(child);
  };
  walk(doc);
  return [...keys];
}

export async function loadFigures(
  storage: StorageService,
  doc: unknown,
  logger?: Logger,
): Promise<FigureBytes> {
  const keys = figureKeysIn(doc);
  if (keys.length === 0) return {};

  const images: FigureBytes = {};
  await Promise.all(
    keys.map(async (key) => {
      try {
        const data = await storage.get(key);
        const bytes = new Uint8Array(data);
        const natural = imageSize(bytes);
        if (!natural) {
          logger?.warn({ key }, 'figure has no readable dimensions; exporting as a placeholder');
          return;
        }
        const fitted = fitToColumn(natural);
        const extension = key.split('.').pop()?.toLowerCase() ?? '';
        images[key] = {
          data: bytes,
          width: fitted.width,
          height: fitted.height,
          type: TYPE_BY_EXTENSION[extension] ?? 'png',
        };
      } catch (error) {
        logger?.warn({ key, err: error }, 'figure could not be read; exporting as a placeholder');
      }
    }),
  );
  return images;
}
