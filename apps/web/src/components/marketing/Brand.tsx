import { Pilcrow } from 'lucide-react';
import Link from 'next/link';

/** The wordmark: a pilcrow (the paragraph mark) in an ink tile, then the name. */
export function Brand() {
  return (
    <Link href="/" className="mk-brand">
      <span className="mk-mark" aria-hidden="true">
        <Pilcrow strokeWidth={2.25} />
      </span>
      Thesis Copilot
    </Link>
  );
}
