/**
 * `.docx` comment import — PRD FR-7.3, PHASES v2 B4.2.
 *
 *   "Parse `word/comments.xml` + anchors → `Comment` rows via re-anchoring."
 *
 * A guide who will not use the web app marks up a Word file instead. That file already carries
 * everything the review queue needs: who wrote each comment, when, what they said, and — this is
 * the part worth the parsing — exactly which run of text they were pointing at.
 *
 * ## How a Word comment is anchored
 *
 * `word/comments.xml` holds the comment bodies, each with a numeric `w:id`. `word/document.xml`
 * marks the anchored range inline with `<w:commentRangeStart w:id="3"/> … <w:commentRangeEnd
 * w:id="3"/>`. The quoted text is every `<w:t>` between the two, in document order. A comment with
 * no range — Word allows one on a collapsed cursor — quotes nothing and lands at chapter level.
 *
 * ## Why the XML is read by hand
 *
 * Only two things are needed (the comment bodies, and the text between two marker tags), the tags
 * are unambiguous, and every alternative is a parser dependency carried for one file. The reader
 * below is deliberately narrow: it does not try to understand Word, only to find two tag pairs.
 *
 * What it does **not** do: tracked changes. FR-7.3 names them alongside comments, and they are a
 * different problem — a revision to apply rather than a remark to answer — so importing them as
 * comments would put edits into the review queue dressed as questions. `trackedChanges` reports
 * how many were found so the caller can say the file had them and they were left alone.
 */

import JSZip from 'jszip';

export type DocxComment = {
  /** Word's own `w:id`, kept so a re-import can recognise the same comment. */
  wordId: string;
  author: string;
  /** Word stores initials separately; useful when the author name is missing. */
  initials: string | null;
  /** ISO 8601 as Word wrote it, or null when the file has no date. */
  date: string | null;
  body: string;
  /** The text the comment was attached to, or null for a comment with no range. */
  quotedText: string | null;
};

export type DocxCommentImport = {
  comments: DocxComment[];
  /** Insertions and deletions found in `document.xml`. Counted, never imported. */
  trackedChanges: number;
};

/** `<w:t>…</w:t>` runs, in order, with XML entities resolved. */
function textRuns(xml: string): string {
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let match = re.exec(xml);
  while (match) {
    out += decode(match[1] ?? '');
    match = re.exec(xml);
  }
  return out;
}

function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return match?.[1] ? decode(match[1]) : null;
}

/**
 * Paragraphs inside a comment become newlines rather than running together, because a guide who
 * wrote two paragraphs meant two, and the review queue shows the body verbatim.
 */
function commentBody(xml: string): string {
  return xml
    .split(/<w:p[\s>]/)
    .map((paragraph) => textRuns(paragraph).trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * The text between `<w:commentRangeStart w:id="N"/>` and its matching end tag.
 *
 * Ranges may nest and overlap — two guides can comment on overlapping sentences — so each id is
 * sliced independently rather than by walking a single cursor through the document.
 */
function quotedRanges(documentXml: string): Map<string, string> {
  const out = new Map<string, string>();
  const startRe = /<w:commentRangeStart\s[^>]*w:id="(\d+)"[^>]*\/>/g;
  let start = startRe.exec(documentXml);
  while (start) {
    const id = start[1] ?? '';
    const endRe = new RegExp(`<w:commentRangeEnd\\s[^>]*w:id="${id}"[^>]*/>`);
    const rest = documentXml.slice(start.index + start[0].length);
    const end = endRe.exec(rest);
    if (end) {
      const quoted = textRuns(rest.slice(0, end.index)).replace(/\s+/g, ' ').trim();
      if (quoted) out.set(id, quoted);
    }
    start = startRe.exec(documentXml);
  }
  return out;
}

/** `<w:ins>` and `<w:del>` — tracked changes, counted so the caller can say they were skipped. */
function countTrackedChanges(documentXml: string): number {
  return (documentXml.match(/<w:(?:ins|del)\s/g) ?? []).length;
}

/**
 * Reads the comments out of a `.docx`.
 *
 * Returns an empty list — not an error — for a file with no comments: "this file has no comments"
 * is a fact the caller reports, and a thrown error would read as a broken upload.
 */
export async function readDocxComments(data: Uint8Array | Buffer): Promise<DocxCommentImport> {
  const zip = await JSZip.loadAsync(data);
  const commentsFile = zip.file('word/comments.xml');
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) {
    throw new Error('That file is not a Word document — word/document.xml is missing.');
  }
  const documentXml = await documentFile.async('string');
  const trackedChanges = countTrackedChanges(documentXml);
  if (!commentsFile) return { comments: [], trackedChanges };

  const commentsXml = await commentsFile.async('string');
  const quoted = quotedRanges(documentXml);

  const comments: DocxComment[] = [];
  const re = /<w:comment\s([^>]*)>([\s\S]*?)<\/w:comment>/g;
  let match = re.exec(commentsXml);
  while (match) {
    const attrs = match[1] ?? '';
    const wordId = attribute(attrs, 'w:id');
    const body = commentBody(match[2] ?? '');
    // A comment with no text is a Word artefact — an empty balloon someone opened and left. It
    // would arrive in the review queue as a row with nothing to answer.
    if (wordId && body) {
      comments.push({
        wordId,
        author: attribute(attrs, 'w:author') ?? 'Unknown',
        initials: attribute(attrs, 'w:initials'),
        date: attribute(attrs, 'w:date'),
        body,
        quotedText: quoted.get(wordId) ?? null,
      });
    }
    match = re.exec(commentsXml);
  }

  return { comments, trackedChanges };
}
