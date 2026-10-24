'use client';

import * as React from 'react';
import * as Aria from 'react-aria-components';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Search,
  X,
  Check,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge as ReuiBadge } from './badge';
import { Button, buttonVariants } from './button';
export { Button, buttonVariants };
export type { Key, SortDescriptor } from 'react-aria-components';
export { useFilter, parseColor } from 'react-aria-components';

import {
  Card as NovaCard,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from './card';
import { NOVA_INPUT, NOVA_TEXTAREA } from './nova-styles';

type BoxProps = React.ComponentProps<'div'> & { variant?: string; orientation?: string };
function Box({ variant: _variant, orientation: _orientation, ...props }: BoxProps) {
  return <div {...props} />;
}
function part(tag: 'div' | 'span' | 'h3' | 'p', classes = '') {
  return function Part({ className, ...props }: React.ComponentProps<'div'>) {
    return React.createElement(tag, { ...props, className: cn(classes, className) });
  };
}
export const Card = Object.assign(
  function Card({
    variant: _variant,
    ...props
  }: React.ComponentProps<typeof NovaCard> & { variant?: string }) {
    return <NovaCard {...props} />;
  },
  {
    Header: CardHeader,
    Title: CardTitle,
    Description: CardDescription,
    Content: CardContent,
    Footer: CardFooter,
  }
);
export const Surface = Box;
export const Typography = {
  Paragraph: ({
    size: _size,
    color,
    className,
    ...props
  }: React.ComponentProps<'p'> & { size?: string; color?: string }) => (
    <p
      className={cn('leading-normal', color === 'muted' && 'text-muted-foreground', className)}
      {...props}
    />
  ),
};
export const Header = Aria.Header;
export const Label = (props: React.ComponentProps<typeof Aria.Label>) => (
  <Aria.Label data-slot="label" {...props} />
);
export const Description = (props: React.ComponentProps<typeof Aria.Text>) => (
  <Aria.Text data-slot="description" slot="description" {...props} />
);
export const FieldError = Aria.FieldError;
export const Form = Aria.Form;
export const Toolbar = Aria.Toolbar;
export const EmptyState = Box;
export const ScrollShadow = ({
  className,
  hideScrollBar: _hide,
  orientation: _orientation,
  size: _size,
  visibility: _visibility,
  ...props
}: BoxProps & { hideScrollBar?: boolean; size?: number; visibility?: string }) => (
  <div className={cn('overflow-auto', className)} {...props} />
);
export function Separator({
  orientation = 'horizontal',
  className,
  variant: _variant,
  ...props
}: React.ComponentProps<typeof Aria.Separator> & { variant?: string }) {
  return (
    <Aria.Separator
      orientation={orientation}
      className={cn(
        orientation === 'vertical' ? 'w-px self-stretch bg-border' : 'h-px w-full bg-border',
        typeof className === 'string' && className
      )}
      {...props}
    />
  );
}
export const Chip = Object.assign(
  function Chip({
    color = 'default',
    size = 'md',
    variant = 'soft',
    className,
    ...props
  }: Omit<React.ComponentProps<'span'>, 'color'> & {
    color?: string;
    size?: string;
    variant?: string;
  }) {
    const tones = { accent: 'primary', danger: 'destructive', default: 'invert' };
    const tone = tones[color as keyof typeof tones] ?? color;
    const badgeVariant =
      color === 'default' ? 'secondary' : `${tone}-${variant === 'soft' ? 'light' : 'outline'}`;
    return (
      <ReuiBadge
        {...props}
        radius="full"
        size={size === 'sm' ? 'default' : 'lg'}
        variant={badgeVariant as React.ComponentProps<typeof ReuiBadge>['variant']}
        className={className}
      />
    );
  },
  { Label: part('span') }
);
export const Badge = Object.assign(
  function Badge({
    children,
    content,
    className,
    color = 'danger',
    size: _size,
    placement: _placement,
    variant: _variant,
    ...props
  }: Omit<React.ComponentProps<'span'>, 'color'> & {
    content?: React.ReactNode;
    color?: string;
    size?: string;
    placement?: string;
    variant?: string;
  }) {
    const value = content ?? children;
    const tones: Record<string, string> = {
      danger: 'bg-destructive text-destructive-foreground',
      warning: 'bg-warning text-warning-foreground',
      success: 'bg-success text-white',
      accent: 'bg-primary text-primary-foreground',
    };
    return (
      <span
        className={cn(
          'absolute -right-1 -top-1 inline-flex items-center justify-center rounded-full ring-2 ring-background',
          value == null ? 'size-2' : 'h-4 min-w-4 px-1 text-xs font-medium',
          tones[color] ?? tones.accent,
          className
        )}
        {...props}
      >
        {value}
      </span>
    );
  },
  { Anchor: part('span', 'relative inline-flex') }
);
export function Spinner({
  size = 'md',
  color: _color,
  className,
  ...props
}: Omit<React.ComponentProps<'svg'>, 'color'> & { size?: string; color?: string }) {
  return (
    <LoaderCircle
      role="status"
      aria-label="Loading"
      className={cn('animate-spin', size === 'sm' ? 'size-4' : 'size-6', className)}
      {...props}
    />
  );
}
export function Skeleton({
  className,
  animationType: _animation,
  ...props
}: BoxProps & { animationType?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-secondary', className)} {...props} />;
}
export const Alert = Object.assign(
  function Alert({ className, status = 'default', ...props }: BoxProps & { status?: string }) {
    return (
      <div
        role="alert"
        data-status={status}
        className={cn(
          'relative flex gap-3 rounded-lg border border-border p-4 text-sm',
          status === 'danger' && 'border-destructive/40 bg-destructive/5 text-destructive',
          status === 'success' && 'border-success/40 bg-success/5 text-success-foreground',
          status === 'warning' && 'border-warning/40 bg-warning/5 text-warning-foreground',
          status === 'accent' && 'border-primary/40 bg-primary/5 text-primary',
          className
        )}
        {...props}
      />
    );
  },
  {
    Content: part('div', 'min-w-0 flex-1'),
    Title: part('h3', 'font-medium'),
    Description: part('div', 'text-sm opacity-80'),
    Indicator: ({ children, className, ...props }: React.ComponentProps<'span'>) => (
      <span aria-hidden className={cn('shrink-0', className)} {...props}>
        {children ?? <Info className="size-4" />}
      </span>
    ),
  }
);
export const Link = Object.assign(
  function Link({ className, ...props }: React.ComponentProps<typeof Aria.Link>) {
    return (
      <Aria.Link
        className={cn(
          'inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline',
          typeof className === 'string' && className
        )}
        {...props}
      />
    );
  },
  { Icon: part('span', 'inline-flex') }
);
export const Kbd = Object.assign(
  function Kbd({ children, className, ...props }: React.ComponentProps<'kbd'>) {
    return (
      <kbd
        className={cn(
          'inline-flex items-center gap-1 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-xs',
          className
        )}
        {...props}
      >
        {children}
      </kbd>
    );
  },
  {
    Abbr: ({
      keyValue,
      children,
      ...props
    }: React.ComponentProps<'span'> & { keyValue?: string }) => (
      <span {...props}>
        {children ??
          { command: '⌘', ctrl: 'Ctrl', shift: '⇧', enter: '↵', escape: 'Esc' }[keyValue ?? ''] ??
          keyValue}
      </span>
    ),
    Content: part('span'),
  }
);
export const ButtonGroup = Object.assign(
  ({
    className,
    size: _size,
    fullWidth: _fullWidth,
    ...props
  }: BoxProps & { size?: string; fullWidth?: boolean }) => (
    <div role="group" className={cn('inline-flex gap-1', className)} {...props} />
  ),
  { Separator }
);
export const Breadcrumbs = Object.assign(
  function Breadcrumbs<T extends object>({ className, ...props }: Aria.BreadcrumbsProps<T>) {
    return (
      <Aria.Breadcrumbs
        className={cn(
          'flex min-w-0 items-center gap-2 whitespace-nowrap [&>li]:min-w-0',
          typeof className === 'string' && className
        )}
        {...props}
      />
    );
  },
  {
    Item: ({
      href,
      children,
      className,
      ...props
    }: Omit<Aria.BreadcrumbProps, 'children'> & { href?: string; children?: React.ReactNode }) => (
      <Aria.Breadcrumb
        className={cn(
          'flex min-w-0 items-center gap-2 [&:not(:first-child)]:before:content-["/"] before:text-muted-foreground/50',
          typeof className === 'string' && className
        )}
        {...props}
      >
        {href ? (
          <Aria.Link
            className="truncate text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            href={href}
          >
            {children}
          </Aria.Link>
        ) : (
          <span className="truncate font-medium">{children}</span>
        )}
      </Aria.Breadcrumb>
    ),
  }
);
export const Avatar = Object.assign(
  function Avatar({
    className,
    size: _size,
    color: _color,
    ...props
  }: BoxProps & { size?: string; color?: string }) {
    return (
      <div
        className={cn(
          'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary',
          className
        )}
        {...props}
      />
    );
  },
  { Fallback: part('span', 'text-xs font-medium') }
);

export const Input = ({
  className,
  variant: _variant,
  ...props
}: React.ComponentProps<typeof Aria.Input> & { variant?: string }) => (
  <Aria.Input className={cn(NOVA_INPUT, typeof className === 'string' && className)} {...props} />
);
export const TextArea = ({
  className,
  variant: _variant,
  fullWidth: _fullWidth,
  ...props
}: React.ComponentProps<typeof Aria.TextArea> & { variant?: string; fullWidth?: boolean }) => (
  <Aria.TextArea
    className={cn(NOVA_TEXTAREA, typeof className === 'string' && className)}
    {...props}
  />
);
export const TextField = ({
  fullWidth: _fullWidth,
  ...props
}: Aria.TextFieldProps & { fullWidth?: boolean }) => <Aria.TextField {...props} />;
export const SearchField = Object.assign(
  function SearchField({
    className,
    variant: _variant,
    ...props
  }: React.ComponentProps<typeof Aria.SearchField> & { variant?: string }) {
    return (
      <Aria.SearchField
        className={cn('min-w-0', typeof className === 'string' && className)}
        {...props}
      />
    );
  },
  {
    Group: ({ className, ...props }: React.ComponentProps<typeof Aria.Group>) => (
      <Aria.Group
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-lg border border-input bg-transparent px-2.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30',
          typeof className === 'string' && className
        )}
        {...props}
      />
    ),
    Input: ({ className, ...props }: React.ComponentProps<typeof Aria.Input>) => (
      <Aria.Input
        className={cn(
          'min-w-0 flex-1 bg-transparent py-1 text-base outline-none md:text-sm',
          typeof className === 'string' && className
        )}
        {...props}
      />
    ),
    SearchIcon: ({ className }: { className?: string }) => (
      <Search aria-hidden className={cn('size-4 text-muted-foreground', className)} />
    ),
    ClearButton: ({ className, ...props }: React.ComponentProps<typeof Aria.Button>) => (
      <Aria.Button
        aria-label="Clear search"
        className={cn(
          'rounded p-1 text-muted-foreground',
          typeof className === 'string' && className
        )}
        {...props}
      >
        <X className="size-3" />
      </Aria.Button>
    ),
  }
);

export const Checkbox = Object.assign(
  function Checkbox({
    className,
    variant: _variant,
    ...props
  }: React.ComponentProps<typeof Aria.Checkbox> & { variant?: string }) {
    return (
      <Aria.Checkbox
        className={cn(
          'group inline-flex cursor-pointer items-center gap-2 text-sm disabled:opacity-50',
          typeof className === 'string' && className
        )}
        {...props}
      />
    );
  },
  {
    Control: ({ children, className, ...props }: React.ComponentProps<'span'>) => (
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input dark:bg-input/30 group-data-[selected]:border-primary group-data-[selected]:bg-primary group-data-[selected]:text-primary-foreground group-data-[indeterminate]:bg-primary group-data-[focus-visible]:ring-3 group-data-[focus-visible]:ring-ring/50',
          className
        )}
        {...props}
      >
        {children}
      </span>
    ),
    Indicator: () => (
      <Check className="size-3 opacity-0 group-data-[selected]:opacity-100 group-data-[indeterminate]:opacity-100" />
    ),
    Content: part('span', 'inline-flex items-center gap-2'),
  }
);
export const Switch = Object.assign(
  function Switch({
    className,
    size: _size,
    ...props
  }: React.ComponentProps<typeof Aria.Switch> & { size?: string }) {
    return (
      <Aria.Switch
        className={cn(
          'group inline-flex cursor-pointer items-center gap-3 text-sm data-[disabled]:opacity-50',
          typeof className === 'string' && className
        )}
        {...props}
      />
    );
  },
  {
    Control: ({ children, className, ...props }: React.ComponentProps<'span'>) => (
      <span
        className={cn(
          'inline-flex h-[18.4px] w-8 shrink-0 items-center rounded-full border border-transparent bg-input transition-colors group-data-[selected]:bg-primary group-data-[focus-visible]:ring-3 group-data-[focus-visible]:ring-ring/50',
          className
        )}
        {...props}
      >
        {children}
      </span>
    ),
    Thumb: ({ className }: { className?: string }) => (
      <span
        className={cn(
          'size-4 translate-x-0 rounded-full bg-background shadow-sm transition-transform group-data-[selected]:translate-x-3.5',
          className
        )}
      />
    ),
    Content: part('span', 'inline-flex items-center gap-2'),
  }
);
export const RadioGroup = ({
  variant: _variant,
  ...props
}: Aria.RadioGroupProps & { variant?: string }) => <Aria.RadioGroup {...props} />;
export const Radio = Object.assign(
  function Radio({ className, ...props }: React.ComponentProps<typeof Aria.Radio>) {
    return (
      <Aria.Radio
        className={cn(
          'group flex cursor-pointer items-center gap-2 text-sm',
          typeof className === 'string' && className
        )}
        {...props}
      />
    );
  },
  {
    Control: ({ children, className, ...props }: React.ComponentProps<'span'>) => (
      <span
        className={cn(
          'flex size-4 items-center justify-center rounded-full border border-input dark:bg-input/30 group-data-[selected]:border-primary group-data-[selected]:bg-primary group-data-[selected]:text-primary-foreground',
          className
        )}
        {...props}
      >
        {children}
      </span>
    ),
    Indicator: ({ className }: { className?: string }) => (
      <span
        className={cn(
          'size-2 rounded-full bg-current opacity-0 group-data-[selected]:opacity-100',
          className
        )}
      />
    ),
    Content: part('span'),
  }
);
export const ToggleButton = ({
  className,
  variant: _variant,
  size: _size,
  ...props
}: React.ComponentProps<typeof Aria.ToggleButton> & { variant?: string; size?: string }) => (
  <Aria.ToggleButton
    className={cn(
      'rounded-md px-3 py-2 text-sm data-[selected]:bg-secondary data-[focus-visible]:ring-2 data-[focus-visible]:ring-ring',
      typeof className === 'string' && className
    )}
    {...props}
  />
);
export const ToggleButtonGroup = Object.assign(
  ({ size: _size, ...props }: Aria.ToggleButtonGroupProps & { size?: string }) => (
    <Aria.ToggleButtonGroup {...props} />
  ),
  { Separator }
);
const ProgressContext = React.createContext({ percentage: 0, indeterminate: false });
export const ProgressBar = Object.assign(
  function ProgressBar({
    color: _color,
    size: _size,
    value = 0,
    minValue = 0,
    maxValue = 100,
    isIndeterminate = false,
    children,
    ...props
  }: Aria.ProgressBarProps & { color?: string; size?: string }) {
    const percentage = Math.max(
      0,
      Math.min(100, ((value - minValue) / (maxValue - minValue)) * 100)
    );
    return (
      <ProgressContext.Provider value={{ percentage, indeterminate: isIndeterminate }}>
        <Aria.ProgressBar
          {...props}
          value={value}
          minValue={minValue}
          maxValue={maxValue}
          isIndeterminate={isIndeterminate}
        >
          {children}
        </Aria.ProgressBar>
      </ProgressContext.Provider>
    );
  },
  {
    Track: part('div', 'h-2 overflow-hidden rounded-full bg-secondary'),
    Fill: function Fill({ className, style, ...props }: React.ComponentProps<'div'>) {
      const state = React.useContext(ProgressContext);
      return (
        <div
          className={cn(
            'h-full bg-primary transition-all',
            state.indeterminate && 'animate-pulse',
            className
          )}
          style={{ width: state.indeterminate ? '50%' : `${state.percentage}%`, ...style }}
          {...props}
        />
      );
    },
    Output: function Output(props: React.ComponentProps<'span'>) {
      const { percentage } = React.useContext(ProgressContext);
      return <span {...props}>{props.children ?? `${Math.round(percentage)}%`}</span>;
    },
  }
);
export const Pagination = Object.assign(
  function Pagination({ className, size: _size, ...props }: BoxProps & { size?: string }) {
    return (
      <nav aria-label="Pagination" className={cn('flex items-center', className)} {...props} />
    );
  },
  {
    Content: part('div', 'flex items-center gap-1'),
    Item: part('span'),
    Link: ({
      isActive,
      className,
      ...props
    }: React.ComponentProps<typeof Button> & { isActive?: boolean }) => (
      <Button
        aria-current={isActive ? 'page' : undefined}
        variant={isActive ? 'outline' : 'ghost'}
        size="sm"
        className={className}
        {...props}
      />
    ),
    Previous: (props: React.ComponentProps<typeof Button>) => (
      <Button aria-label="Previous page" variant="ghost" size="sm" {...props} />
    ),
    Next: (props: React.ComponentProps<typeof Button>) => (
      <Button aria-label="Next page" variant="ghost" size="sm" {...props} />
    ),
    PreviousIcon: () => <ChevronLeft className="size-4" />,
    NextIcon: () => <ChevronRight className="size-4" />,
    Ellipsis: () => (
      <span aria-hidden className="px-2">
        …
      </span>
    ),
    Summary: part('span', 'text-sm text-muted-foreground'),
  }
);
export const Indicator = ({ className }: { className?: string }) => (
  <ChevronDown aria-hidden className={cn('size-4 shrink-0 text-muted-foreground', className)} />
);
