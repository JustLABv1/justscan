'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { EmptyState } from '@/components/ui/empty-state';
import { heroSelectTriggerClassName, nativeFieldClassName } from '@/components/ui/form-styles';
import { TableRowSkeleton } from '@/components/ui/skeleton';
import {
    createWatchlistItem, deleteWatchlistItem, getDefaultScannerCapabilities, listRegistriesWithCapabilities, listWatchlist,
    RegistryWithHealth, ScannerCapabilities, triggerWatchlistScan, updateWatchlistItem, WatchlistItem,
} from '@/lib/api';
import { cronToHuman, type HourCyclePreference } from '@/lib/cron';
import { fullDate, timeAgo } from '@/lib/time';
import { ListBox, Modal, Select, useOverlayState } from '@heroui/react';
import { Clock01Icon, Delete01Icon, EyeIcon, PencilEdit01Icon, PlayIcon, PlusSignIcon } from 'hugeicons-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

const inputCls = nativeFieldClassName;
const selectTriggerCls = heroSelectTriggerClassName;
const TIMEZONE_OPTIONS = typeof Intl.supportedValuesOf === 'function'
  ? Intl.supportedValuesOf('timeZone')
  : ['UTC'];

function getBrowserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [registries, setRegistries] = useState<RegistryWithHealth[]>([]);
  const [capabilities, setCapabilities] = useState<ScannerCapabilities>(getDefaultScannerCapabilities());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<WatchlistItem | null>(null);
  const [imageName, setImageName] = useState('');
  const [imageTag, setImageTag] = useState('latest');
  const [schedule, setSchedule] = useState('0 2 * * *');
  const [timezone, setTimezone] = useState(getBrowserTimezone());
  const [hourCycle, setHourCycle] = useState<HourCyclePreference>('locale');
  const [enabled, setEnabled] = useState(true);
  const [registryId, setRegistryId] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [triggering, setTriggering] = useState('');
  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await listWatchlist()); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    listRegistriesWithCapabilities()
      .then((response) => {
        setRegistries(response.data);
        setCapabilities(response.capabilities);
      })
      .catch(() => {});
  }, [load]);

  const selectableRegistries = registries.filter((registry) => registry.scan_provider === 'artifactory_xray' || capabilities.enable_trivy);
  const registryOptions = registries.filter((registry) => registry.scan_provider === 'artifactory_xray' || capabilities.enable_trivy || registry.id === registryId);
  const xrayOnlyWithoutRegistries = !capabilities.enable_trivy && selectableRegistries.length === 0;

  function openCreate() {
    setEditing(null); setImageName(''); setImageTag('latest'); setSchedule('0 2 * * *');
    setTimezone(getBrowserTimezone()); setEnabled(true); setRegistryId(''); setFormError(''); modal.open();
  }
  function openEdit(item: WatchlistItem) {
    setEditing(item); setImageName(item.image_name); setImageTag(item.image_tag);
    setSchedule(item.schedule ?? '0 2 * * *'); setEnabled(item.enabled);
    setTimezone(item.timezone || getBrowserTimezone()); setRegistryId(item.registry_id ?? ''); setFormError(''); modal.open();
  }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setFormError(''); setSaving(true);
    try {
      if (xrayOnlyWithoutRegistries) {
        setFormError('No Artifactory Xray registry is configured yet.');
        return;
      }
      const data = { image_name: imageName, image_tag: imageTag, schedule, timezone, enabled, ...(registryId ? { registry_id: registryId } : {}) };
      if (editing) { await updateWatchlistItem(editing.id, data); toast.success('Watchlist item updated'); }
      else { await createWatchlistItem(data); toast.success('Added to watchlist'); }
      modal.close(); await load();
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSaving(false); }
  }
  async function handleDelete(id: string) {
    const ok = await confirm({
      title: 'Remove from watchlist?',
      message: 'This image will no longer be automatically scanned on a schedule.',
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteWatchlistItem(id).catch(() => {});
    toast.success('Removed from watchlist');
    load();
  }
  async function handleTrigger(id: string) {
    setTriggering(id);
    try { await triggerWatchlistScan(id); toast.success('Scan triggered'); } catch { /* ignore */ }
    finally { setTriggering(''); load(); }
  }

  const schedulePreview = cronToHuman(schedule, { timezone, hourCycle });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Watchlist</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Auto-scan images on a schedule</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="segmented-control">
            {[
              { key: 'locale', label: 'Locale' },
              { key: '12', label: '12h' },
              { key: '24', label: '24h' },
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setHourCycle(option.key as HourCyclePreference)}
                className="segmented-control-item"
                data-active={hourCycle === option.key ? 'true' : 'false'}
                data-size="sm"
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            onClick={openCreate}
            className="btn-primary inline-flex items-center gap-2"
          >
            <PlusSignIcon size={15} /> Add Image
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>{error}</div>
      )}

      {loading ? (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Image</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Schedule</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Timezone</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Registry</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Last Scan</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 4 }).map((_, i) => <TableRowSkeleton key={i} cols={7} />)}
            </tbody>
          </table>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<EyeIcon size={28} />}
          title="No images being watched"
          description="Add a Docker image to auto-scan it on a recurring schedule and get notified when new vulnerabilities appear."
          action={{ label: '+ Add Image', onClick: openCreate }}
        />
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Image</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Schedule</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Timezone</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Registry</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Last Scan</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => {
                const reg = registries.find((r) => r.id === item.registry_id);
                return (
                  <tr key={item.id} style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-200">{item.image_name}:{item.image_tag}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(167,139,250,0.8)' }} title={item.schedule}>
                        <Clock01Icon size={12} color="rgba(113,113,122,0.7)" className="shrink-0" />
                        {cronToHuman(item.schedule ?? '', { timezone: item.timezone, hourCycle })}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500 font-mono">{item.timezone || 'UTC'}</td>
                    <td className="px-4 py-3 text-xs text-zinc-500">{reg?.name ?? <span className="text-zinc-400 dark:text-zinc-700">—</span>}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
                        style={item.enabled
                          ? { color: '#34d399', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.22)' }
                          : { color: '#71717a', background: 'rgba(113,113,122,0.08)', border: '1px solid rgba(113,113,122,0.15)' }
                        }>
                        <span className={`w-1.5 h-1.5 rounded-full bg-current ${item.enabled ? 'animate-pulse' : ''}`} />
                        {item.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {item.last_scan_id ? (
                        <Link href={`/scans/${item.last_scan_id}`} className="hover:text-violet-500 dark:hover:text-violet-400 transition-colors" title={fullDate(item.last_scanned_at, { hourCycle, timeZone: item.timezone })}>
                          {timeAgo(item.last_scanned_at, { hourCycle, timeZone: item.timezone })}
                        </Link>
                      ) : <span className="text-zinc-400 dark:text-zinc-700">Never</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleTrigger(item.id)} disabled={triggering === item.id}
                          className="text-zinc-400 dark:text-zinc-600 hover:text-violet-500 dark:hover:text-violet-400 disabled:opacity-50 transition-colors p-1.5" title="Scan now">
                          {triggering === item.id
                            ? <div className="w-3.5 h-3.5 border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-400 rounded-full animate-spin" />
                            : <PlayIcon size={15} />}
                        </button>
                        <button onClick={() => openEdit(item)} className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors p-1.5" title="Edit">
                          <PencilEdit01Icon size={15} />
                        </button>
                        <button onClick={() => handleDelete(item.id)} className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors p-1.5" title="Delete">
                          <Delete01Icon size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">{editing ? 'Edit Watchlist Item' : 'Add to Watchlist'}</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="watchlist-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-xl px-3 py-2.5 text-sm"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {formError}
                    </div>
                  )}
                  <div className="flex gap-3">
                    <div className="flex-1 space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Image Name</label>
                      <input className={inputCls + ' font-mono'} placeholder="nginx"
                        value={imageName} onChange={(e) => setImageName(e.target.value)} required />
                    </div>
                    <div className="w-28 space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Tag</label>
                      <input className={inputCls + ' font-mono'} placeholder="latest"
                        value={imageTag} onChange={(e) => setImageTag(e.target.value)} required />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Schedule <span className="text-zinc-400 dark:text-zinc-600 font-normal">(cron)</span></label>
                    <input className={inputCls + ' font-mono'} placeholder="0 2 * * *"
                      value={schedule} onChange={(e) => setSchedule(e.target.value)} required />
                    <div className="space-y-1">
                      <p className="text-xs text-zinc-500">e.g. <code className="text-zinc-400 dark:text-zinc-500">0 2 * * *</code> = daily at 2:00 in the selected timezone</p>
                      <p className="text-xs font-medium" style={{ color: 'rgba(167,139,250,0.88)' }}>Preview: {schedulePreview}</p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Timezone</label>
                    <input
                      className={inputCls + ' font-mono'}
                      list="watchlist-timezone-options"
                      placeholder="Europe/Berlin"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      required
                    />
                    <datalist id="watchlist-timezone-options">
                      {TIMEZONE_OPTIONS.map((zone) => <option key={zone} value={zone} />)}
                    </datalist>
                    <p className="text-xs text-zinc-500">Use an IANA timezone like <code className="text-zinc-400 dark:text-zinc-500">UTC</code>, <code className="text-zinc-400 dark:text-zinc-500">Europe/Berlin</code>, or <code className="text-zinc-400 dark:text-zinc-500">America/New_York</code>.</p>
                  </div>
                  {registryOptions.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Registry <span className="text-zinc-400 dark:text-zinc-600 font-normal">(optional)</span></label>
                      <Select selectedKey={registryId} onSelectionChange={k => setRegistryId(String(k === '__none__' ? '' : k))}>
                        <Select.Trigger className={selectTriggerCls}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="__none__">Public / Docker Hub</ListBox.Item>
                            {registryOptions.map((r) => <ListBox.Item key={r.id} id={r.id} isDisabled={!capabilities.enable_trivy && r.scan_provider !== 'artifactory_xray' && r.id !== registryId}>{r.name}</ListBox.Item>)}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      {xrayOnlyWithoutRegistries && (
                        <p className="text-xs" style={{ color: '#f59e0b' }}>
                          No Artifactory Xray registry is configured yet.
                        </p>
                      )}
                    </div>
                  )}
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <button
                      type="button"
                      onClick={() => setEnabled(!enabled)}
                      className="relative w-9 h-5 rounded-full transition-colors shrink-0"
                      style={{ background: enabled ? 'linear-gradient(135deg,#7c3aed,#6d28d9)' : 'var(--glass-border)' }}
                    >
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow ${enabled ? 'translate-x-4' : ''}`} />
                    </button>
                    <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Enabled</span>
                  </label>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button onClick={modal.close} className="btn-secondary" type="button">Cancel</button>
                <button type="submit" form="watchlist-form" disabled={saving || xrayOnlyWithoutRegistries} className="btn-primary disabled:opacity-60">
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {editing ? 'Save' : 'Add'}
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
