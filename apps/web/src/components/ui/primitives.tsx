import type {
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

/**
 * The small shared vocabulary every screen is built from — Paper & Ink (docs/DESIGN.md).
 *
 * Kept in one file on purpose: these are twenty-line components whose whole value is that they
 * agree with each other about a 3px radius, a hairline rule and one accent. Spread across twenty
 * files they drift, and drift is exactly what made the app look unstyled in the first place.
 */

/* ------------------------------------------------------------------ surface */

/**
 * A bounded region. `border` is the default because Paper & Ink separates by line, not by shadow —
 * a page of drop-shadowed cards reads as a dashboard, and this is a writing tool.
 */
export function Card({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cn('rounded-md border border-line bg-surface', className)} {...props}>
      {children}
    </div>
  );
}

export function CardBody({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-4', className)} {...props}>
      {children}
    </div>
  );
}

/** A card's own header strip: title left, actions right, hairline under. */
export function CardHeader({
  title,
  hint,
  actions,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="font-serif text-[15px] font-semibold leading-snug text-ink">{title}</h2>
        {hint ? <p className="mt-0.5 text-[13px] text-muted">{hint}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* --------------------------------------------------------------------- form */

/**
 * `htmlFor` is required rather than optional, which is what makes this safe: the rule that a label
 * must name a control is enforced by the type, at every call site, instead of being hoped for.
 */
export function Label({
  className,
  children,
  htmlFor,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { htmlFor: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn('block text-[13px] font-semibold text-ink', className)}
      {...props}
    >
      {children}
    </label>
  );
}

/** Sub-label under a field: what the value is for, or what format it wants. */
export function Hint({ className, children, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-[12.5px] leading-snug text-muted', className)} {...props}>
      {children}
    </p>
  );
}

const fieldBase =
  'w-full rounded-md border border-line bg-surface px-3 text-[14px] text-ink placeholder:text-faint ' +
  'transition-colors hover:border-line-strong focus:border-accent disabled:opacity-50';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cn(fieldBase, 'min-h-24 py-2 leading-relaxed', className)} {...props} />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, 'h-9', className)} {...props}>
      {children}
    </select>
  );
}

/* -------------------------------------------------------------------- state */

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-sunk text-muted',
  accent: 'bg-accent-soft text-accent',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
};

/**
 * A state word. Used for grounding level ("Full text" / "Abstract only"), plan, and job status —
 * anywhere the state must read at a glance rather than be counted.
 */
export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.05em]',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A keyboard key, for the shortcut hints PRD §6.3 specifies. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-sm border border-line-strong bg-sunk px-1 py-px font-mono text-[10.5px] font-medium text-muted">
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------ layout */

/** The uppercase micro-heading above a group. */
export function Eyebrow({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('eyebrow', className)}>{children}</div>;
}

/** A page-level heading block: serif title, optional sentence, optional actions. */
export function PageHeader({
  title,
  lede,
  actions,
  className,
}: {
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-balance font-serif text-[27px] font-semibold leading-tight text-ink">
          {title}
        </h1>
        {lede ? <p className="mt-1.5 max-w-[62ch] text-[14px] text-muted">{lede}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * What a list shows before it has anything in it.
 *
 * PRD §6.2 asks empty states to name the next action rather than the absence, so `action` is not
 * optional in spirit even where the type allows it.
 */
export function Empty({
  title,
  children,
  action,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-line px-5 py-8 text-center">
      <p className="font-serif text-[15px] text-ink">{title}</p>
      {children ? (
        <p className="mx-auto mt-1 max-w-[46ch] text-[13px] text-muted">{children}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** A hairline divider that carries a label, for separating groups inside a panel. */
export function Divider({ label, className }: { label?: string; className?: string }) {
  if (!label) return <hr className={cn('border-line', className)} />;
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <hr className="flex-1 border-line" />
      <span className="eyebrow">{label}</span>
      <hr className="flex-1 border-line" />
    </div>
  );
}
