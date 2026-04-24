import { heroSelectTriggerClassName, nativeFieldClassName } from '@/components/ui/form-styles';
import type { CSSProperties } from 'react';

export const inputCls = nativeFieldClassName;
export const selectTriggerCls = heroSelectTriggerClassName;

const USER_AUTH_LABEL: Record<string, string> = {
  local: 'Local',
  oidc: 'OIDC',
};

export const USER_AUTH_STYLE: Record<string, CSSProperties> = {
  local: { color: '#60a5fa', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' },
  oidc: { color: '#a78bfa', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' },
};

export function userAuthLabel(authType?: string) {
  return USER_AUTH_LABEL[authType ?? 'local'] ?? (authType ? authType.toUpperCase() : 'Unknown');
}

export function toIsoOrUndefined(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function copyToClipboard(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export function formatDbAge(hours?: number | null): string {
  if (hours == null || Number.isNaN(hours)) return 'Unknown';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${hours >= 10 ? hours.toFixed(0) : hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export function scannerTone(status: 'healthy' | 'stale' | 'error') {
  if (status === 'healthy') {
    return { color: '#34d399', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)' };
  }
  if (status === 'stale') {
    return { color: '#fbbf24', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)' };
  }
  return { color: '#f87171', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)' };
}

export function parseDelimitedList(value: string) {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}