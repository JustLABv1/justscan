import type { ReactNode } from 'react';
import { joinClassNames } from '@/components/ui/form-styles';

export type SurfaceIconTone = 'default' | 'accent' | 'success' | 'warning' | 'danger';
export type SurfaceIconSize = 'xs' | 'sm' | 'md' | 'lg';
export type SurfaceIconVariant = 'default' | 'repository';

const toneClasses: Record<SurfaceIconTone, string> = {
  default: 'bg-secondary text-foreground dark:bg-secondary/10 dark:text-muted-foreground',
  accent: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success-foreground',
  warning: 'bg-warning/10 text-warning-foreground',
  danger: 'bg-danger/10 text-danger',
};

const sizeClasses: Record<SurfaceIconSize, string> = {
  xs: 'size-5 rounded-md text-xs',
  sm: 'size-8 rounded-xl text-sm',
  md: 'size-10 rounded-xl text-base',
  lg: 'size-12 rounded-xl text-lg',
};

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
          ? 'size-9 rounded-lg bg-surface-secondary text-muted-foreground'
          : `${toneClasses[tone]} ${sizeClasses[size]}`,
        className
      )}
    >
      {icon}
    </span>
  );
}
