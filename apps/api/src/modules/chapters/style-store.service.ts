/**
 * The XML behind a chosen citation style — fetched once, kept for good.
 *
 * `@tc/citations` ships twenty styles and an index of all 10,863 in the Citation Style Language
 * repository. When a student picks one of the others, this fetches its XML from the repository
 * **at the commit the index was built from** (never a moving branch, so the style a thesis was
 * written in cannot change underneath it), checks that it is CSL, and keeps a copy in our own
 * object storage.
 *
 * That order is the design: the network is needed at the moment of choosing — where a failure is
 * visible, harmless, and answered with "try again" — and never again. A render, a chapter export
 * and the whole-thesis export all read our copy, so a GitHub outage on the night before a deadline
 * costs nothing.
 *
 * Most journals need no fetch at all. A journal's style is usually a one-line "dependent" pointing
 * at a common parent — Elsevier Harvard, APA, Vancouver — and those parents ship with the package.
 */

import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  catalogSource,
  findStyle,
  needsStyleXml,
  registerStyleXml,
  STYLES_DIR,
} from '@tc/citations';
import { AppError, ValidationError } from '../../common/errors.js';
import { StorageService } from '../../common/storage.service.js';

/** The repository the catalogue indexes; the commit comes from the catalogue itself. */
const RAW_BASE = 'https://raw.githubusercontent.com/citation-style-language/styles';

/** A CSL style is tens of kilobytes. Anything this size is not one. */
const MAX_STYLE_BYTES = 1_000_000;

export class StyleUnavailableError extends AppError {
  constructor(label: string) {
    super(
      'STYLE_UNAVAILABLE',
      'That citation style could not be loaded',
      HttpStatus.SERVICE_UNAVAILABLE,
      `“${label}” could not be downloaded just now. Your thesis is still using its current style; try again in a minute.`,
    );
  }
}

/** Enough of a check that a bad download is refused rather than handed to citeproc. */
export function looksLikeCsl(xml: string): boolean {
  return (
    xml.length > 0 &&
    xml.length < MAX_STYLE_BYTES &&
    /<style[\s>]/.test(xml) &&
    xml.includes('http://purl.org/net/xbiblio/csl') &&
    /<citation[\s>]/.test(xml)
  );
}

@Injectable()
export class StyleStoreService {
  private readonly logger = new Logger(StyleStoreService.name);
  /** One fetch per style at a time, however many renders ask for it at once. */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(private readonly storage: StorageService) {}

  /**
   * Makes a style renderable in this process: nothing to do for a shipped style or one already
   * loaded; otherwise our stored copy; otherwise the pinned commit, which is then stored.
   *
   * Throws `ValidationError` for an id that is not a selectable style, and `StyleUnavailableError`
   * when the XML cannot be had — never a silent fall back to another style, because a thesis
   * exported in the wrong style is worse than an export that asks to be retried.
   */
  async ensure(styleId: string): Promise<void> {
    const entry = findStyle(styleId);
    if (!entry) throw new ValidationError(`Unknown citation style: ${styleId}`);
    if (!needsStyleXml(entry)) return;
    const xmlId = entry.xmlId ?? entry.id;

    const pending = this.inFlight.get(xmlId);
    if (pending) return pending;
    const load = this.load(xmlId, entry.label).finally(() => this.inFlight.delete(xmlId));
    this.inFlight.set(xmlId, load);
    return load;
  }

  private async load(xmlId: string, label: string): Promise<void> {
    // The id comes from our own catalogue, but it still ends up in a URL and a storage key.
    if (!/^[a-z0-9-]+$/.test(xmlId)) throw new ValidationError(`Unknown citation style: ${xmlId}`);
    const { commit } = catalogSource(STYLES_DIR);
    const key = `csl-styles/${commit}/${xmlId}.csl`;

    const stored = await this.storage.get(key).then(
      (bytes) => bytes.toString('utf8'),
      () => null,
    );
    if (stored && looksLikeCsl(stored)) {
      registerStyleXml(xmlId, stored);
      return;
    }

    let xml: string;
    try {
      const response = await fetch(`${RAW_BASE}/${commit}/${xmlId}.csl`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      xml = await response.text();
    } catch (error) {
      this.logger.warn({ xmlId, err: String(error) }, 'citation style fetch failed');
      throw new StyleUnavailableError(label);
    }
    if (!looksLikeCsl(xml)) {
      this.logger.warn({ xmlId, bytes: xml.length }, 'fetched citation style is not CSL');
      throw new StyleUnavailableError(label);
    }

    await this.storage.put(key, Buffer.from(xml, 'utf8'), { 'Content-Type': 'application/xml' });
    registerStyleXml(xmlId, xml);
    this.logger.log({ xmlId, commit }, 'citation style fetched and stored');
  }
}
