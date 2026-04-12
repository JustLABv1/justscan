'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { ImageChildren } from '@/components/scans/image-children';
import { useToast } from '@/components/toast';
import { SevCount, StatusBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { heroSelectTriggerClassName, joinClassNames, nativeFieldClassName } from '@/components/ui/form-styles';
import { ImageRowSkeleton } from '@/components/ui/skeleton';
import { useConditionalInterval } from '@/hooks/use-conditional-interval';
import {
    cancelScan,
    createScans,
    deleteScan,
    getDefaultScannerCapabilities,
    ImageSummary,
    listRegistriesWithCapabilities,
    listScanImages,
    listTags,
    RegistryWithHealth,
    ScannerCapabilities,
    Tag
} from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
import { Checkbox, ListBox, Modal, Popover, Select, useOverlayState } from '@heroui/react';
import {
    ArrowDown01Icon,
    ArrowRight01Icon,
    Cancel01Icon,
    FilterIcon,
    GitCompareIcon,
    PlusSignIcon,
    Shield01Icon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';

const inputCls = nativeFieldClassName;
const selectTriggerCls = heroSelectTriggerClassName;

const PROVIDER_LABEL: Record<string, string> = {
  trivy: 'Trivy',
  artifactory_xray: 'Artifactory Xray',
};

const STATUS_FILTER_OPTIONS = [
  { id: '', label: 'All latest states' },
  { id: 'failed', label: 'Failed' },
  { id: 'blocked_by_xray_policy', label: 'Blocked by Xray Policy' },
  { id: 'pending,running,waiting_for_xray,warming_artifactory_cache,indexing,queued,importing', label: 'In Flight' },
  { id: 'pending', label: 'Pending' },
  { id: 'running', label: 'Running' },
  { id: 'waiting_for_xray', label: 'Waiting for Xray' },
  { id: 'warming_artifactory_cache', label: 'Warming Artifactory Cache' },
  { id: 'indexing', label: 'Indexing in Xray' },
  { id: 'queued', label: 'Queued in Xray' },
  { id: 'importing', label: 'Importing Findings' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
] as const;

function parseImageReferences(value: string) {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mergeUniqueStringLists(...groups: string[][]) {
  const seen = new Set<string>();
  const merged: string[] = [];

  groups.flat().forEach((value) => {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  });

  return merged;
}

function MobileSevStat({ label, count, tone }: { label: string; count: number; tone: string }) {
  return (
    <div className="rounded-xl px-3 py-2 text-center" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
      <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: tone }}>{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-zinc-700 dark:text-zinc-200">{count || '—'}</p>
    </div>
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
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Which image names are expanded
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Track refresh tokens per expanded image (incremented to force child reload after delete/cancel)
  const [childRefreshKey, setChildRefreshKey] = useState<Record<string, number>>({});

  // Multi-select state
  const [selectedScans, setSelectedScans] = useState<Set<string>>(new Set());

  // Available tags for bulk tagging
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [registries, setRegistries] = useState<RegistryWithHealth[]>([]);
  const [capabilities, setCapabilities] = useState<ScannerCapabilities>(getDefaultScannerCapabilities());

  // New scan form
  const [imageName, setImageName] = useState('');
  const [imageTag, setImageTag] = useState('latest');
  const [additionalImageDraft, setAdditionalImageDraft] = useState('');
  const [additionalImageEntries, setAdditionalImageEntries] = useState<string[]>([]);
  const [platform, setPlatform] = useState('');
  const [registryId, setRegistryId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const LIMIT = 30;

  const load = useCallback(async (p: number, img: string, status: string, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const res = await listScanImages(p, LIMIT, img || undefined, status || undefined);
      setImages(res.data ?? []);
      setTotal(res.total);
      if (silent) {
        setError('');
      }
    } catch (e: unknown) {
      if (!silent) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => { load(page, imageFilter, statusFilter); }, [load, page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { listTags().then(setAvailableTags).catch(() => {}); }, []);
  useEffect(() => {
    listRegistriesWithCapabilities()
      .then((response) => {
        setRegistries(response.data);
        setCapabilities(response.capabilities);
      })
      .catch(() => {});
  }, []);

  const selectableRegistries = registries.filter((registry) => registry.scan_provider === 'artifactory_xray' || capabilities.enable_trivy);
  const xrayOnlyWithoutRegistries = !capabilities.enable_trivy && selectableRegistries.length === 0;
  const pendingAdditionalImages = parseImageReferences(additionalImageDraft);

  // Auto-open new scan modal when navigated from sidebar CTA (?new=1)
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      modal.open();
      router.replace('/scans');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useConditionalInterval(() => {
    void load(page, imageFilter, statusFilter, { silent: true });
  }, images.some((image) => image.latest_status === 'running' || image.latest_status === 'pending'), 5000);


  function applyFilter(img: string, status: string) {
    const params = new URLSearchParams();
    if (img) params.set('image', img);
    if (status) params.set('status', status);
    router.replace(`/scans${params.toString() ? `?${params}` : ''}`);
    setPage(1);
    load(1, img, status);
  }

  function handleImageFilterChange(value: string) {
    setImageFilter(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => applyFilter(value, statusFilter), 300);
  }

  function handleStatusFilterChange(value: string) {
    setStatusFilter(value);
    applyFilter(imageFilter, value);
  }

  function toggleExpand(imageName: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(imageName)) next.delete(imageName); else next.add(imageName);
      return next;
    });
  }

  function addAdditionalImagesFromDraft() {
    const parsedImages = parseImageReferences(additionalImageDraft);
    if (parsedImages.length === 0) return;

    setAdditionalImageEntries((previous) => mergeUniqueStringLists(previous, parsedImages));
    setAdditionalImageDraft('');
  }

  function removeAdditionalImageEntry(image: string) {
    setAdditionalImageEntries((previous) => previous.filter((entry) => entry !== image));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(''); setCreating(true);
    try {
      if (xrayOnlyWithoutRegistries) {
        setCreateError('No Artifactory Xray registry is configured yet. Add one before starting scans.');
        return;
      }

      const primaryImage = imageName.trim() ? `${imageName.trim()}${imageTag.trim() ? `:${imageTag.trim()}` : ''}` : '';
      const requestedImages = mergeUniqueStringLists(
        primaryImage ? [primaryImage] : [],
        additionalImageEntries,
        pendingAdditionalImages,
      );

      if (requestedImages.length === 0) {
        setCreateError('Provide at least one image to scan');
        return;
      }

      const result = await createScans(requestedImages, registryId || undefined, undefined, platform || undefined);
      const createdScans = Array.isArray(result.scans) ? result.scans : [];

      modal.close();
      setImageName(''); setImageTag('latest'); setAdditionalImageDraft(''); setAdditionalImageEntries([]); setPlatform(''); setRegistryId('');
      toast.success(`${createdScans.length} image${createdScans.length === 1 ? '' : 's'} queued`);
      setExpanded(prev => {
        const next = new Set(prev);
        createdScans.forEach(scan => next.add(scan.image_name));
        return next;
      });
      await load(1, imageFilter, statusFilter);
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
      load(page, imageFilter, statusFilter);
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
      load(page, imageFilter, statusFilter);
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
      load(page, imageFilter, statusFilter);
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
      load(page, imageFilter, statusFilter);
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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Scans</h1>
          {total > 0 && <p className="text-sm text-zinc-500 mt-0.5">{total} image{total !== 1 ? 's' : ''}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/scans/compare"
            className="btn-secondary flex flex-1 min-w-[130px] items-center justify-center gap-2 sm:flex-none"
          >
            <GitCompareIcon size={15} />
            Compare
          </Link>
          <button
            onClick={modal.open}
            className="btn-primary flex flex-1 min-w-[130px] items-center justify-center gap-2 sm:flex-none"
          >
            <PlusSignIcon size={15} />
            New Scan
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="glass-panel rounded-2xl p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_280px_auto] xl:items-end">
          <div className="space-y-1.5 md:col-span-2 xl:col-span-1">
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Image</label>
            <input
              className={inputCls}
              placeholder="Filter by image name…"
              value={imageFilter}
              onChange={e => handleImageFilterChange(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Latest State</label>
            <Select selectedKey={statusFilter || '__all__'} onSelectionChange={key => handleStatusFilterChange(String(key === '__all__' ? '' : key))} className="min-w-0">
              <Select.Trigger className={selectTriggerCls}>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="__all__">All latest states</ListBox.Item>
                  {STATUS_FILTER_OPTIONS.filter((option) => option.id !== '').map((option) => (
                    <ListBox.Item key={option.id} id={option.id}>{option.label}</ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
          <div className="flex items-end md:col-span-2 xl:col-span-1 xl:justify-end">
            {(imageFilter || statusFilter) ? (
              <button
                onClick={() => { setImageFilter(''); setStatusFilter(''); applyFilter('', ''); }}
                className="btn-secondary flex w-full items-center justify-center gap-1.5 md:w-auto"
                type="button"
              >
                <FilterIcon size={12} />
                Clear Filters
              </button>
            ) : (
              <p className="text-sm text-zinc-500 md:text-right">{total} image{total !== 1 ? 's' : ''}</p>
            )}
          </div>
        </div>
      </div>

      {error ? <FormAlert description={error} title="Scan list failed to load" /> : null}

      {/* Bulk action toolbar */}
      {selectedScans.size > 0 && (
        <div className="glass-panel rounded-2xl px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {selectedScans.size} scan{selectedScans.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleGenerateReport}
              className="btn-secondary flex flex-1 min-w-[110px] items-center justify-center gap-1.5 sm:flex-none"
              type="button"
              title="Generate report for selected scans"
            >
              Report
            </button>
            <Popover>
              <Popover.Trigger
                className="btn-secondary"
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
              className="btn-secondary flex-1 min-w-[90px] sm:flex-none"
              type="button"
            >
              Clear
            </button>
            <button
              onClick={handleBulkDelete}
              className="btn-danger flex-1 min-w-[90px] sm:flex-none"
              type="button"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Mobile list */}
      <div className="space-y-3 md:hidden">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="glass-panel rounded-2xl p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-4 h-4 rounded border border-zinc-400/50 mt-1" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-40 rounded skeleton" />
                  <div className="h-3 w-28 rounded skeleton" />
                </div>
                <div className="h-8 w-8 rounded-lg skeleton" />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: 4 }).map((__, sevIndex) => <div key={sevIndex} className="h-14 rounded-xl skeleton" />)}
              </div>
            </div>
          ))
        ) : images.length === 0 ? (
          <EmptyState
            icon={<Shield01Icon size={28} />}
            title={imageFilter ? 'No images match your filter' : 'No scans yet'}
            description={imageFilter ? 'Try a different search term or clear the filter.' : 'Scan a Docker image to discover vulnerabilities, SBOMs, and more.'}
            action={imageFilter ? undefined : { label: '+ New Scan', onClick: modal.open }}
          />
        ) : (
          images.map((img) => {
            const isOpen = expanded.has(img.image_name);
            return (
              <div key={img.image_name} className="glass-panel rounded-2xl overflow-hidden">
                <div className="p-4 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="pt-1" onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        isSelected={selectedScans.has(img.latest_scan_id)}
                        onChange={(checked: boolean) => {
                          if (checked) {
                            setSelectedScans((previous) => new Set(previous).add(img.latest_scan_id));
                          } else {
                            setSelectedScans((previous) => {
                              const next = new Set(previous);
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
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-sm font-medium text-zinc-800 dark:text-zinc-200">{img.image_name}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-zinc-400">:{img.latest_tag}</span>
                            <StatusBadge status={img.latest_status} externalStatus={img.latest_external_status} />
                          </div>
                        </div>
                        <span
                          className="shrink-0 text-xs px-1.5 py-0.5 rounded-md font-medium"
                          style={{ background: 'rgba(124,58,237,0.1)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.2)' }}
                        >
                          {img.scan_count} scan{img.scan_count !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
                        <span title={fullDate(img.latest_scan_at)}>{timeAgo(img.latest_scan_at)}</span>
                        <Link className="font-mono text-violet-500 hover:text-violet-400" href={`/scans/${img.latest_scan_id}`}>
                          {img.latest_scan_id.slice(0, 8)}…
                        </Link>
                      </div>
                    </div>
                    <button
                      aria-label={isOpen ? `Collapse ${img.image_name}` : `Expand ${img.image_name}`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all"
                      onClick={() => toggleExpand(img.image_name)}
                      style={{ background: isOpen ? 'rgba(124,58,237,0.12)' : 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}
                      type="button"
                    >
                      {isOpen ? <ArrowDown01Icon size={15} className="text-violet-400" /> : <ArrowRight01Icon size={15} />}
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <MobileSevStat count={img.critical_count} label="Critical" tone="rgba(239,68,68,0.78)" />
                    <MobileSevStat count={img.high_count} label="High" tone="rgba(249,115,22,0.78)" />
                    <MobileSevStat count={img.medium_count} label="Medium" tone="rgba(234,179,8,0.82)" />
                    <MobileSevStat count={img.low_count} label="Low" tone="rgba(59,130,246,0.82)" />
                  </div>
                </div>

                {isOpen ? (
                  <div className="px-4 pb-4">
                    <ImageChildren
                      imageName={img.image_name}
                      key={`${img.image_name}-${childRefreshKey[img.image_name] ?? 0}-stacked`}
                      mode="stacked"
                      onCancel={(scanId) => handleCancel(scanId, img.image_name)}
                      onDelete={(scanId) => handleDelete(scanId, img.image_name)}
                      onSelectScan={(scanId, selected) => {
                        if (selected) {
                          setSelectedScans((previous) => new Set(previous).add(scanId));
                        } else {
                          setSelectedScans((previous) => {
                            const next = new Set(previous);
                            next.delete(scanId);
                            return next;
                          });
                        }
                      }}
                      selectedScans={selectedScans}
                    />
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {/* Tree table */}
      <div className="hidden md:block glass-panel rounded-2xl overflow-hidden">
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
                <Fragment key={img.image_name}>
                  {/* Image summary row */}
                  <tr
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
                        <StatusBadge status={img.latest_status} externalStatus={img.latest_external_status} />
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
                      mode="table"
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
                </Fragment>
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
              className="btn-secondary"
            >← Prev</button>
            <span className="text-sm text-zinc-500 px-2">{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="btn-secondary"
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
                  {createError ? <FormAlert description={createError} title="Scan creation failed" /> : null}
                  <FormField className="font-mono" label="Image Name" onChange={e => setImageName(e.target.value)} placeholder="nginx" value={imageName} />
                  <FormField className="font-mono" label="Tag" onChange={e => setImageTag(e.target.value)} placeholder="latest" required value={imageTag} />
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                      Additional Images <span className="text-zinc-400 dark:text-zinc-600 font-normal">(optional)</span>
                    </label>
                    <textarea
                      className={joinClassNames(inputCls, 'min-h-24 font-mono resize-y')}
                      placeholder={'Paste one or more full image references here\nExample: ghcr.io/example/api:1.2.3, registry.example.com/team/worker:latest'}
                      value={additionalImageDraft}
                      onChange={e => setAdditionalImageDraft(e.target.value)}
                    />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-zinc-500">
                        Paste one or many full image references, separated by commas or new lines. Anything still in this box is included when you start the scan.
                      </p>
                      <button
                        className="btn-secondary-sm shrink-0"
                        onClick={addAdditionalImagesFromDraft}
                        type="button"
                      >
                        Add {pendingAdditionalImages.length > 1 ? `${pendingAdditionalImages.length} refs` : 'to list'}
                      </button>
                    </div>
                    {additionalImageEntries.length > 0 ? (
                      <div className="rounded-2xl p-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Queued additional images</p>
                          <span className="rounded-full px-2 py-0.5 text-xs font-medium text-zinc-500" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)' }}>
                            {additionalImageEntries.length}
                          </span>
                        </div>
                        <div className="mt-3 space-y-2 max-h-40 overflow-y-auto pr-1">
                          {additionalImageEntries.map((image) => (
                            <div key={image} className="flex items-start justify-between gap-3 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)' }}>
                              <span className="min-w-0 break-all font-mono text-xs text-zinc-600 dark:text-zinc-300">{image}</span>
                              <button
                                aria-label={`Remove ${image}`}
                                className="btn-icon-subtle h-8 w-8 shrink-0 rounded-lg"
                                onClick={() => removeAdditionalImageEntry(image)}
                                type="button"
                              >
                                <Cancel01Icon aria-hidden size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <p className="text-xs text-zinc-500">
                      Use Image Name and Tag for the primary image. Untagged full references default to <span className="font-mono">latest</span>.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                      Registry <span className="text-zinc-400 dark:text-zinc-600 font-normal">(optional)</span>
                    </label>
                    <Select selectedKey={registryId || '__auto__'} onSelectionChange={k => setRegistryId(String(k === '__auto__' ? '' : k))}>
                      <Select.Trigger className={selectTriggerCls}>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="__auto__">{capabilities.enable_trivy ? 'Auto-match from image hostname' : 'Auto-match from configured Xray registries'}</ListBox.Item>
                          {selectableRegistries.map(registry => (
                            <ListBox.Item key={registry.id} id={registry.id}>
                              {registry.name} · {PROVIDER_LABEL[registry.scan_provider] ?? registry.scan_provider}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <p className="text-xs text-zinc-500">
                      {capabilities.enable_trivy
                        ? 'Leave this empty to let JustScan match a registry automatically from the image hostname.'
                        : 'Auto-match only considers registries configured for Artifactory Xray.'}
                    </p>
                    {xrayOnlyWithoutRegistries && (
                      <p className="text-xs" style={{ color: '#f87171' }}>No Xray-backed registry is available for this deployment yet.</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                      Platform <span className="text-zinc-400 dark:text-zinc-600 font-normal">(optional)</span>
                    </label>
                    <Select selectedKey={platform || '__auto__'} onSelectionChange={k => setPlatform(String(k === '__auto__' ? '' : k))}>
                      <Select.Trigger className={selectTriggerCls}>
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
                  className="btn-secondary"
                  type="button"
                >
                  Cancel
                </button>
                <button
                  type="submit" form="create-scan-form" disabled={creating || xrayOnlyWithoutRegistries}
                  className="btn-primary inline-flex items-center gap-2"
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
