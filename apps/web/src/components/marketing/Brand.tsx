import Link from 'next/link';
import { LogoMark } from '@/components/LogoMark';

/** The wordmark on the public pages: the mark, then the name. */
export function Brand() {
  return (
    <Link href="/" className="mk-brand">
      <LogoMark size={30} />
      Thesis Copilot
    </Link>
  );
}
