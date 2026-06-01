const HISTORY_KEY = 'justscan_public_history';
const HELM_HISTORY_KEY = 'justscan_public_helm_history';
const MAX_ENTRIES = 20;
const HISTORY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const ACTIVE_SCAN_STALE_MS = 6 * 60 * 60 * 1000;

export interface PublicScanRecord {
  id: string;
  image_name: string;
  image_tag: string;
  platform?: string;
  status: string;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  unknown_count: number;
  created_at: string;
}

export interface HelmScanEntry {
  id: string;
  image_name: string;
  image_tag: string;
  status: string;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  created_at: string;
}

function isFiniteTimestamp(value: string): boolean {
  return Number.isFinite(new Date(value).getTime());
}

function normalizePublicHistoryRecord(entry: unknown): PublicScanRecord | null {
  if (!entry || typeof entry !== 'object') return null;

  const value = entry as Record<string, unknown>;
  if (
    typeof value.id !== 'string' ||
    typeof value.image_name !== 'string' ||
    typeof value.image_tag !== 'string' ||
    typeof value.status !== 'string' ||
    typeof value.created_at !== 'string' ||
    !isFiniteTimestamp(value.created_at)
  ) {
    return null;
  }

  return {
    id: value.id,
    image_name: value.image_name,
    image_tag: value.image_tag,
    platform: typeof value.platform === 'string' ? value.platform : undefined,
    status: value.status,
    critical_count: typeof value.critical_count === 'number' ? value.critical_count : 0,
    high_count: typeof value.high_count === 'number' ? value.high_count : 0,
    medium_count: typeof value.medium_count === 'number' ? value.medium_count : 0,
    low_count: typeof value.low_count === 'number' ? value.low_count : 0,
    unknown_count: typeof value.unknown_count === 'number' ? value.unknown_count : 0,
    created_at: value.created_at,
  };
}

function sanitizePublicHistory(records: PublicScanRecord[]): PublicScanRecord[] {
  const now = Date.now();
  const deduped = new Map<string, PublicScanRecord>();

  records.forEach((record) => {
    const createdAt = new Date(record.created_at).getTime();
    if (!Number.isFinite(createdAt) || now - createdAt > HISTORY_RETENTION_MS) {
      return;
    }

    const existing = deduped.get(record.id);
    if (!existing || new Date(existing.created_at).getTime() < createdAt) {
      deduped.set(record.id, record);
    }
  });

  return Array.from(deduped.values())
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, MAX_ENTRIES);
}

export interface PublicHelmRunHistoryEntry {
  id: string;
  chart_url: string;
  chart_name?: string;
  chart_version?: string;
  platform?: string;
  total_images: number;
  completed_images: number;
  failed_images: number;
  active_images: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  created_at: string;
}

function normalizeHelmHistoryEntry(entry: unknown): PublicHelmRunHistoryEntry | null {
  if (!entry || typeof entry !== 'object') return null;

  const value = entry as Record<string, unknown>;
  if (typeof value.id === 'string') {
    return {
      id: value.id,
      chart_url: typeof value.chart_url === 'string' ? value.chart_url : '',
      chart_name: typeof value.chart_name === 'string' ? value.chart_name : undefined,
      chart_version: typeof value.chart_version === 'string' ? value.chart_version : undefined,
      platform: typeof value.platform === 'string' ? value.platform : undefined,
      total_images: typeof value.total_images === 'number' ? value.total_images : 0,
      completed_images: typeof value.completed_images === 'number' ? value.completed_images : 0,
      failed_images: typeof value.failed_images === 'number' ? value.failed_images : 0,
      active_images: typeof value.active_images === 'number' ? value.active_images : 0,
      critical_count: typeof value.critical_count === 'number' ? value.critical_count : 0,
      high_count: typeof value.high_count === 'number' ? value.high_count : 0,
      medium_count: typeof value.medium_count === 'number' ? value.medium_count : 0,
      low_count: typeof value.low_count === 'number' ? value.low_count : 0,
      created_at: typeof value.created_at === 'string' ? value.created_at : new Date().toISOString(),
    };
  }

  if (typeof value.group_id === 'string' && Array.isArray(value.scans)) {
    const scans = value.scans as HelmScanEntry[];
    const completedImages = scans.filter((scan) => scan.status === 'completed').length;
    const failedImages = scans.filter((scan) => scan.status === 'failed').length;
    const activeImages = scans.filter(
      (scan) => scan.status !== 'completed' && scan.status !== 'failed'
    ).length;
    return {
      id: value.group_id,
      chart_url: typeof value.chart_url === 'string' ? value.chart_url : '',
      chart_name: typeof value.chart_name === 'string' ? value.chart_name : undefined,
      chart_version: typeof value.chart_version === 'string' ? value.chart_version : undefined,
      total_images: scans.length,
      completed_images: completedImages,
      failed_images: failedImages,
      active_images: activeImages,
      critical_count: scans.reduce((sum, scan) => sum + (scan.critical_count ?? 0), 0),
      high_count: scans.reduce((sum, scan) => sum + (scan.high_count ?? 0), 0),
      medium_count: scans.reduce((sum, scan) => sum + (scan.medium_count ?? 0), 0),
      low_count: scans.reduce((sum, scan) => sum + (scan.low_count ?? 0), 0),
      created_at: typeof value.created_at === 'string' ? value.created_at : new Date().toISOString(),
    };
  }

  return null;
}

export function getPublicHistory(): PublicScanRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const normalized = Array.isArray(parsed)
      ? sanitizePublicHistory(
          parsed
            .map(normalizePublicHistoryRecord)
            .filter((entry): entry is PublicScanRecord => entry !== null)
        )
      : [];

    if (raw !== JSON.stringify(normalized)) {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(normalized));
    }

    return normalized;
  } catch {
    return [];
  }
}

export function addToPublicHistory(record: PublicScanRecord): void {
  const history = getPublicHistory().filter((s) => s.id !== record.id);
  history.unshift(record);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(sanitizePublicHistory(history)));
}

export function updatePublicHistoryEntry(id: string, updates: Partial<PublicScanRecord>): void {
  const history = sanitizePublicHistory(
    getPublicHistory().map((s) => (s.id === id ? { ...s, ...updates } : s))
  );
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function clearPublicHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}

export function markStalePublicHistoryEntries(): PublicScanRecord[] {
  const history = sanitizePublicHistory(
    getPublicHistory().map((record) => {
      const isActive = record.status === 'pending' || record.status === 'running';
      const createdAt = new Date(record.created_at).getTime();

      if (
        !isActive ||
        !Number.isFinite(createdAt) ||
        Date.now() - createdAt < ACTIVE_SCAN_STALE_MS
      ) {
        return record;
      }

      return {
        ...record,
        status: 'failed',
      };
    })
  );

  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  return history;
}

export function getHelmPublicHistory(): PublicHelmRunHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HELM_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed
          .map(normalizeHelmHistoryEntry)
          .filter((entry): entry is PublicHelmRunHistoryEntry => entry !== null)
      : [];
  } catch {
    return [];
  }
}

export function addToHelmPublicHistory(entry: PublicHelmRunHistoryEntry): void {
  const history = getHelmPublicHistory().filter((existing) => existing.id !== entry.id);
  history.unshift(entry);
  localStorage.setItem(HELM_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_ENTRIES)));
}

export function updateHelmPublicHistoryEntry(
  runId: string,
  updates: Partial<PublicHelmRunHistoryEntry>
): void {
  const history = getHelmPublicHistory().map((entry) =>
    entry.id === runId ? { ...entry, ...updates } : entry
  );
  localStorage.setItem(HELM_HISTORY_KEY, JSON.stringify(history));
}

export function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
