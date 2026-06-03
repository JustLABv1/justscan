export const nativeFieldClassName =
  'w-full rounded-xl bg-surface-secondary px-3 py-2.5 text-sm outline-none transition-colors focus:ring-1 focus:ring-accent-500/40';

export const heroFieldClassName = 'surface-input w-full min-h-11 rounded-xl px-3 text-sm';

export const heroTextAreaClassName = 'surface-input w-full min-h-28 rounded-xl px-3 py-2.5 text-sm resize-y';

export const heroSelectTriggerClassName = heroFieldClassName;

export const fieldLabelClassName = 'block text-sm font-medium text-foreground/72';

export const fieldDescriptionClassName = 'text-xs text-foreground/56';

export const fieldErrorClassName = 'text-xs font-medium text-danger';

export function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}
