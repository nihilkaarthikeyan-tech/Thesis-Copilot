import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * The one button, the same on the public pages and in the product (2026-09-28): the shared
 * radius, bold Satoshi, no shadow, one accent.
 *
 * `primary` is reserved for the single action a screen exists to perform — one per view. Anything
 * a student might do alongside it is `secondary` or `ghost`, so the eye is never asked to choose
 * between two equally loud controls.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-sans font-bold transition-colors disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-ink hover:bg-accent-hover',
        secondary: 'border border-line-strong bg-surface text-ink hover:bg-sunk',
        ghost: 'text-muted hover:bg-sunk hover:text-ink',
        danger: 'border border-danger/40 bg-transparent text-danger hover:bg-danger-soft',
        link: 'text-accent underline underline-offset-4 hover:text-accent-hover',
      },
      size: {
        sm: 'h-7 px-2.5 text-[12px]',
        md: 'h-9 px-4 text-[13px]',
        lg: 'h-11 px-6 text-[15px]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
