/**
 * The QA report as a document — spec §11 "QA_Report.pdf". One self-contained HTML page, which the
 * controller either serves as is or sends through Gotenberg's Chromium route for a PDF. The same
 * facts as the screen: coverage matrix, every check with its result, open issues with their
 * places, the sources still needed, the reference table, the similarity summary, the disclosure.
 */

import { CHECKS, type CheckId, isCheckId } from '@tc/config';
import { escapeHtml } from '@tc/export';
import type { ChapterBuildPlan, ChapterBuildReport } from '@tc/types';

export type QaReportInput = {
  thesisTitle: string;
  chapterTitle: string;
  studentName: string;
  disciplineName: string;
  paradigm: string;
  universityName: string;
  builtAt: string;
  plan: ChapterBuildPlan | null;
  report: ChapterBuildReport;
};

const e = escapeHtml;

const STATUS_WORD: Record<string, string> = {
  pass: 'Pass',
  fail: 'Fail',
  warn: 'Warning',
  skipped: 'Not applicable',
};

export function qaReportHtml(input: QaReportInput): string {
  const { report, plan } = input;
  const sectionTitle = (id: string) =>
    report.sections.find((s) => s.id === id)?.title ?? (id === 'chapter' ? 'Whole chapter' : id);
  const layer = (id: string) => (isCheckId(id) ? CHECKS[id as CheckId].layer : 'other');
  const open = report.issues.filter((i) => i.status === 'open');
  const dismissed = report.issues.filter((i) => i.status === 'accepted_by_user');

  const checksRows = report.checks
    .filter((c) => c.status !== 'skipped')
    .map(
      (c) => `<tr class="${c.status}">
        <td><code>${e(c.checkId)}</code></td>
        <td>${e(c.label)}<br><small>${e(layer(c.checkId))}${c.note ? ` · ${e(c.note)}` : ''}</small></td>
        <td>${e(STATUS_WORD[c.status] ?? c.status)}</td>
        <td>${c.open}</td>
        <td>${c.corrected !== undefined ? `${c.corrected} corrected` : c.fixed}</td>
      </tr>`,
    )
    .join('\n');

  const coverageRows = (plan?.entities ?? [])
    .map((entity) => {
      const where = plan?.coverage[entity.id] ?? [];
      const uncovered = plan?.uncovered.includes(entity.text) ?? false;
      return `<tr class="${uncovered ? 'fail' : 'pass'}">
        <td>${e(entity.text)}</td>
        <td>${e(entity.type.toLowerCase().replace(/_/g, ' '))}</td>
        <td>${entity.sourceObjective || '—'}</td>
        <td>${uncovered ? 'Not introduced before the objectives' : where.length > 0 ? e(where.map(sectionTitle).join(', ')) : '—'}</td>
      </tr>`;
    })
    .join('\n');

  const issueItems = (list: typeof report.issues) =>
    list
      .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'blocking' ? -1 : 1))
      .map(
        (i) => `<li class="${i.severity}">
        <p class="meta"><strong>${e(i.severity)}</strong> · <code>${e(i.checkId)}</code> · ${e(sectionTitle(i.sectionId))} · ${i.by === 'examiner' ? 'examiner review' : 'check'}${i.pitfallCode ? ` · pitfall ${e(i.pitfallCode)}` : ''}</p>
        ${i.sentence ? `<blockquote>${e(i.sentence)}</blockquote>` : ''}
        <p>${e(i.explanation)}</p>
        ${i.suggestedFix ? `<p class="fix">Suggested: ${e(i.suggestedFix)}</p>` : ''}
        ${i.userNote !== undefined ? `<p class="fix">Student's note: ${e(i.userNote || '(none)')}</p>` : ''}
      </li>`,
      )
      .join('\n');

  const referenceRows = report.references
    .map(
      (r) => `<tr class="${r.status === 'RESOLVED' ? 'pass' : 'fail'}">
        <td>${e(r.shortRef)}${r.title ? `<br><small>${e(r.title)}</small>` : ''}${r.doi ? `<br><small>doi:${e(r.doi)}</small>` : ''}</td>
        <td>${r.status === 'RESOLVED' ? '✓ resolved' : `✗ ${e(r.status.toLowerCase())}`}</td>
        <td>${r.grounding === 'FULL_TEXT' ? 'full text' : r.grounding === 'ABSTRACT' ? 'abstract only' : 'no text'}</td>
        <td>${r.uses}</td>
      </tr>`,
    )
    .join('\n');

  const sectionRows = report.sections
    .map(
      (s) => `<tr>
        <td>${e(s.title)}</td>
        <td>${e(s.status.replace(/_/g, ' '))}</td>
        <td>${s.words}</td>
        <td>${s.citations}</td>
        <td>${s.needsSource.length > 0 ? `<ul>${s.needsSource.map((n) => `<li>${e(n)}</li>`).join('')}</ul>` : ''}${s.note ? `<small>${e(s.note)}</small>` : ''}</td>
      </tr>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>QA report — ${e(input.chapterTitle)}</title>
<style>
  body { font: 11pt/1.45 Georgia, "Times New Roman", serif; color: #111; margin: 28mm 22mm; }
  h1 { font-size: 20pt; margin: 0 0 4pt; }
  h2 { font-size: 13pt; margin: 22pt 0 8pt; border-bottom: 1px solid #999; padding-bottom: 3pt; }
  .lede { color: #444; margin: 0 0 14pt; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th, td { text-align: left; vertical-align: top; padding: 4pt 6pt; border-bottom: 1px solid #ddd; }
  th { font-weight: 600; color: #444; }
  tr.fail td:nth-child(3), li.blocking .meta strong { color: #a11; }
  tr.warn td:nth-child(3), li.warning .meta strong { color: #8a5a00; }
  tr.pass td:nth-child(3) { color: #1a6b2a; }
  code { font: 9pt ui-monospace, Consolas, monospace; }
  small { color: #555; }
  ul.issues { list-style: none; padding: 0; }
  ul.issues li { border: 1px solid #ddd; border-radius: 4px; padding: 8pt 10pt; margin: 0 0 8pt; }
  .meta { margin: 0 0 4pt; font-size: 9.5pt; color: #444; }
  blockquote { margin: 4pt 0; padding-left: 8pt; border-left: 3px solid #ccc; font-style: italic; }
  .fix { margin: 4pt 0 0; color: #333; }
  dl.totals { display: grid; grid-template-columns: max-content 1fr; gap: 2pt 14pt; }
  dl.totals dt { color: #555; }
  .note { background: #f6f3ea; border: 1px solid #e3dcc6; padding: 8pt 10pt; border-radius: 4px; }
  @page { size: A4; margin: 0; }
</style>
</head>
<body>
<h1>QA report</h1>
<p class="lede">${e(input.thesisTitle)} · ${e(input.chapterTitle)}${input.studentName ? ` · ${e(input.studentName)}` : ''}<br>
${e(input.disciplineName)} · ${e(input.paradigm)} · ${e(input.universityName)} · built ${e(input.builtAt)}</p>

<dl class="totals">
  <dt>Words written</dt><dd>${report.totals.words}</dd>
  <dt>Citations</dt><dd>${report.totals.citations}</dd>
  <dt>Fixed by the build</dt><dd>${report.totals.fixed}</dd>
  <dt>Open blocking issues</dt><dd>${report.totals.blockingOpen}</dd>
  <dt>Open warnings</dt><dd>${report.totals.warningsOpen}</dd>
  <dt>Similarity</dt><dd>${report.similarity.copiedRuns} run(s) of twelve or more words copied from a source, over ${report.similarity.checkedWords} words checked</dd>
</dl>
${report.sensitiveNote ? `<p class="note">${e(report.sensitiveNote)}</p>` : ''}
${report.universityUnconfirmed ? `<p class="note">The university profile's citation and spelling rules are common defaults that have not been confirmed against the university's thesis manual.</p>` : ''}

<h2>1. Coverage matrix — key terms and where they are introduced</h2>
${coverageRows ? `<table><thead><tr><th>Key term</th><th>Type</th><th>From objective</th><th>Introduced in</th></tr></thead><tbody>${coverageRows}</tbody></table>` : '<p>No key terms were found in the objectives.</p>'}

<h2>2. Every check, with its result</h2>
<table><thead><tr><th>Id</th><th>Check</th><th>Result</th><th>Open</th><th>Fixed / corrected</th></tr></thead><tbody>${checksRows}</tbody></table>

<h2>3. Open issues (${open.length})</h2>
${open.length > 0 ? `<ul class="issues">${issueItems(open)}</ul>` : '<p>None. Every check passed or was fixed by the build.</p>'}
${dismissed.length > 0 ? `<h2>3a. Issues the student judged not to apply (${dismissed.length})</h2><ul class="issues">${issueItems(dismissed)}</ul>` : ''}

<h2>4. Sources still needed</h2>
${report.evidenceNeeded.length > 0 ? `<ul>${report.evidenceNeeded.map((n) => `<li><strong>${e(sectionTitle(n.sectionId))}:</strong> ${e(n.note)}</li>`).join('')}</ul>` : '<p>None: every section had sources for what it says.</p>'}

<h2>5. Reference verification</h2>
${referenceRows ? `<table><thead><tr><th>Source</th><th>Record</th><th>Read from</th><th>Used</th></tr></thead><tbody>${referenceRows}</tbody></table>` : '<p>No sources were cited.</p>'}

<h2>6. Sections</h2>
<table><thead><tr><th>Section</th><th>Status</th><th>Words</th><th>Citations</th><th>Needs a source</th></tr></thead><tbody>${sectionRows}</tbody></table>

<h2>7. AI-assistance statement</h2>
<p>${e(report.disclosure)}</p>
<p><small>Every section of this chapter was delivered as a draft for the student to accept or discard; nothing entered the thesis without the student's action. Generated by Thesis Copilot.</small></p>
</body>
</html>`;
}
