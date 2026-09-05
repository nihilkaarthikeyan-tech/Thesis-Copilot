/**
 * A minimal PDF writer, for tests only.
 *
 * The extractor's job is to put text items back into reading order, so the test has to control
 * exactly where each string sits on the page. The five real fixture papers are the human's to
 * supply (PRD Appendix C.1) and are for measuring accuracy; this is for proving the mechanics —
 * page separation and two-column reordering — which needs precise coordinates, not real prose.
 *
 * Written by hand rather than pulling in a PDF library: it is ~70 lines, adds no dependency
 * outside PRD §7.2, and nothing but the test depends on it.
 */

export type PlacedText = { text: string; x: number; y: number; size?: number };
export type FixturePage = { items: PlacedText[]; width?: number; height?: number };

const escapePdfString = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function contentStream(items: readonly PlacedText[]): string {
  const parts = ['BT'];
  for (const item of items) {
    parts.push(`/F1 ${item.size ?? 11} Tf`);
    // Tm sets the text matrix absolutely, so each string lands exactly where the test asks.
    parts.push(`1 0 0 1 ${item.x} ${item.y} Tm`);
    parts.push(`(${escapePdfString(item.text)}) Tj`);
  }
  parts.push('ET');
  return parts.join('\n');
}

/** Builds an uncompressed PDF with one content stream per page. */
export function buildPdf(pages: readonly FixturePage[]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length; // object numbers are 1-based
  };

  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  // Reserve the ids the page tree needs before the pages reference it.
  const pagesId = objects.length + 1 + pages.length * 2 + 1;
  const pageIds: number[] = [];

  for (const page of pages) {
    const stream = contentStream(page.items);
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${page.width ?? 612} ${page.height ?? 792}] ` +
          `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
  }

  const realPagesId = add(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  const catalogId = add(`<< /Type /Catalog /Pages ${realPagesId} 0 R >>`);

  // Page objects were written pointing at `pagesId`; make that the real one.
  for (let i = 0; i < objects.length; i++) {
    objects[i] = (objects[i] ?? '').replace(`/Parent ${pagesId} 0 R`, `/Parent ${realPagesId} 0 R`);
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

/** A page of body text laid out in two columns, as a journal paper would be. */
export function twoColumnPage(left: readonly string[], right: readonly string[]): FixturePage {
  const items: PlacedText[] = [];
  left.forEach((text, i) => {
    items.push({ text, x: 60, y: 700 - i * 16 });
  });
  right.forEach((text, i) => {
    items.push({ text, x: 330, y: 700 - i * 16 });
  });
  return { items };
}

/** A single-column page. */
export function singleColumnPage(lines: readonly string[]): FixturePage {
  return { items: lines.map((text, i) => ({ text, x: 72, y: 700 - i * 16 })) };
}
