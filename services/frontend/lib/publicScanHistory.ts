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

export interface HelmScanGroup {
  /** Unique ID for this group (first scan's id) */
  group_id: string;
  chart_url: string;
  chart_name?: string;
  chart_version?: string;
  scans: HelmScanEntry[];
  created_at: string;
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

export function getHelmPublicHistory(): HelmScanGroup[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HELM_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addToHelmPublicHistory(group: HelmScanGroup): void {
  const history = getHelmPublicHistory().filter(g => g.group_id !== group.group_id);
  history.unshift(group);
  localStorage.setItem(HELM_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_ENTRIES)));
}

export function updateHelmPublicHistoryEntry(groupId: string, updates: Partial<Omit<HelmScanGroup, 'scans'>> & { scans?: HelmScanEntry[] }): void {
  const history = getHelmPublicHistory().map(g => g.group_id === groupId ? { ...g, ...updates } : g);
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
