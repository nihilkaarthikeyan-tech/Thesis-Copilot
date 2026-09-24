-- Titles and journal names as a reader sees them (found 2026-09-24).
--
-- Crossref and OpenAlex send some titles HTML-escaped ("Energy &amp; Fuels") or with inline
-- markup ("CO<sub>2</sub> capture"), and the resolver stored them as they came, so the library
-- showed "&amp;" and raw tags. The resolver now stores plain text; this brings the rows already
-- stored into line. Tags are removed first and "&amp;" decoded last, so "&amp;lt;" becomes the
-- text "&lt;" rather than "<". The CSL record in "cslJson" is left alone: citeproc formats its
-- markup, and the renderer now decodes its entities.

UPDATE "Source"
SET "title" = btrim(regexp_replace(
  replace(replace(replace(replace(replace(
    regexp_replace("title", '<[^>]+>', '', 'g'),
    '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&amp;', '&'),
  '\s+', ' ', 'g'))
WHERE "title" ~ '&(amp|lt|gt|quot|#39);|<[^>]+>';

UPDATE "Source"
SET "venue" = btrim(regexp_replace(
  replace(replace(replace(replace(replace(
    regexp_replace("venue", '<[^>]+>', '', 'g'),
    '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&amp;', '&'),
  '\s+', ' ', 'g'))
WHERE "venue" ~ '&(amp|lt|gt|quot|#39);|<[^>]+>';
