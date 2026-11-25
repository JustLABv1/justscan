import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The one layout for settings pages: a card per group with a sentence-case
 * title, and rows that put the label and description on the left and the
 * control on the right (stacked on small screens).
 *
 * ```tsx
 * <SettingsSection title="Sign-in" description="Who can access JustScan.">
 *   <SettingRow label="Allow self-service sign-up" description="..." htmlFor="signup">
 *     <Switch id="signup" ... />
 *   </SettingRow>
 * </SettingsSection>
 * ```
 *
 * Switches save immediately. Grouped inputs share one `footer` with a single
 * "Save changes" button, shown only when something changed.
 */
export function SettingsSection({
  title,
  description,
  actions,
  footer,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Small controls in the header, e.g. a "Reset" link. */
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-slot="settings-section"
      className={cn(
        'overflow-hidden rounded-xl bg-card text-sm text-card-foreground ring-1 ring-foreground/10',
        className
      )}
    >
      <header className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-medium">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className="divide-y divide-border">{children}</div>
      {footer ? (
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/30 px-4 py-3">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}

export function SettingRow({
  label,
  description,
  htmlFor,
  children,
  className,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  /** The control's id, so clicking the label focuses it. */
  htmlFor?: string;
  /** The control: a Switch, an input with its unit, or a Select. */
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="setting-row"
      className={cn(
        'grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,auto)] sm:items-center sm:gap-6',
        className
      )}
    >
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="font-medium text-foreground">
            {label}
          </label>
        ) : (
          <div className="font-medium text-foreground">{label}</div>
        )}
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex min-w-0 items-center gap-2 sm:justify-end">{children}</div>
    </div>
  );
}

/** A number input's unit, e.g. `<Input ... /><SettingUnit>seconds</SettingUnit>`. */
export function SettingUnit({ children }: { children: React.ReactNode }) {
  return <span className="shrink-0 text-sm text-muted-foreground">{children}</span>;
}
