export const nativeFieldClassName =
  'w-full h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30';

export const fieldInputClassName =
  'surface-input w-full h-8 rounded-lg px-2.5 text-base md:text-sm';

export const fieldTextAreaClassName =
  'surface-input w-full min-h-16 rounded-lg px-2.5 py-1 text-sm resize-y';

export const fieldSelectTriggerClassName = fieldInputClassName;

export const fieldLabelClassName = 'block text-sm font-medium text-foreground';

export const fieldDescriptionClassName = 'text-xs text-muted-foreground';

export const fieldErrorClassName = 'text-xs font-medium text-danger';

export function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}
