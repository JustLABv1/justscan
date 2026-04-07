'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { SevCount, StatusBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { ImageRowSkeleton } from '@/components/ui/skeleton';
import {
    cancelScan,
    createScan,
    deleteScan,
    ImageSummary,
    listRegistries,
    listScanImages,
    listScans,
    listTags,
    Registry,
    Scan,
    Tag,
} from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
import { Checkbox, ListBox, Modal, Popover, Select, useOverlayState } from '@heroui/react';
import {
    ArrowDown01Icon,
    ArrowRight01Icon,
    Cancel01Icon,
    Delete01Icon,
    FilterIcon,
    GitCompareIcon,
    PlusSignIcon,
    Shield01Icon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

const inputCls = 'w-full px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input';

const PROVIDER_LABEL: Record<string, string> = {
  trivy: 'Trivy',
  artifactory_xray: 'Artifactory Xray',
};

// ── Child rows (scans for one image) ─────────────────────────────────
function ImageChildren({
  imageName,
  onDelete,
  onCancel,
  selectedScans,
  onSelectScan,
}: {
  imageName: string;
  onDelete: (id: string) => void;
  onCancel: (id: string) => void;
  selectedScans: Set<string>;
  onSelectScan: (scanId: string, selected: boolean) => void;
}) {
  const router = useRouter();
  const [scans, setScans] = useState<Scan[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const LIMIT = 10;

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await listScans(p, LIMIT, imageName, undefined, true);
      setScans(res.data ?? []);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [imageName]);

  useEffect(() => { load(page); }, [load, page]);

  // Auto-refresh while any scan is active
  useEffect(() => {
    const hasActive = scans.some(s => s.status === 'running' || s.status === 'pending');
    if (!hasActive) return;
    const iv = setInterval(() => load(page), 5000);
    return () => clearInterval(iv);
  }, [scans, load, page]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <tr>
      <td colSpan={10} className="p-0">
        <div
          className="mx-4 mb-3 rounded-xl overflow-hidden"
          style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)' }}
        >
          {loading ? (
            <div className="flex justify-center py-6">
              <div className="w-5 h-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
            </div>
          ) : scans.length === 0 ? (
            <div className="py-5 text-center text-xs text-zinc-500">No scans yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                  <th className="w-8 px-3 py-2" scope="col" />
                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider" scope="col">Tag</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider" scope="col">Status</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider" scope="col">Tags</th>
                  <th className="text-center px-3 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(239,68,68,0.7)' }} title="Critical vulnerabilities" scope="col"><abbr title="Critical">C</abbr></th>
                  <th className="text-center px-3 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(249,115,22,0.7)' }} title="High vulnerabilities" scope="col"><abbr title="High">H</abbr></th>
                  <th className="text-center px-3 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(234,179,8,0.7)' }} title="Medium vulnerabilities" scope="col"><abbr title="Medium">M</abbr></th>
                  <th className="text-center px-3 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(59,130,246,0.7)' }} title="Low vulnerabilities" scope="col"><abbr title="Low">L</abbr></th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">Date</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {scans.map((scan, i) => (
                  <tr
                    key={scan.id}
                    className="cursor-pointer group transition-colors"
                    style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                    onClick={() => router.push(`/scans/${scan.id}`)}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(124,58,237,0.06)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                      <Checkbox
                        isSelected={selectedScans.has(scan.id)}
                        onChange={(checked: boolean) => onSelectScan(scan.id, checked)}
                      >
                        <Checkbox.Control className="border border-zinc-500/50 data-[selected=true]:border-violet-500 data-[selected=true]:bg-violet-600">
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                      </Checkbox>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-1 h-5 rounded-full shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ background: 'linear-gradient(180deg,#a78bfa,#7c3aed)' }}
                        />
                        <span className="font-mono text-sm font-medium text-zinc-700 dark:text-zinc-200">
                          :{scan.image_tag}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={scan.status} externalStatus={scan.external_status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        {(scan.tags ?? []).map(tag => (
                          <span
                            key={tag.id}
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap"
                            style={{ background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }}
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center"><SevCount count={scan.critical_count} level="critical" /></td>
                    <td className="px-3 py-3 text-center"><SevCount count={scan.high_count} level="high" /></td>
                    <td className="px-3 py-3 text-center"><SevCount count={scan.medium_count} level="medium" /></td>
                    <td className="px-3 py-3 text-center"><SevCount count={scan.low_count} level="low" /></td>
                    <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap" title={fullDate(scan.created_at)}>
                      {timeAgo(scan.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        {(scan.status === 'pending' || scan.status === 'running') && (
                          <button
                            onClick={e => { e.stopPropagation(); onCancel(scan.id); }}
                            className="text-zinc-400 hover:text-amber-400 transition-colors"
                            title="Cancel scan"
                            aria-label="Cancel scan"
                          >
                            <Cancel01Icon size={15} aria-hidden />
                          </button>
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); onDelete(scan.id); }}
                          className="text-zinc-400 hover:text-red-400 transition-colors"
                          title="Delete scan"
                          aria-label="Delete scan"
                        >
                          <Delete01Icon size={15} aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {/* Child pagination */}
          {totalPages > 1 && (
            <div
              className="flex items-center justify-between px-4 py-2"
              style={{ borderTop: '1px solid var(--row-divider)' }}
            >
              <span className="text-xs text-zinc-500">{total} scans</span>
              <div className="flex items-center gap-1.5">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                  className="px-2.5 py-1 text-xs rounded-lg text-zinc-500 disabled:opacity-30 transition-all"
                  style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
                >← Prev</button>
                <span className="text-xs text-zinc-500 px-1">{page} / {totalPages}</span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="px-2.5 py-1 text-xs rounded-lg text-zinc-500 disabled:opacity-30 transition-all"
                  style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
                >Next →</button>
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────
export default function ScansPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [images, setImages] = useState<ImageSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [imageFilter, setImageFilter] = useState(searchParams.get('image') ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Which image names are expanded
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Track refresh tokens per expanded image (incremented to force child reload after delete/cancel)
  const [childRefreshKey, setChildRefreshKey] = useState<Record<string, number>>({});

  // Multi-select state
  const [selectedScans, setSelectedScans] = useState<Set<string>>(new Set());

  // Available tags for bulk tagging
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [registries, setRegistries] = useState<Registry[]>([]);

  // New scan form
  const [imageName, setImageName] = useState('');
  const [imageTag, setImageTag] = useState('latest');
  const [platform, setPlatform] = useState('');
  const [registryId, setRegistryId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const LIMIT = 30;

  const load = useCallback(async (p: number, img: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await listScanImages(p, LIMIT, img || undefined);
      setImages(res.data ?? []);
      setTotal(res.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(page, imageFilter); }, [load, page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { listTags().then(setAvailableTags).catch(() => {}); }, []);
  useEffect(() => { listRegistries().then(setRegistries).catch(() => {}); }, []);

  // Auto-open new scan modal when navigated from sidebar CTA (?new=1)
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      modal.open();
      router.replace('/scans');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh top-level when any image has an active scan
  useEffect(() => {
    const hasActive = images.some(
      img => img.latest_status === 'running' || img.latest_status === 'pending',
    );
    if (!hasActive) return;
    const iv = setInterval(() => load(page, imageFilter), 5000);
    return () => clearInterval(iv);
  }, [images, load, page, imageFilter]);


  function applyFilter(img: string) {
    const params = new URLSearchParams();
    if (img) params.set('image', img);
    router.replace(`/scans${params.toString() ? `?${params}` : ''}`);
    setPage(1);
    load(1, img);
  }

  function handleImageFilterChange(value: string) {
    setImageFilter(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => applyFilter(value), 300);
  }

  function toggleExpand(imageName: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(imageName)) next.delete(imageName); else next.add(imageName);
      return next;
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(''); setCreating(true);
    try {
      const newScan = await createScan(imageName, imageTag, registryId || undefined, undefined, platform || undefined);
      modal.close();
      setImageName(''); setImageTag('latest'); setPlatform(''); setRegistryId('');
      toast.success('Scan queued');
      // Expand the image row after creation
      setExpanded(prev => new Set(prev).add(newScan.image_name));
      await load(1, imageFilter);
      setPage(1);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create scan');
    } finally { setCreating(false); }
  }

  async function handleDelete(scanId: string, imageName: string) {
    const ok = await confirm({
      title: 'Delete scan?',
      message: 'This scan and all its vulnerability data will be permanently removed.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteScan(scanId);
      toast.success('Scan deleted');
      setChildRefreshKey(prev => ({ ...prev, [imageName]: (prev[imageName] ?? 0) + 1 }));
      load(page, imageFilter);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  async function handleCancel(scanId: string, imageName: string) {
    const ok = await confirm({
      title: 'Cancel scan?',
      message: 'The scan will be stopped and marked as cancelled.',
      confirmLabel: 'Cancel scan',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await cancelScan(scanId);
      toast.success('Scan cancelled');
      setChildRefreshKey(prev => ({ ...prev, [imageName]: (prev[imageName] ?? 0) + 1 }));
      load(page, imageFilter);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel');
    }
  }

  async function handleBulkDelete() {
    if (selectedScans.size === 0) return;
    const ok = await confirm({
      title: `Delete ${selectedScans.size} scan${selectedScans.size !== 1 ? 's' : ''}?`,
      message: 'These scans and all their vulnerability data will be permanently removed.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const { bulkDeleteScans } = await import('@/lib/api');
      await bulkDeleteScans(Array.from(selectedScans));
      toast.success(`${selectedScans.size} scan${selectedScans.size !== 1 ? 's' : ''} deleted`);
      setSelectedScans(new Set());
      load(page, imageFilter);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete scans');
    }
  }

  async function handleBulkAddTag(tagId: string) {
    if (selectedScans.size === 0) return;
    try {
      const { bulkAddTagToScans } = await import('@/lib/api');
      await bulkAddTagToScans(tagId, Array.from(selectedScans));
      toast.success(`Tag added to ${selectedScans.size} scan${selectedScans.size !== 1 ? 's' : ''}`);
      setSelectedScans(new Set());
      load(page, imageFilter);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to add tag');
    }
  }

  function handleGenerateReport() {
    if (selectedScans.size === 0) return;
    const scanIds = Array.from(selectedScans).join(',');
    window.open(`/reports/print?scans=${scanIds}`, '_blank');
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Scans</h1>
          {total > 0 && <p className="text-sm text-zinc-500 mt-0.5">{total} image{total !== 1 ? 's' : ''}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/scans/compare"
            className="flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-xl transition-all duration-150"
            style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}
          >
            <GitCompareIcon size={15} />
            Compare
          </Link>
          <button
            onClick={modal.open}
            className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-xl transition-all hover:opacity-90 active:scale-95"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 20px rgba(124,58,237,0.4),inset 0 1px 0 rgba(255,255,255,0.15)' }}
          >
            <PlusSignIcon size={15} />
            New Scan
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <input
            className={inputCls}
            placeholder="Filter by image name…"
            value={imageFilter}
            onChange={e => handleImageFilterChange(e.target.value)}
          />
        </div>
        {imageFilter && (
          <button
            onClick={() => { setImageFilter(''); applyFilter(''); }}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors"
            style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(167,139,250,0.25)', color: '#a78bfa' }}
          >
            <FilterIcon size={12} />
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}

      {/* Bulk action toolbar */}
      {selectedScans.size > 0 && (
        <div className="glass-panel rounded-2xl px-4 py-3 flex items-center justify-between" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {selectedScans.size} scan{selectedScans.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerateReport}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
              style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(167,139,250,0.25)', color: '#a78bfa' }}
              title="Generate report for selected scans"
            >
              Report
            </button>
            <Popover>
              <Popover.Trigger
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}
              >
                Add Tag
              </Popover.Trigger>
              <Popover.Content className="rounded-xl min-w-[160px]" placement="bottom end">
                <Popover.Dialog className="p-1">
                  {availableTags.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-zinc-500">No tags created yet</div>
                  ) : (
                    <ListBox
                      onAction={(key) => {
                        handleBulkAddTag(String(key));
                      }}
                    >
                      {availableTags.map(tag => (
                        <ListBox.Item key={tag.id} id={tag.id} className="px-3 py-1.5 text-sm rounded-lg cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ background: tag.color }}
                          />
                          {tag.name}
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  )}
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
            <button
              onClick={() => setSelectedScans(new Set())}
              className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}
            >
              Clear
            </button>
            <button
              onClick={handleBulkDelete}
              className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors text-red-400 hover:text-red-300"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Tree table */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
              <th className="w-8 px-3 py-3" />
              <th className="w-8 px-3 py-3" />
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Image</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Latest</th>
              <th className="text-center px-3 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(239,68,68,0.7)' }}>C</th>
              <th className="text-center px-3 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(249,115,22,0.7)' }}>H</th>
              <th className="text-center px-3 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(234,179,8,0.7)' }}>M</th>
              <th className="text-center px-3 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(59,130,246,0.7)' }}>L</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <ImageRowSkeleton key={i} />)
            ) : images.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-4">
                  <EmptyState
                    icon={<Shield01Icon size={28} />}
                    title={imageFilter ? 'No images match your filter' : 'No scans yet'}
                    description={imageFilter ? 'Try a different search term or clear the filter.' : 'Scan a Docker image to discover vulnerabilities, SBOMs, and more.'}
                    action={imageFilter ? undefined : { label: '+ New Scan', onClick: modal.open }}
                  />
                </td>
              </tr>
            ) : images.map((img, i) => {
              const isOpen = expanded.has(img.image_name);
              return (
                <>
                  {/* Image summary row */}
                  <tr
                    key={img.image_name}
                    className="cursor-pointer transition-colors"
                    style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                    onClick={() => toggleExpand(img.image_name)}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {/* Checkbox for selecting image's latest scan */}
                    <td className="px-3 py-3.5 w-8" onClick={e => e.stopPropagation()}>
                      <Checkbox
                        isSelected={selectedScans.has(img.latest_scan_id)}
                        onChange={(checked: boolean) => {
                          if (checked) {
                            setSelectedScans(prev => new Set(prev).add(img.latest_scan_id));
                          } else {
                            setSelectedScans(prev => {
                              const next = new Set(prev);
                              next.delete(img.latest_scan_id);
                              return next;
                            });
                          }
                        }}
                      >
                        <Checkbox.Control className="border border-zinc-500/50 data-[selected=true]:border-violet-500 data-[selected=true]:bg-violet-600">
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                      </Checkbox>
                    </td>
                    <td className="px-3 py-3.5 w-8">
                      <span
                        className="flex items-center justify-center w-5 h-5 rounded-md transition-all duration-150"
                        style={{ color: 'var(--text-muted)', background: isOpen ? 'rgba(124,58,237,0.12)' : undefined }}
                      >
                        {isOpen
                          ? <ArrowDown01Icon size={13} className="text-violet-400" />
                          : <ArrowRight01Icon size={13} />}
                      </span>
                    </td>

                    {/* Image name + meta */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200 text-sm">
                          {img.image_name}
                        </span>
                        <span
                          className="text-xs px-1.5 py-0.5 rounded-md font-medium"
                          style={{ background: 'rgba(124,58,237,0.1)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.2)' }}
                        >
                          {img.scan_count} scan{img.scan_count !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="font-mono text-xs text-zinc-400">:{img.latest_tag}</span>
                        <StatusBadge status={img.latest_status} />
                        <span className="text-xs text-zinc-500" title={fullDate(img.latest_scan_at)}>
                          {timeAgo(img.latest_scan_at)}
                        </span>
                      </div>
                    </td>

                    {/* Latest scan link */}
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/scans/${img.latest_scan_id}`}
                        onClick={e => e.stopPropagation()}
                        className="text-xs text-zinc-500 hover:text-violet-400 transition-colors font-mono truncate max-w-[96px] inline-block"
                        title="Open latest scan"
                      >
                        {img.latest_scan_id.slice(0, 8)}…
                      </Link>
                    </td>

                    {/* Severity from latest scan */}
                    <td className="px-3 py-3.5 text-center"><SevCount count={img.critical_count} level="critical" /></td>
                    <td className="px-3 py-3.5 text-center"><SevCount count={img.high_count}    level="high"     /></td>
                    <td className="px-3 py-3.5 text-center"><SevCount count={img.medium_count}  level="medium"   /></td>
                    <td className="px-3 py-3.5 text-center"><SevCount count={img.low_count}     level="low"      /></td>
                  </tr>

                  {/* Expanded children */}
                  {isOpen && (
                    <ImageChildren
                      key={`${img.image_name}-${childRefreshKey[img.image_name] ?? 0}`}
                      imageName={img.image_name}
                      onDelete={scanId => handleDelete(scanId, img.image_name)}
                      onCancel={scanId => handleCancel(scanId, img.image_name)}
                      selectedScans={selectedScans}
                      onSelectScan={(scanId, selected) => {
                        if (selected) {
                          setSelectedScans(prev => new Set(prev).add(scanId));
                        } else {
                          setSelectedScans(prev => {
                            const next = new Set(prev);
                            next.delete(scanId);
                            return next;
                          });
                        }
                      }}
                    />
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-500">{total} images</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
            >← Prev</button>
            <span className="text-sm text-zinc-500 px-2">{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
            >Next →</button>
          </div>
        </div>
      )}

      {/* Create scan modal */}
      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">New Scan</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="create-scan-form" onSubmit={handleCreate} className="space-y-4">
                  {createError && (
                    <div className="rounded-xl px-3 py-2.5 text-sm"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {createError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Image Name</label>
                    <input className={inputCls + ' font-mono'} placeholder="nginx"
                      value={imageName} onChange={e => setImageName(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Tag</label>
                    <input className={inputCls + ' font-mono'} placeholder="latest"
                      value={imageTag} onChange={e => setImageTag(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                      Registry <span className="text-zinc-400 dark:text-zinc-600 font-normal">(optional)</span>
                    </label>
                    <Select selectedKey={registryId || '__auto__'} onSelectionChange={k => setRegistryId(String(k === '__auto__' ? '' : k))}>
                      <Select.Trigger className={inputCls}>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="__auto__">Auto-match from image hostname</ListBox.Item>
                          {registries.map(registry => (
                            <ListBox.Item key={registry.id} id={registry.id}>
                              {registry.name} · {PROVIDER_LABEL[registry.scan_provider] ?? registry.scan_provider}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <p className="text-xs text-zinc-500">
                      Leave this empty to let JustScan match a registry automatically from the image hostname.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                      Platform <span className="text-zinc-400 dark:text-zinc-600 font-normal">(optional)</span>
                    </label>
                    <Select selectedKey={platform || '__auto__'} onSelectionChange={k => setPlatform(String(k === '__auto__' ? '' : k))}>
                      <Select.Trigger className={inputCls}>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="__auto__">Auto-detect</ListBox.Item>
                          <ListBox.Item id="linux/amd64">linux/amd64</ListBox.Item>
                          <ListBox.Item id="linux/arm64">linux/arm64</ListBox.Item>
                          <ListBox.Item id="linux/arm/v7">linux/arm/v7</ListBox.Item>
                          <ListBox.Item id="linux/arm/v6">linux/arm/v6</ListBox.Item>
                          <ListBox.Item id="linux/386">linux/386</ListBox.Item>
                          <ListBox.Item id="linux/s390x">linux/s390x</ListBox.Item>
                          <ListBox.Item id="linux/ppc64le">linux/ppc64le</ListBox.Item>
                          <ListBox.Item id="windows/amd64">windows/amd64</ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                  <p className="text-xs text-zinc-500">Tags can be added from the scan detail page after creation.</p>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button
                  onClick={modal.close}
                  className="px-4 py-2 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
                  style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit" form="create-scan-form" disabled={creating}
                  className="px-4 py-2 text-sm rounded-xl font-semibold text-white disabled:opacity-60 flex items-center gap-2 transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 16px rgba(124,58,237,0.35),inset 0 1px 0 rgba(255,255,255,0.15)' }}
                >
                  {creating && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  Start Scan
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </div>
  );
}
