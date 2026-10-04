import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent text-[var(--accent-contrast)] hover:opacity-90',
  secondary: 'bg-surface-alt text-text border border-border hover:border-accent',
  ghost: 'bg-transparent text-text-muted hover:text-text',
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium
        transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97]
        disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2
        ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
}
