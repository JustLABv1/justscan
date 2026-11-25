import { displayUser, humanize, isUuid } from '@/lib/labels';

export type AuditFact = { key: string; label: string; value: string };

const FACT_LABELS: Record<string, string> = {
  id: 'Scan ID',
  original: 'Original scan ID',
  new: 'New scan ID',
  ip: 'Client IP',
  size: 'Size',
  watchlist: 'Watchlist ID',
  violations: 'Policy violations',
};

const FACT_GROUP = /\s*\(((?:\s*[a-z_]+=[^,()]*,?)+)\)/gi;
const UUID_ANYWHERE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function formatBytes(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return value;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Splits an audit detail string such as
 * `Public scan created for nginx:1.27 (id=<uuid>, ip=10.0.0.1)` into a readable
 * sentence and the technical key/value facts, which belong in an expandable
 * detail view rather than the list cell.
 */
export function parseAuditDetails(details: string | null | undefined): {
  summary: string;
  facts: AuditFact[];
} {
  const raw = String(details ?? '').trim();
  const facts: AuditFact[] = [];
  const withoutGroups = raw.replace(FACT_GROUP, (_match, group: string) => {
    for (const pair of group.split(',')) {
      const [key, ...rest] = pair.split('=');
      const name = key?.trim().toLowerCase();
      const value = rest.join('=').trim();
      if (!name || !value) continue;
      facts.push({
        key: name,
        label: FACT_LABELS[name] ?? humanize(name),
        value: name === 'size' ? formatBytes(value) : value,
      });
    }
    return '';
  });
  const extraIds = withoutGroups.match(UUID_ANYWHERE) ?? [];
  for (const id of extraIds) facts.push({ key: 'ref', label: 'Reference ID', value: id });
  const summary = withoutGroups
    .replace(UUID_ANYWHERE, '')
    .replace(
      /\b1 (scans|images|tags|runs|members|tokens)\b/g,
      (_match, noun: string) => `1 ${noun.slice(0, -1)}`
    )
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.:;])/g, '$1')
    .trim();
  return { summary, facts };
}

/** Whether an audit entry was recorded for an anonymous public action. */
export function isPublicAuditEntry(entry: { operation: string; user_id?: string | null }) {
  const userId = String(entry.user_id ?? '').trim();
  return (
    entry.operation.includes('.public.') ||
    !userId ||
    userId === '00000000-0000-0000-0000-000000000000'
  );
}

export function auditActor(entry: {
  operation: string;
  user_id?: string | null;
  username?: string | null;
  email?: string | null;
}) {
  const fallback = isPublicAuditEntry(entry) ? 'Public visitor' : 'Unknown user';
  const username = isUuid(entry.username) ? '' : entry.username;
  return displayUser({ username, email: entry.email }, fallback);
}
