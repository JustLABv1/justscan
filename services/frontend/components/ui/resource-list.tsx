import * as React from 'react';
import Link from 'next/link';
import { FramePanel, FrameRow } from '@/components/panelui/frame';
import { cn } from '@/lib/utils';

/**
 * ResourceList is the default way to show a collection of things: registries,
 * tokens, members, providers, rules, repositories. Use a `Table` only for
 * dense data that people compare across rows (findings, packages, logs).
 *
 * ```tsx
 * <ResourceList>
 *   <ResourceList.Item
 *     media={<StatusDot tone="success" />}
 *     title="PLAIN Registry"
 *     description="artifactory.example.com · Artifactory Xray · Token"
 *     meta={<StatusTag tone="success">Healthy</StatusTag>}
 *     actions={<RowActionsMenu ... />}
 *   />
 * </ResourceList>
 * ```
 *
 * Rows stack below `sm`: the meta and actions move under the title instead of
 * squeezing it. Titles and descriptions truncate; pass `title` text as a string
 * (or set `titleTooltip`) so the full value is available on hover.
 */
function ResourceListRoot({
  className,
  bordered = true,
  children,
  ...props
}: React.ComponentProps<'ul'> & { bordered?: boolean }) {
  return (
    <FramePanel
      render={<ul {...props} />}
      data-slot="resource-list"
      className={cn(
        'flex flex-col divide-y divide-border',
        bordered
          ? 'overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10'
          : 'bg-transparent',
        className
      )}
    >
      {children}
    </FramePanel>
  );
}

export type ResourceListItemProps = {
  /** Leading icon, avatar, or status dot. */
  media?: React.ReactNode;
  title: React.ReactNode;
  /** Full text for the title tooltip when `title` is not a plain string. */
  titleTooltip?: string;
  /** One muted fact line, e.g. "12 members · 2 invites". */
  description?: React.ReactNode;
  /** Extra content under the description (chips, a progress bar, an error summary). */
  children?: React.ReactNode;
  /** Status chips or short facts shown on the right on wide screens. */
  meta?: React.ReactNode;
  /** Buttons or a RowActionsMenu, always last. */
  actions?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  /** Marks a row that needs attention with a coloured leading edge. */
  tone?: 'default' | 'danger' | 'warning' | 'success';
  selected?: boolean;
  className?: string;
};

const TONE_EDGE: Record<NonNullable<ResourceListItemProps['tone']>, string> = {
  default: '',
  danger: 'shadow-[inset_3px_0_0_0_var(--destructive)]',
  warning: 'shadow-[inset_3px_0_0_0_var(--warning)]',
  success: 'shadow-[inset_3px_0_0_0_var(--success)]',
};

function ResourceListItem({
  media,
  title,
  titleTooltip,
  description,
  children,
  meta,
  actions,
  href,
  onClick,
  tone = 'default',
  selected,
  className,
}: ResourceListItemProps) {
  const tooltip = titleTooltip ?? (typeof title === 'string' ? title : undefined);
  const pressable = Boolean(href || onClick);

  const heading = href ? (
    <Link
      href={href}
      className="truncate font-medium text-foreground outline-none after:absolute after:inset-0 hover:underline focus-visible:underline"
      title={tooltip}
    >
      {title}
    </Link>
  ) : onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="truncate text-left font-medium text-foreground outline-none after:absolute after:inset-0 hover:underline focus-visible:underline"
      title={tooltip}
    >
      {title}
    </button>
  ) : (
    <span className="truncate font-medium text-foreground" title={tooltip}>
      {title}
    </span>
  );

  return (
    <FrameRow
      render={<li />}
      data-slot="resource-list-item"
      data-selected={selected ? '' : undefined}
      className={cn(
        'relative flex flex-col items-stretch gap-3 px-4 py-3 text-sm sm:flex-row sm:items-center',
        pressable && 'transition-colors hover:bg-muted/50 has-[:focus-visible]:bg-muted/50',
        selected && 'bg-muted/60',
        TONE_EDGE[tone],
        className
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
        {media ? <div className="flex shrink-0 items-center pt-0.5 sm:pt-0">{media}</div> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {heading}
          {description ? (
            <div className="truncate text-sm text-muted-foreground">{description}</div>
          ) : null}
          {children ? <div className="mt-1 min-w-0">{children}</div> : null}
        </div>
      </div>
      {meta || actions ? (
        // `relative z-10` keeps controls clickable above a row-wide link.
        <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          {meta}
          {actions}
        </div>
      ) : null}
    </FrameRow>
  );
}

/** A labelled group inside one list, e.g. "Active" and "Revoked" tokens. */
function ResourceListSection({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-col">
      <div className="bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">{title}</div>
      <ul className="flex flex-col divide-y divide-border border-t border-border">{children}</ul>
    </li>
  );
}

export const ResourceList = Object.assign(ResourceListRoot, {
  Item: ResourceListItem,
  Section: ResourceListSection,
});
