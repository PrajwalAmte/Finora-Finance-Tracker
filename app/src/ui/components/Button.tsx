import React from 'react';
import { twMerge } from 'tailwind-merge';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  isLoading?: boolean;
  fullWidth?: boolean;
}

const VARIANTS = {
  // Solid iris: the one colour that asks to be tapped.
  primary: 'bg-primary-600 text-white hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600',
  secondary: 'bg-neutral-100 text-neutral-900 hover:bg-neutral-200 dark:bg-white/[0.07] dark:text-neutral-100 dark:hover:bg-white/[0.1] dark:ring-1 dark:ring-inset dark:ring-white/[0.06]',
  outline: 'ring-1 ring-inset ring-neutral-300 text-neutral-800 hover:bg-neutral-50 dark:ring-white/15 dark:text-neutral-100 dark:hover:bg-white/[0.05]',
  ghost: 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/[0.06]',
  danger: 'bg-error-500 text-white hover:bg-error-600',
};

const SIZES = {
  sm: 'h-10 px-4 text-[13px] rounded-xl',
  md: 'h-12 px-5 text-sm rounded-2xl',
  lg: 'h-14 px-6 text-[15px] rounded-2xl',
};

export const Button: React.FC<ButtonProps> = ({
  children, variant = 'primary', size = 'md', iconLeft, iconRight, isLoading = false, fullWidth = false, className, disabled, ...props
}) => (
  <button
    className={twMerge(
      'pressable inline-flex items-center justify-center gap-2 font-semibold tracking-[-0.005em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70 disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none',
      VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className,
    )}
    disabled={disabled || isLoading}
    {...props}
  >
    {isLoading ? (
      <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
    ) : iconLeft}
    {children}
    {!isLoading && iconRight}
  </button>
);
