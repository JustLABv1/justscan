export const nativeFieldClassName =
  'w-full rounded-xl glass-input px-3 py-2.5 text-sm outline-none transition-colors focus:ring-1 focus:ring-violet-500/40';

export const heroFieldClassName = 'glass-input w-full min-h-11 rounded-xl px-3 text-sm';

export const heroTextAreaClassName = 'glass-input w-full min-h-28 rounded-xl px-3 py-2.5 text-sm resize-y';

export const heroSelectTriggerClassName = heroFieldClassName;

export const fieldLabelClassName = 'block text-sm font-medium text-zinc-600 dark:text-zinc-300';

export function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}