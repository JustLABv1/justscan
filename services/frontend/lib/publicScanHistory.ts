const HISTORY_KEY = 'justscan_public_history';
const HELM_HISTORY_KEY = 'justscan_public_helm_history';
const MAX_ENTRIES = 20;

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
    const activeImages = scans.filter((scan) => scan.status !== 'completed' && scan.status !== 'failed').length;
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
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addToPublicHistory(record: PublicScanRecord): void {
  const history = getPublicHistory().filter(s => s.id !== record.id);
  history.unshift(record);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_ENTRIES)));
}

export function updatePublicHistoryEntry(id: string, updates: Partial<PublicScanRecord>): void {
  const history = getPublicHistory().map(s => s.id === id ? { ...s, ...updates } : s);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function clearPublicHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}

export function getHelmPublicHistory(): PublicHelmRunHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HELM_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.map(normalizeHelmHistoryEntry).filter((entry): entry is PublicHelmRunHistoryEntry => entry !== null)
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

export function updateHelmPublicHistoryEntry(runId: string, updates: Partial<PublicHelmRunHistoryEntry>): void {
  const history = getHelmPublicHistory().map((entry) => entry.id === runId ? { ...entry, ...updates } : entry);
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
