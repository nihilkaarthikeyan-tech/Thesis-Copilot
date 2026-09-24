# ADR-0027 — Charts, drawn from the student's own numbers

**Date:** 2026-09-24
**Status:** Accepted
**Adds:** a chart figure the PRD does not have. No metered action, no prompt, no model.

## What prompted it

The competitor gap list (2026-09-24): "charts". A results chapter is mostly figures, and a
student who cannot draw one here draws it in a spreadsheet, screenshots it, and inserts the
screenshot — at screen resolution, with the spreadsheet's default colours, and with no way to
change a number without doing it all again.

## The line this has to hold

The rest of the product is built around the rule that nothing enters the thesis that the student
did not put there, and a chart is where a "helpful" tool would start inventing: filling a gap,
smoothing a series, rounding an axis so the trend looks cleaner. So:

- **No model anywhere.** The chart is a deterministic drawing of the numbers typed, by our own
  canvas code (`packages/ui/src/charts/draw.ts`). The same spec draws the same picture.
- **Nothing is filled in.** An empty cell is a gap in the line, not a zero. A cell that is not a
  number stops the dialog and says which one.
- **The axis tells the truth.** Bars start at zero, and a line chart of positive numbers starts at
  zero too — an axis that starts at 40 makes a 5% change look like a collapse.

## The decision

- **Two kinds**, bar and line. They cover counts by group and a value over time, which is what a
  thesis shows; a pie chart is the figure examiners ask students to replace.
- **A chart is a figure.** Insert draws it at 1600 × 1000, uploads the PNG through the same path
  as a picture (`POST /chapters/:id/figures`, ADR-0024's link renewal, the ownership rule), and
  inserts an `image` node. Every export — `.docx`, PDF, LaTeX, HTML — and the compliance check
  treat it as the figure it is, unchanged. The title becomes the caption.
- **The numbers stay on the figure.** The spec (`chartSpecSchema`, `@tc/types`) is stored in the
  node's `chart` attribute. Selecting the chart turns the toolbar's *Chart* into *Edit chart*;
  the dialog opens on the numbers, and *Update chart* redraws, re-uploads and replaces the
  attributes in place.
- **From a table.** With the cursor in a table, the dialog opens with the table's numbers: first
  row the series, first column the categories, cells read as a student types them ("1,250",
  "12.5%", "(42)", "—" for nothing).
- **Prints in black and white.** The palette is eight colours of distinct lightness.
- **Hand-drawn rather than a charting library.** A library brings animation, tooltips and a
  theme, and a dependency to audit (B4.3); a thesis figure needs axes, nice ticks, bars or lines,
  a legend and the words. It is about 200 lines.

## Consequences

- No new metered action and no cap: nothing is charged for a chart.
- The drawing is proven in a browser (`apps/web/e2e/charts.spec.ts`: insert, edit, from a table,
  captioned in the export); the arithmetic under it — ticks, number parsing, table reading — has
  unit tests (`packages/ui/test/charts.spec.ts`, `packages/types/test/chart.spec.ts`).
- The LaTeX export carries the PNG, not a `pgfplots` source. The numbers are in the chapter and
  could be exported as data later; nobody has asked.
- Limits: 8 series, 100 categories, labels of 120 characters. Past them the legend and the axis
  stop being readable.
