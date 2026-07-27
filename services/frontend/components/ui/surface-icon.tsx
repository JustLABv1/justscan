import type { ReactNode } from 'react';

export type SurfaceIconTone = 'default' | 'accent' | 'success' | 'warning' | 'danger';
export type SurfaceIconSize = 'sm' | 'md' | 'lg';
export type SurfaceIconVariant = 'default' | 'repository';

const toneClasses: Record<SurfaceIconTone, string> = {
  default: 'bg-default-100 text-default-600 dark:bg-default-200/10 dark:text-default-400',
  accent: 'bg-accent/10 text-accent',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
};

const sizeClasses: Record<SurfaceIconSize, string> = {
  sm: 'size-8 rounded-xl text-sm',
  md: 'size-10 rounded-2xl text-base',
  lg: 'size-12 rounded-2xl text-lg',
};

function joinClassNames(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(' ');
}

interface SurfaceIconProps {
  icon: ReactNode;
  tone?: SurfaceIconTone;
  size?: SurfaceIconSize;
  variant?: SurfaceIconVariant;
  className?: string;
}

export function SurfaceIcon({
  icon,
  tone = 'default',
  size = 'md',
  variant = 'default',
  className,
}: SurfaceIconProps) {
  return (
    <span
      aria-hidden
      className={joinClassNames(
        'inline-flex shrink-0 items-center justify-center',
        variant === 'repository'
          ? 'size-9 rounded-lg bg-surface-secondary text-muted'
          : `${toneClasses[tone]} ${sizeClasses[size]}`,
        className
      )}
    >
      {icon}
    </span>
  );
}
