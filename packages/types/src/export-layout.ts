/**
 * The page an export is laid out on (Jenni build plan R27, ADR-0121): a preset, and the advanced
 * options a student can change on top of it. One module for the API, which builds the file from
 * it, and the export dialog, which draws the preview from it — so the preview and the file are
 * the same numbers.
 *
 *   - `thesis`     — the institution template exactly: its paper, margins, font, spacing and front
 *                    matter. The only preset the PAGE_SETUP check passes on.
 *   - `default`    — a plain document: the template's paper, 1-inch margins, 11 pt in the
 *                    student's font style, 1.15 lines, no title page.
 *   - `double`     — a double-spaced manuscript: 12 pt Times New Roman, double spaced, 1-inch.
 *   - `two-column` — a paper: 10 pt Times New Roman, two columns, narrow margins.
 */

import { z } from 'zod';
import { FONT_STYLE_DOCX, type FontStyle } from './font-style.js';
import type { FrontMatterSection, TemplateSpec } from './template.js';

export const LAYOUT_PRESETS = ['thesis', 'default', 'double', 'two-column'] as const;
export type LayoutPreset = (typeof LAYOUT_PRESETS)[number];

/** Fonts every copy of Word has, and LibreOffice (Gotenberg) draws with a metric-twin. */
export const LAYOUT_FONTS = ['Times New Roman', 'Arial', 'Calibri'] as const;
export const LAYOUT_SIZES = [10, 11, 12] as const;
export const LAYOUT_SPACINGS = [1, 1.15, 1.5, 2] as const;
export const LAYOUT_MARGINS = ['narrow', 'moderate', 'wide'] as const;
export type LayoutMargins = (typeof LAYOUT_MARGINS)[number];

/** Every margin, in millimetres: 0.75, 1 and 1.5 inches. */
export const MARGIN_MM: Readonly<Record<LayoutMargins, number>> = {
  narrow: 19.05,
  moderate: 25.4,
  wide: 38.1,
};

/** What the student chose. Every option left out is the preset's. */
export const exportLayoutSchema = z.object({
  preset: z.enum(LAYOUT_PRESETS),
  paper: z.enum(['A4', 'Letter']).optional(),
  font: z.enum(LAYOUT_FONTS).optional(),
  sizePt: z
    .number()
    .refine((n) => (LAYOUT_SIZES as readonly number[]).includes(n), 'Use 10, 11 or 12')
    .optional(),
  lineSpacing: z
    .number()
    .refine((n) => (LAYOUT_SPACINGS as readonly number[]).includes(n), 'Use 1, 1.15, 1.5 or 2')
    .optional(),
  margins: z.enum(LAYOUT_MARGINS).optional(),
  titlePage: z.boolean().optional(),
  contents: z.boolean().optional(),
  pageNumbers: z.boolean().optional(),
  comments: z.boolean().optional(),
});
export type ExportLayout = z.infer<typeof exportLayoutSchema>;

/** Every number the file is built with. */
export type ResolvedLayout = {
  preset: LayoutPreset;
  paper: 'A4' | 'Letter';
  marginsMm: { top: number; bottom: number; left: number; right: number };
  font: string;
  sizePt: number;
  lineSpacing: number;
  paragraphSpacingPt: number;
  justify: boolean;
  columns: 1 | 2;
  titlePage: boolean;
  contents: boolean;
  /** A chapter holds a contents block, so the contents page cannot be turned off. */
  contentsForced: boolean;
  pageNumbers: boolean;
  comments: boolean;
  /** The template's own setup: what the PAGE_SETUP compliance check asks for. */
  matchesTemplate: boolean;
};

const all = (mm: number) => ({ top: mm, bottom: mm, left: mm, right: mm });

/**
 * The preset and the student's changes, as numbers. `fontStyle` is the account's (ADR-0120): the
 * plain preset is written in it. `contentsBlock`: a chapter has a "/" Table of contents.
 */
export function resolveLayout(
  spec: TemplateSpec,
  layout: ExportLayout,
  context: { fontStyle?: FontStyle; contentsBlock?: boolean } = {},
): ResolvedLayout {
  const has = (id: FrontMatterSection['id']) => spec.frontMatter.some((s) => s.id === id);
  const base: Omit<ResolvedLayout, 'contentsForced' | 'matchesTemplate' | 'preset'> = (() => {
    switch (layout.preset) {
      case 'default':
        return {
          paper: spec.page.size,
          marginsMm: all(MARGIN_MM.moderate),
          font: FONT_STYLE_DOCX[context.fontStyle ?? 'default'] ?? 'Calibri',
          sizePt: 11,
          lineSpacing: 1.15,
          paragraphSpacingPt: 8,
          justify: false,
          columns: 1,
          titlePage: false,
          contents: false,
          pageNumbers: true,
          comments: false,
        };
      case 'double':
        return {
          paper: spec.page.size,
          marginsMm: all(MARGIN_MM.moderate),
          font: 'Times New Roman',
          sizePt: 12,
          lineSpacing: 2,
          paragraphSpacingPt: 0,
          justify: false,
          columns: 1,
          titlePage: false,
          contents: false,
          pageNumbers: true,
          comments: false,
        };
      case 'two-column':
        return {
          paper: spec.page.size,
          marginsMm: all(MARGIN_MM.narrow),
          font: 'Times New Roman',
          sizePt: 10,
          lineSpacing: 1,
          paragraphSpacingPt: 4,
          justify: true,
          columns: 2,
          titlePage: false,
          contents: false,
          pageNumbers: true,
          comments: false,
        };
      default:
        return {
          paper: spec.page.size,
          marginsMm: { ...spec.page.marginsMm },
          font: spec.font.body,
          sizePt: spec.font.sizePt,
          lineSpacing: spec.font.lineSpacing,
          paragraphSpacingPt: spec.font.paragraphSpacingPt,
          justify: spec.font.justify,
          columns: 1,
          titlePage: has('TITLE_PAGE'),
          contents: has('TOC'),
          pageNumbers: true,
          comments: false,
        };
    }
  })();
  const contentsForced = Boolean(context.contentsBlock);
  const resolved = {
    ...base,
    preset: layout.preset,
    ...(layout.paper ? { paper: layout.paper } : {}),
    ...(layout.font ? { font: layout.font } : {}),
    ...(layout.sizePt ? { sizePt: layout.sizePt } : {}),
    ...(layout.lineSpacing ? { lineSpacing: layout.lineSpacing } : {}),
    ...(layout.margins ? { marginsMm: all(MARGIN_MM[layout.margins]) } : {}),
    ...(layout.titlePage !== undefined ? { titlePage: layout.titlePage } : {}),
    ...(layout.contents !== undefined ? { contents: layout.contents } : {}),
    ...(layout.pageNumbers !== undefined ? { pageNumbers: layout.pageNumbers } : {}),
    ...(layout.comments !== undefined ? { comments: layout.comments } : {}),
  };
  if (contentsForced) resolved.contents = true;
  const m = resolved.marginsMm;
  const t = spec.page.marginsMm;
  const close = (a: number, b: number) => Math.abs(a - b) <= 0.6;
  const matchesTemplate =
    resolved.paper === spec.page.size &&
    close(m.top, t.top) &&
    close(m.bottom, t.bottom) &&
    close(m.left, t.left) &&
    close(m.right, t.right) &&
    resolved.font.toLowerCase() === spec.font.body.toLowerCase() &&
    resolved.sizePt === spec.font.sizePt &&
    Math.abs(resolved.lineSpacing - spec.font.lineSpacing) < 0.05 &&
    resolved.columns === 1;
  return { ...resolved, contentsForced, matchesTemplate };
}

/**
 * The template with the layout applied: the spec every exporter reads. The thesis preset keeps
 * the template's front matter (less a title page or contents turned off); the others keep only
 * the abstract, plus the title page and contents when they are on — a manuscript or a paper has
 * no certificate. The contents page goes where `frontMatterOf` would put it.
 */
export function applyLayout(spec: TemplateSpec, layout: ResolvedLayout): TemplateSpec {
  const keep =
    layout.preset === 'thesis'
      ? spec.frontMatter
      : spec.frontMatter.filter((s) => ['TITLE_PAGE', 'ABSTRACT', 'TOC'].includes(s.id));
  let frontMatter = keep.filter(
    (s) => (s.id !== 'TITLE_PAGE' || layout.titlePage) && (s.id !== 'TOC' || layout.contents),
  );
  const section = (id: FrontMatterSection['id']): FrontMatterSection => ({
    id,
    required: false,
    fields: [],
  });
  if (layout.titlePage && !frontMatter.some((s) => s.id === 'TITLE_PAGE')) {
    frontMatter = [section('TITLE_PAGE'), ...frontMatter];
  }
  if (layout.contents && !frontMatter.some((s) => s.id === 'TOC')) {
    const at = frontMatter.findIndex((s) =>
      ['LIST_OF_FIGURES', 'LIST_OF_TABLES', 'ABBREVIATIONS'].includes(s.id),
    );
    frontMatter =
      at < 0
        ? [...frontMatter, section('TOC')]
        : [...frontMatter.slice(0, at), section('TOC'), ...frontMatter.slice(at)];
  }
  return {
    ...spec,
    page: { size: layout.paper, marginsMm: { ...layout.marginsMm } },
    font: {
      ...spec.font,
      body: layout.font,
      sizePt: layout.sizePt,
      lineSpacing: layout.lineSpacing,
      paragraphSpacingPt: layout.paragraphSpacingPt,
      justify: layout.justify,
    },
    frontMatter,
  };
}
