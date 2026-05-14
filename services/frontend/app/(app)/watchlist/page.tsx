'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { OwnershipBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { heroSelectTriggerClassName } from '@/components/ui/form-styles';
import { PageHeader } from '@/components/ui/page-header';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TableRowSkeleton } from '@/components/ui/skeleton';
import { useOrgDirectory } from '@/hooks/use-org-name-map';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  createWatchlistItem,
  deleteWatchlistItem,
  getDefaultScannerCapabilities,
  getTokenType,
  getWorkScope,
  listRegistriesWithCapabilities,
  listWatchlist,
  listWatchlistShares,
  RegistryWithHealth,
  ResourceShare,
  ScannerCapabilities,
  shareWatchlistItem,
  triggerWatchlistScan,
  unshareWatchlistItem,
  updateWatchlistItem,
  WatchlistItem,
} from '@/lib/api';
import { cronToHuman, type HourCyclePreference } from '@/lib/cron';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';
import {
  Alert,
  Button,
  Card,
  Label,
  ListBox,
  Modal,
  SearchField,
  Select,
  Switch,
  Table,
  useOverlayState,
} from '@heroui/react';
import {
  BiometricAccessIcon,
  Clock01Icon,
  Delete01Icon,
  EyeIcon,
  PencilEdit01Icon,
  PlayIcon,
  PlusSignIcon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

const selectTriggerCls = heroSelectTriggerClassName;
const TIMEZONE_OPTIONS =
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];

function getBrowserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export default function WatchlistPage() {
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const { orgs, orgNamesById } = useOrgDirectory();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [registries, setRegistries] = useState<RegistryWithHealth[]>([]);
  const [capabilities, setCapabilities] = useState<ScannerCapabilities>(
    getDefaultScannerCapabilities()
  );
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
  const [shareTarget, setShareTarget] = useState<WatchlistItem | null>(null);
  const [shares, setShares] = useState<ResourceShare[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareOrgId, setShareOrgId] = useState('');
  const [shareSaving, setShareSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const modal = useOverlayState();
  const shareModal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();
  const isPlatformAdmin = getTokenType() === 'admin';
  const manageableOrgIds = new Set(
    orgs
      .filter((org) => org.current_user_role === 'owner' || org.current_user_role === 'admin')
      .map((org) => org.id)
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listWatchlist());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    return deferEffect(() => {
      void load();
      void listRegistriesWithCapabilities()
        .then((response) => {
          setRegistries(response.data);
          setCapabilities(response.capabilities);
          const defaultReg = response.data.find((registry) => registry.is_default);
          if (defaultReg) setRegistryId((prev) => prev || defaultReg.id);
        })
        .catch(() => {});
    });
  }, [load, scopeKey]);

  const selectableRegistries = registries.filter(
    (registry) => registry.scan_provider === 'artifactory_xray' || capabilities.enable_trivy
  );
  const registryOptions = registries.filter(
    (registry) =>
      registry.scan_provider === 'artifactory_xray' ||
      capabilities.enable_trivy ||
      registry.id === registryId
  );
  const xrayOnlyWithoutRegistries = !capabilities.enable_trivy && selectableRegistries.length === 0;
  const defaultRegistryId = registries.find((registry) => registry.is_default)?.id ?? '';

  function openCreate() {
    setEditing(null);
    setImageName('');
    setImageTag('latest');
    setSchedule('0 2 * * *');
    setTimezone(getBrowserTimezone());
    setEnabled(true);
    setRegistryId(defaultRegistryId);
    setFormError('');
    modal.open();
  }
  function openEdit(item: WatchlistItem) {
    setEditing(item);
    setImageName(item.image_name);
    setImageTag(item.image_tag);
    setSchedule(item.schedule ?? '0 2 * * *');
    setEnabled(item.enabled);
    setTimezone(item.timezone || getBrowserTimezone());
    setRegistryId(item.registry_id ?? '');
    setFormError('');
    modal.open();
  }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      if (xrayOnlyWithoutRegistries) {
        setFormError('No Artifactory Xray registry is configured yet.');
        return;
      }
      const currentScope = getWorkScope();
      const data = {
        image_name: imageName,
        image_tag: imageTag,
        schedule,
        timezone,
        enabled,
        registry_id: registryId || null,
        ...(currentScope.kind === 'org' ? { org_id: currentScope.orgId } : {}),
      };
      if (editing) {
        await updateWatchlistItem(editing.id, data);
        toast.success('Watchlist item updated');
      } else {
        await createWatchlistItem(data);
        toast.success('Added to watchlist');
      }
      modal.close();
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
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
    try {
      await triggerWatchlistScan(id);
      toast.success('Scan triggered');
    } catch {
      /* ignore */
    } finally {
      setTriggering('');
      load();
    }
  }

  function canManageAccess(item: WatchlistItem) {
    if (isPlatformAdmin) return true;
    if (item.owner_type === 'org' && item.owner_org_id) {
      return manageableOrgIds.has(item.owner_org_id);
    }
    return true;
  }

  async function loadShares(itemId: string) {
    setSharesLoading(true);
    setShareError('');
    try {
      setShares(await listWatchlistShares(itemId));
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to load access grants');
    } finally {
      setSharesLoading(false);
    }
  }

  function openShareModal(item: WatchlistItem) {
    setShareTarget(item);
    setShares([]);
    setShareOrgId('');
    setShareError('');
    shareModal.open();
    void loadShares(item.id);
  }

  async function handleGrantShare() {
    if (!shareTarget || !shareOrgId) return;
    setShareSaving(true);
    setShareError('');
    try {
      await shareWatchlistItem(shareTarget.id, shareOrgId);
      toast.success('Watchlist access granted');
      setShareOrgId('');
      await loadShares(shareTarget.id);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to grant access');
    } finally {
      setShareSaving(false);
    }
  }

  async function handleRevokeShare(orgId: string) {
    if (!shareTarget) return;
    setShareSaving(true);
    setShareError('');
    try {
      await unshareWatchlistItem(shareTarget.id, orgId);
      toast.success('Watchlist access revoked');
      await loadShares(shareTarget.id);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to revoke access');
    } finally {
      setShareSaving(false);
    }
  }

  const availableShareTargets = shareTarget
    ? orgs.filter(
        (org) =>
          (isPlatformAdmin || manageableOrgIds.has(org.id)) &&
          org.id !== shareTarget.owner_org_id &&
          !shares.some((share) => share.org_id === org.id)
      )
    : [];

  const schedulePreview = cronToHuman(schedule, { timezone, hourCycle });
  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      const statusMatches =
        statusFilter === 'all' ||
        (statusFilter === 'active' ? item.enabled : !item.enabled);
      if (!statusMatches) return false;
      if (!query) return true;
      return [item.image_name, item.image_tag]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [items, searchQuery, statusFilter]);

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Watchlist"
        description="Auto-scan images on a schedule."
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            <SegmentedControl
              ariaLabel="Hour format"
              options={[
                { id: 'locale', label: 'Locale' },
                { id: '12', label: '12h' },
                { id: '24', label: '24h' },
              ]}
              value={hourCycle}
              onChange={(next) => setHourCycle(next as HourCyclePreference)}
              size="sm"
            />
            <Button
              onPress={openCreate}
              className="btn-primary inline-flex items-center gap-2"
              variant="primary"
            >
              <PlusSignIcon size={15} /> Add Image
            </Button>
          </div>
        }
      />

      {error && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.18)',
            color: '#f87171',
          }}
        >
          {error}
        </div>
      )}

      <Card className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <SearchField name="watchlist-search" variant="secondary" className="w-full sm:max-w-sm">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search image or tag..."
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <Select
            value={statusFilter}
            onChange={(value) =>
              setStatusFilter(value === 'disabled' ? 'disabled' : value === 'active' ? 'active' : 'all')
            }
            className="w-full sm:w-[160px]"
            variant="secondary"
          >
            <Select.Trigger className={selectTriggerCls}>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="all">All statuses</ListBox.Item>
                <ListBox.Item id="active">Active</ListBox.Item>
                <ListBox.Item id="disabled">Disabled</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </div>

      {loading ? (
        <div className="surface-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Image
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Schedule
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Timezone
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Registry
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Last Scan
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 4 }).map((_, i) => (
                <TableRowSkeleton key={i} cols={7} />
              ))}
            </tbody>
          </table>
        </div>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon={<EyeIcon size={28} />}
          title={items.length > 0 ? 'No watchlist items match your filters' : 'No images being watched'}
          description={
            items.length > 0
              ? 'Try a different search or status filter.'
              : 'Add a Docker image to auto-scan it on a recurring schedule and get notified when new vulnerabilities appear.'
          }
          action={
            items.length > 0
              ? { label: 'Clear filters', onClick: () => { setSearchQuery(''); setStatusFilter('all'); } }
              : { label: '+ Add Image', onClick: openCreate }
          }
        />
      ) : (
        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label="Watchlist images" className="min-w-[1080px]">
              <Table.Header>
                <Table.Column isRowHeader>Image</Table.Column>
                <Table.Column>Schedule</Table.Column>
                <Table.Column>Timezone</Table.Column>
                <Table.Column>Registry</Table.Column>
                <Table.Column>Status</Table.Column>
                <Table.Column>Last Scan</Table.Column>
                <Table.Column className="justify-end flex">Actions</Table.Column>
              </Table.Header>
              <Table.Body>
                {filteredItems.map((item) => {
                  const reg = registries.find((r) => r.id === item.registry_id);
                  return (
                    <Table.Row key={item.id} id={item.id} className="hover:bg-[var(--row-hover)]">
                      <Table.Cell>
                        <div className="space-y-1">
                          <p className="font-mono text-xs text-zinc-700 dark:text-zinc-200">
                            {item.image_name}:{item.image_tag}
                          </p>
                          <OwnershipBadge
                            ownerType={item.owner_type}
                            ownerOrgId={item.owner_org_id}
                            orgNamesById={orgNamesById}
                          />
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <div
                          className="flex items-center gap-1.5 text-xs"
                          style={{ color: 'rgba(167,139,250,0.8)' }}
                          title={item.schedule}
                        >
                          <Clock01Icon
                            size={12}
                            color="rgba(113,113,122,0.7)"
                            className="shrink-0"
                          />
                          {cronToHuman(item.schedule ?? '', { timezone: item.timezone, hourCycle })}
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="text-xs text-zinc-500 font-mono">
                          {item.timezone || 'UTC'}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="text-xs text-zinc-500">
                          {reg?.name ?? <span className="text-zinc-400 dark:text-zinc-700">-</span>}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <span
                          className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
                          style={
                            item.enabled
                              ? {
                                  color: '#34d399',
                                  background: 'rgba(16,185,129,0.12)',
                                  border: '1px solid rgba(16,185,129,0.22)',
                                }
                              : {
                                  color: '#71717a',
                                  background: 'rgba(113,113,122,0.08)',
                                  border: '1px solid rgba(113,113,122,0.15)',
                                }
                          }
                        >
                          <span
                            className={`size-1.5 rounded-full bg-current ${item.enabled ? 'animate-pulse' : ''}`}
                          />
                          {item.enabled ? 'Active' : 'Disabled'}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="text-xs text-zinc-500">
                          {item.last_scan_id ? (
                            <Link
                              href={`/scans/${item.last_scan_id}`}
                              className="hover:text-violet-500 dark:hover:text-violet-400 transition-colors"
                              title={fullDate(item.last_scanned_at, {
                                hourCycle,
                                timeZone: item.timezone,
                              })}
                            >
                              {timeAgo(item.last_scanned_at, {
                                hourCycle,
                                timeZone: item.timezone,
                              })}
                            </Link>
                          ) : (
                            <span className="text-zinc-400 dark:text-zinc-700">Never</span>
                          )}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex justify-end">
                          <RowActionsMenu
                            label={`Open actions menu for ${item.image_name}:${item.image_tag}`}
                            items={[
                              {
                                id: 'scan-now',
                                label: triggering === item.id ? 'Scanning…' : 'Scan now',
                                icon:
                                  triggering === item.id ? (
                                    <div className="size-3.5 border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-400 rounded-full animate-spin" />
                                  ) : (
                                    <PlayIcon size={15} />
                                  ),
                                disabled: triggering === item.id,
                                onAction: () => {
                                  void handleTrigger(item.id);
                                },
                              },
                              {
                                id: 'edit',
                                label: 'Edit watchlist item',
                                icon: <PencilEdit01Icon size={15} />,
                                onAction: () => openEdit(item),
                              },
                              ...(canManageAccess(item)
                                ? [
                                    {
                                      id: 'share',
                                      label: 'Manage access',
                                      icon: <BiometricAccessIcon size={15} />,
                                      onAction: () => openShareModal(item),
                                    },
                                  ]
                                : []),
                              {
                                id: 'delete',
                                label: 'Delete watchlist item',
                                icon: <Delete01Icon size={15} />,
                                variant: 'danger',
                                onAction: () => {
                                  void handleDelete(item.id);
                                },
                              },
                            ]}
                          />
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      )}
      </Card>

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="overflow-hidden">
              <Modal.Header>
                <Modal.Heading className="font-semibold">
                  {editing ? 'Edit Watchlist Item' : 'Add to Watchlist'}
                </Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="py-5">
                <form id="watchlist-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <Alert status="danger" className="bg-danger-soft">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>{formError}</Alert.Title>
                      </Alert.Content>
                    </Alert>
                  )}
                  <div className="flex gap-3">
                    <FormField
                      label="Image Name"
                      placeholder="nginx"
                      value={imageName}
                      onChange={(e) => setImageName(e.target.value)}
                      required
                      className="bg-surface-secondary"
                      containerClassName="flex-1"
                    />
                    <FormField
                      label="Tag"
                      placeholder="latest"
                      value={imageTag}
                      onChange={(e) => setImageTag(e.target.value)}
                      required
                      className="bg-surface-secondary"
                      containerClassName="w-28"
                    />
                  </div>
                  <FormField
                    label="Schedule (cron)"
                    placeholder="0 2 * * *"
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                    required
                    className="bg-surface-secondary"
                    description="e.g. 0 2 * * * = daily at 2:00 in the selected timezone"
                  />
                  <p className="text-xs font-medium" style={{ color: 'rgba(167,139,250,0.88)' }}>
                    Preview: {schedulePreview}
                  </p>
                  <div className="space-y-2">
                    <FormField
                      label="Timezone"
                      list="watchlist-timezone-options"
                      placeholder="Europe/Berlin"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      required
                      className="bg-surface-secondary"
                    />
                    <datalist id="watchlist-timezone-options">
                      {TIMEZONE_OPTIONS.map((zone) => (
                        <option key={zone} value={zone} />
                      ))}
                    </datalist>
                    <p className="text-xs text-zinc-500">
                      Use an IANA timezone like{' '}
                      <code className="text-zinc-400 dark:text-zinc-500">UTC</code>,{' '}
                      <code className="text-zinc-400 dark:text-zinc-500">Europe/Berlin</code>, or{' '}
                      <code className="text-zinc-400 dark:text-zinc-500">America/New_York</code>.
                    </p>
                  </div>
                  {registryOptions.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">
                        Registry{' '}
                        <span className="text-zinc-400 dark:text-zinc-600 font-normal">
                          (optional)
                        </span>
                      </label>
                      <Select
                        value={registryId || '__none__'}
                        onChange={(value) =>
                          setRegistryId(String(value === '__none__' ? '' : (value ?? '')))
                        }
                        className="pt-1"
                      >
                        <Select.Trigger className={selectTriggerCls + ' bg-surface-secondary'}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="__none__">Public / Docker Hub</ListBox.Item>
                            {registryOptions.map((r) => (
                              <ListBox.Item
                                key={r.id}
                                id={r.id}
                                isDisabled={
                                  !capabilities.enable_trivy &&
                                  r.scan_provider !== 'artifactory_xray' &&
                                  r.id !== registryId
                                }
                              >
                                {r.name}
                              </ListBox.Item>
                            ))}
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
                  <Switch isSelected={enabled} onChange={setEnabled}>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    <Switch.Content>
                      <Label className="text-sm">Enabled</Label>
                    </Switch.Content>
                  </Switch>
                </form>
              </Modal.Body>
              <Modal.Footer>
                <Button onPress={modal.close} variant="secondary">
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="watchlist-form"
                  isDisabled={saving || xrayOnlyWithoutRegistries}
                  variant="primary"
                >
                  {saving && (
                    <div className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  )}
                  {editing ? 'Save' : 'Add'}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal state={shareModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="overflow-hidden">
              <Modal.Header>
                <Modal.Heading className="font-semibold">Manage Watchlist Access</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="py-5 space-y-4">
                {shareError ? (
                  <Alert status="danger" className="bg-danger-soft">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>{shareError}</Alert.Title>
                    </Alert.Content>
                  </Alert>
                ) : null}
                {shareTarget ? (
                  <div className="bg-surface-secondary rounded-xl px-4 py-3">
                    <p className="font-mono text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {shareTarget.image_name}:{shareTarget.image_tag}
                    </p>
                    <div className="mt-2">
                      <OwnershipBadge
                        ownerType={shareTarget.owner_type}
                        ownerOrgId={shareTarget.owner_org_id}
                        orgNamesById={orgNamesById}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold">Current access</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Organizations listed here can trigger or manage this watchlist item.
                    </p>
                  </div>
                  {sharesLoading ? (
                    <div className="flex justify-center py-6">
                      <div className="size-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
                    </div>
                  ) : shares.length === 0 ? (
                    <p className="text-sm text-zinc-500">No organization grants yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {shares.map((share) => (
                        <div
                          key={share.org_id}
                          className="flex items-start justify-between gap-3 rounded-xl px-4 py-3 bg-surface-secondary"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{share.org_name}</p>
                            <p className="text-xs mt-0.5">
                              {share.is_owner ? 'Owner workspace' : 'Shared access'}
                            </p>
                          </div>
                          {share.is_owner ? (
                            <span className="text-xs font-medium">Locked</span>
                          ) : (
                            <Button
                              onPress={() => {
                                void handleRevokeShare(share.org_id);
                              }}
                              isDisabled={shareSaving}
                              isIconOnly
                              variant="danger-soft"
                            >
                              <Delete01Icon size={15} />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold">Grant access</h3>
                    <p className="text-xs mt-0.5">
                      Share this watchlist item with another organization you manage.
                    </p>
                  </div>
                  {availableShareTargets.length === 0 ? (
                    <p className="text-sm">
                      No additional organizations are available for sharing.
                    </p>
                  ) : (
                    <div className="flex gap-2 items-center">
                      <Select
                        value={shareOrgId || '__none__'}
                        onChange={(value) =>
                          setShareOrgId(String(value === '__none__' ? '' : (value ?? '')))
                        }
                        className="flex-1"
                      >
                        <Select.Trigger className={selectTriggerCls + ' bg-surface-secondary'}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="__none__">Select an organization</ListBox.Item>
                            {availableShareTargets.map((org) => (
                              <ListBox.Item key={org.id} id={org.id}>
                                {org.name}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      <Button
                        onPress={() => {
                          void handleGrantShare();
                        }}
                        isDisabled={!shareOrgId || shareSaving}
                        variant="primary"
                      >
                        Grant
                      </Button>
                    </div>
                  )}
                </div>
              </Modal.Body>
              <Modal.Footer
                className="px-6 py-4 flex justify-end"
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                <Button
                  onPress={shareModal.close}
                  className="btn-secondary"
                  type="button"
                  variant="secondary"
                >
                  Close
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </div>
  );
}
