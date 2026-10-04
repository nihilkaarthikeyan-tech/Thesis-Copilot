/**
 * `GET /citation-styles` — finding one style among ten thousand.
 *
 * Not per document: the catalogue is the same for everyone, and the answer depends only on the
 * query. With no query it returns the twenty styles the product ships, which are the ones most
 * students want and the ones whose output is pinned by golden tests.
 */

import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  catalogSource,
  findStyle,
  previewStyle,
  STYLES,
  STYLES_DIR,
  type StylePreview,
  searchCatalog,
  selectableCount,
} from '@tc/citations';
import { NotFoundError } from '../../common/errors.js';
import { SessionGuard } from '../auth/session.guard.js';
import { StyleStoreService } from './style-store.service.js';

/**
 * Previews already rendered, by style id. A preview depends only on the style and the fixed
 * example reference, so it never changes within a process; bounded so a scripted walk through
 * the whole catalogue cannot grow it without limit.
 */
const PREVIEW_CACHE_MAX = 500;

export type StyleOption = {
  id: string;
  title: string;
  family: string;
  /** For a journal's style: the style it borrows, which is what decides how it prints. */
  parent?: string;
  /** False for footnote styles: listed so a search for one explains itself, not choosable. */
  selectable: boolean;
  /** One of the twenty shipped and tested with golden output. */
  common: boolean;
};

@Controller('citation-styles')
@UseGuards(SessionGuard)
export class CitationStylesController {
  private readonly previews = new Map<string, StylePreview>();

  constructor(private readonly styles: StyleStoreService) {}

  /**
   * `GET /citation-styles/:id/preview` — one in-text citation and one bibliography entry for a
   * fixed example reference, so a student sees a style before choosing it (2026-10-04, from the
   * Jenni study). Rendered by citeproc, no model call. A catalogue style's XML is made available
   * the same way choosing it would (`StyleStoreService.ensure`).
   */
  @Get(':id/preview')
  async preview(@Param('id') id: string): Promise<StylePreview> {
    const cached = this.previews.get(id);
    if (cached) return cached;
    if (id.length > 200 || !findStyle(id)) throw new NotFoundError('That citation style');
    await this.styles.ensure(id);
    const preview = previewStyle(id);
    if (this.previews.size >= PREVIEW_CACHE_MAX) this.previews.clear();
    this.previews.set(id, preview);
    return preview;
  }

  @Get()
  search(@Query('q') q?: string, @Query('limit') limit?: string) {
    const common = new Set(STYLES.map((s) => s.id));
    const query = (q ?? '').trim().slice(0, 120);
    const results: StyleOption[] = query
      ? searchCatalog(query, STYLES_DIR, Math.min(Math.max(Number(limit) || 30, 1), 60)).map(
          (style) => ({
            id: style.id,
            title: style.title,
            family: style.family,
            ...(style.parent ? { parent: style.parent } : {}),
            selectable: style.selectable,
            common: common.has(style.id),
          }),
        )
      : STYLES.map((style) => ({
          id: style.id,
          title: style.label,
          family: style.family,
          selectable: true,
          common: true,
        }));
    const source = catalogSource(STYLES_DIR);
    return {
      results,
      available: selectableCount(STYLES_DIR),
      // CC BY-SA 3.0 asks for credit; the picker shows this line.
      credit: {
        text: 'Citation styles from the Citation Style Language project',
        licence: source.licence,
        commit: source.commit,
      },
    };
  }
}
