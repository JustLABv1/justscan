'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { ManageSuppressionAccessModal } from '@/components/suppressions/manage-suppression-access-modal';
import { useToast } from '@/components/toast';
import { OwnershipBadge, SuppressionSourceBadge } from '@/components/ui/badges';
import { FormAlert } from '@/components/ui/form-alert';
import { heroSelectTriggerClassName } from '@/components/ui/form-styles';
import { PageHeader } from '@/components/ui/page-header';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { useOrgDirectory } from '@/hooks/use-org-name-map';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  deleteSuppressionById,
  getTokenType,
  listAllSuppressions,
  listSuppressionImages,
  listSuppressionShares,
  ResourceShare,
  shareSuppression,
  Suppression,
  SuppressionAppliedImage,
  unshareSuppression,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { canManageOrg, canMutateOrg } from '@/lib/org-permissions';
import { fullDate, timeAgo } from '@/lib/time';
import {
  Button,
  Card,
  Chip,
  ListBox,
  Modal,
  Pagination,
  SearchField,
  Select,
  Separator,
  Spinner,
  Table,
  useOverlayState,
} from '@heroui/react';
import { Delete01Icon, SecurityLockIcon, Shield01Icon } from 'hugeicons-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STATUS_LABEL: Record<string, string> = {
  accepted: 'Accepted Risk',
  wont_fix: "Won't Fix",
  false_positive: 'False Positive',
  xray_ignore: 'Xray Ignore',
};

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'false_positive'
      ? 'success'
      : status === 'xray_ignore'
        ? 'warning'
        : status === 'accepted'
          ? 'accent'
          : 'default';
  return (
    <Chip color={color} size="sm" variant="soft">
      {STATUS_LABEL[status] ?? status}
    </Chip>
  );
}

const LIMIT = 50;
const selectTriggerCls = heroSelectTriggerClassName;

export default function SuppressionsPage() {
  const router = useRouter();
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const { orgs, orgNamesById } = useOrgDirectory();
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [shareTarget, setShareTarget] = useState<Suppression | null>(null);
  const [shares, setShares] = useState<ResourceShare[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareOrgId, setShareOrgId] = useState('');
  const [shareSaving, setShareSaving] = useState(false);
  const [imagesTarget, setImagesTarget] = useState<Suppression | null>(null);
  const [appliedImages, setAppliedImages] = useState<SuppressionAppliedImage[]>([]);
  const [imagesTotal, setImagesTotal] = useState(0);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imagesError, setImagesError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();
  const shareModal = useOverlayState();
  const imagesModal = useOverlayState();
  const isPlatformAdmin = getTokenType() === 'admin';
  const orgRoleById = useMemo(
    () => new Map(orgs.map((org) => [org.id, org.current_user_role] as const)),
    [orgs]
  );
  const manageableOrgIds = new Set(
    orgs.filter((org) => canManageOrg(org.current_user_role)).map((org) => org.id)
  );

  const load = useCallback(async (p: number, status: string, q: string) => {
    setLoading(true);
    try {
      const res = await listAllSuppressions(p, LIMIT, status || undefined, q || undefined);
      setSuppressions(res.data ?? []);
      setTotal(res.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load suppressions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(
    () => deferEffect(() => load(page, statusFilter, searchQuery)),
    [load, page, scopeKey, statusFilter, searchQuery]
  );

  function canManageAccess(suppression: Suppression) {
    if (
      suppression.read_only ||
      suppression.source === 'xray' ||
      suppression.owner_type === 'system'
    )
      return false;
    if (isPlatformAdmin) return true;
    if (suppression.owner_type === 'org' && suppression.owner_org_id) {
      return canManageOrg(orgRoleById.get(suppression.owner_org_id));
    }
    return true;
  }

  function canMutateSuppression(suppression: Suppression) {
    if (suppression.read_only || suppression.source === 'xray') {
      return false;
    }
    if (isPlatformAdmin) return true;
    if (suppression.owner_type === 'system') return false;
    if (suppression.owner_type === 'org' && suppression.owner_org_id) {
      return canMutateOrg(orgRoleById.get(suppression.owner_org_id));
    }
    return true;
  }

  async function loadShares(suppressionId: string) {
    setSharesLoading(true);
    setShareError('');
    try {
      setShares(await listSuppressionShares(suppressionId));
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to load access grants');
    } finally {
      setSharesLoading(false);
    }
  }

  function openShareModal(suppression: Suppression) {
    if (!canManageAccess(suppression)) return;
    setShareTarget(suppression);
    setShares([]);
    setShareOrgId('');
    setShareError('');
    shareModal.open();
    void loadShares(suppression.id);
  }

  async function handleGrantShare() {
    if (!shareTarget || !shareOrgId || !canManageAccess(shareTarget)) return;
    setShareSaving(true);
    setShareError('');
    try {
      await shareSuppression(shareTarget.id, shareOrgId);
      toast.success('Suppression access granted');
      setShareOrgId('');
      await loadShares(shareTarget.id);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to grant access');
    } finally {
      setShareSaving(false);
    }
  }

  async function handleRevokeShare(orgId: string) {
    if (!shareTarget || !canManageAccess(shareTarget)) return;
    setShareSaving(true);
    setShareError('');
    try {
      await unshareSuppression(shareTarget.id, orgId);
      toast.success('Suppression access revoked');
      await loadShares(shareTarget.id);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to revoke access');
    } finally {
      setShareSaving(false);
    }
  }

  async function loadAppliedImages(suppressionId: string) {
    setImagesLoading(true);
    setImagesError('');
    try {
      const result = await listSuppressionImages(suppressionId);
      setAppliedImages(result.data ?? []);
      setImagesTotal(result.total ?? 0);
    } catch (err: unknown) {
      setImagesError(err instanceof Error ? err.message : 'Failed to load matching images');
      setAppliedImages([]);
      setImagesTotal(0);
    } finally {
      setImagesLoading(false);
    }
  }

  function openAppliesImagesModal(suppression: Suppression) {
    setImagesTarget(suppression);
    setAppliedImages([]);
    setImagesTotal(0);
    setImagesError('');
    imagesModal.open();
    void loadAppliedImages(suppression.id);
  }

  async function handleDelete(s: Suppression) {
    if (!canMutateSuppression(s)) return;
    const ok = await confirm({
      title: `Remove suppression for ${s.vuln_id}?`,
      message: 'The vulnerability will no longer be suppressed for this image.',
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteSuppressionById(s.id).catch(() => {});
    toast.success(`Suppression for ${s.vuln_id} removed`);
    load(page, statusFilter, searchQuery);
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const paginationItems = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const items: Array<number | 'ellipsis'> = [1];
    if (page > 3) items.push('ellipsis');
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);
    for (let i = start; i <= end; i += 1) items.push(i);
    if (page < totalPages - 2) items.push('ellipsis');
    items.push(totalPages);
    return items;
  }, [page, totalPages]);
  const availableShareTargets = shareTarget
    ? orgs.filter(
        (org) =>
          (isPlatformAdmin || manageableOrgIds.has(org.id)) &&
          org.id !== shareTarget.owner_org_id &&
          !shares.some((share) => share.org_id === org.id)
      )
    : [];

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Suppressions"
        description={
          total > 0
            ? `${total} active suppression${total !== 1 ? 's' : ''}`
            : 'Manage vulnerability suppressions across all images.'
        }
      />

      {error && <FormAlert description={error} title="Suppressions loading failed" />}

      <Card className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <SearchField
            name="suppressions-search"
            variant="secondary"
            className="w-full sm:max-w-sm"
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                placeholder="Search CVE ID..."
                value={searchQuery}
                onChange={(e) => {
                  const v = e.target.value;
                  setSearchQuery(v);
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  debounceRef.current = setTimeout(() => {
                    setPage(1);
                    load(1, statusFilter, v);
                  }, 300);
                }}
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <Select
            value={statusFilter || '__all__'}
            onChange={(value) => {
              const v = String(value === '__all__' ? '' : (value ?? ''));
              setStatusFilter(v);
              setPage(1);
              load(1, v, searchQuery);
            }}
            className="w-full sm:w-44"
            variant="secondary"
          >
            <Select.Trigger className={selectTriggerCls}>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="__all__">All Statuses</ListBox.Item>
                <ListBox.Item id="accepted">Accepted Risk</ListBox.Item>
                <ListBox.Item id="wont_fix">Won&apos;t Fix</ListBox.Item>
                <ListBox.Item id="false_positive">False Positive</ListBox.Item>
                <ListBox.Item id="xray_ignore">Xray Ignore</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </div>

        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label="Suppressions" className="min-w-[840px]">
              <Table.Header>
                <Table.Column isRowHeader>Vulnerability</Table.Column>
                <Table.Column>Status</Table.Column>
                <Table.Column>Reason</Table.Column>
                <Table.Column>Ownership</Table.Column>
                <Table.Column className="flex justify-end">Actions</Table.Column>
              </Table.Header>
              <Table.Body>
                {loading ? (
                  <Table.Row key="loading-row" id="loading">
                    <Table.Cell colSpan={5}>
                      <div className="flex justify-center py-16">
                        <Spinner color="accent" size="sm" />
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ) : suppressions.length === 0 ? (
                  <Table.Row key="empty-row" id="empty">
                    <Table.Cell colSpan={5}>
                      <div className="flex flex-col items-center gap-3 py-16 text-center">
                        <SecurityLockIcon size={32} className="text-zinc-400 dark:text-zinc-600" />
                        <p className="text-sm text-zinc-500">
                          {searchQuery || statusFilter
                            ? 'No suppressions match your filters.'
                            : 'No suppressions found.'}
                        </p>
                        {!searchQuery && !statusFilter && (
                          <p className="text-xs text-zinc-400">
                            Suppressions allow you to acknowledge known vulnerabilities in a scan.
                          </p>
                        )}
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ) : (
                  suppressions.map((s) => (
                    <Table.Row id={s.id} key={s.id} className="hover:bg-[var(--row-hover)]">
                      <Table.Cell>
                        <div className="space-y-1.5">
                          <a
                            href={`https://nvd.nist.gov/vuln/detail/${s.vuln_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-xs text-accent hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {s.vuln_id}
                          </a>
                          <p className="font-mono text-xs text-muted" title={s.image_digest}>
                            {s.image_digest.length > 28
                              ? `${s.image_digest.slice(0, 28)}…`
                              : s.image_digest}
                          </p>
                          <Button
                            variant="tertiary"
                            onPress={() => openAppliesImagesModal(s)}
                            size="sm"
                          >
                            {(s.applies_image_count ?? 0).toLocaleString()} matching image
                            {(s.applies_image_count ?? 0) === 1 ? '' : 's'}
                          </Button>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="space-y-1.5">
                          <StatusBadge status={s.status} />
                          <SuppressionSourceBadge source={s.source} />
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="text-xs text-zinc-500 max-w-xs">
                          <span className="line-clamp-2">{s.justification || '—'}</span>
                          {(s.xray_policy_name || s.xray_watch_name) && (
                            <p className="mt-1 text-[11px] text-zinc-400">
                              {[s.xray_policy_name, s.xray_watch_name].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="space-y-1">
                          <p className="text-xs text-zinc-500">{s.username || '—'}</p>
                          <OwnershipBadge
                            ownerType={s.owner_type}
                            ownerOrgId={s.owner_org_id}
                            orgNamesById={orgNamesById}
                          />
                          <p className="text-xs text-muted" title={fullDate(s.created_at)}>
                            Created {timeAgo(s.created_at)}
                          </p>
                          {s.expires_at ? (
                            <span
                              className={
                                new Date(s.expires_at) < new Date()
                                  ? 'text-red-400'
                                  : 'text-zinc-500'
                              }
                              title={fullDate(s.expires_at)}
                            >
                              {new Date(s.expires_at).toLocaleDateString()}
                            </span>
                          ) : (
                            <span className="text-xs text-muted">Never expires</span>
                          )}
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        {canManageAccess(s) || canMutateSuppression(s) ? (
                          <div className="flex items-center justify-end">
                            <RowActionsMenu
                              label={`Actions for ${s.vuln_id}`}
                              items={[
                                ...(canManageAccess(s)
                                  ? [
                                      {
                                        id: 'manage-access',
                                        label: 'Manage access',
                                        icon: <Shield01Icon size={14} />,
                                        onAction: () => openShareModal(s),
                                      },
                                    ]
                                  : []),
                                ...(canMutateSuppression(s)
                                  ? [
                                      {
                                        id: 'remove',
                                        label: 'Remove suppression',
                                        icon: <Delete01Icon size={14} />,
                                        variant: 'danger' as const,
                                        onAction: () => {
                                          void handleDelete(s);
                                        },
                                      },
                                    ]
                                  : []),
                              ]}
                            />
                          </div>
                        ) : (
                          <span className="text-[11px] text-zinc-400">Read only</span>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  ))
                )}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
          {totalPages > 1 ? (
            <Table.Footer className="grid grid-cols-[1fr_auto_1fr] items-center px-4 py-3 gap-3">
              <span className="text-xs text-zinc-500 whitespace-nowrap">
                Showing {total === 0 ? 0 : (page - 1) * LIMIT + 1}-{Math.min(page * LIMIT, total)}{' '}
                of {total}
              </span>
              <Pagination size="sm" className="justify-self-center">
                <Pagination.Content>
                  <Pagination.Item>
                    <Pagination.Previous
                      isDisabled={page === 1}
                      onPress={() => setPage((previous) => Math.max(1, previous - 1))}
                    >
                      <Pagination.PreviousIcon />
                      <span>Previous</span>
                    </Pagination.Previous>
                  </Pagination.Item>
                  {paginationItems.map((item, index) =>
                    item === 'ellipsis' ? (
                      <Pagination.Item key={`suppressions-ellipsis-${index}`}>
                        <Pagination.Ellipsis />
                      </Pagination.Item>
                    ) : (
                      <Pagination.Item key={`suppressions-page-${item}`}>
                        <Pagination.Link isActive={item === page} onPress={() => setPage(item)}>
                          {item}
                        </Pagination.Link>
                      </Pagination.Item>
                    )
                  )}
                  <Pagination.Item>
                    <Pagination.Next
                      isDisabled={page === totalPages}
                      onPress={() => setPage((previous) => Math.min(totalPages, previous + 1))}
                    >
                      <span>Next</span>
                      <Pagination.NextIcon />
                    </Pagination.Next>
                  </Pagination.Item>
                </Pagination.Content>
              </Pagination>
              <div />
            </Table.Footer>
          ) : null}
        </Table>
      </Card>

      <ManageSuppressionAccessModal
        state={shareModal}
        target={shareTarget}
        shares={shares}
        loading={sharesLoading}
        error={shareError}
        saving={shareSaving}
        selectedOrgId={shareOrgId}
        onSelectedOrgIdChange={setShareOrgId}
        onGrant={() => {
          void handleGrantShare();
        }}
        onRevoke={(orgId) => {
          void handleRevokeShare(orgId);
        }}
        availableOrgTargets={availableShareTargets.map((org) => ({ id: org.id, name: org.name }))}
        orgNamesById={orgNamesById}
      />

      <Modal state={imagesModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="lg" placement="center">
            <Modal.Dialog className="surface-modal rounded-2xl overflow-hidden">
              <Modal.Header>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">
                  Applies to Images
                </Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="py-5 space-y-4">
                {imagesError ? (
                  <FormAlert description={imagesError} title="Images loading failed" />
                ) : null}
                <div className="flex flex-col gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">
                      Suppression
                    </p>
                  </div>
                  {imagesTarget ? (
                    <Card variant="secondary" className="py-3">
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                        {imagesTarget.vuln_id}
                      </p>
                      <p
                        className="font-mono text-xs text-zinc-500"
                        title={imagesTarget.image_digest}
                      >
                        {imagesTarget.image_digest.length > 64
                          ? `${imagesTarget.image_digest.slice(0, 64)}…`
                          : imagesTarget.image_digest}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {imagesTotal.toLocaleString()} matching image
                        {imagesTotal === 1 ? '' : 's'} in current workspace
                      </p>
                    </Card>
                  ) : null}
                </div>

                <Separator />

                <div className="flex flex-col gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">
                      Matching Images
                    </p>
                    <p className="text-xs text-zinc-500">
                      Images currently visible in this workspace for the suppression digest.
                    </p>
                  </div>

                  {imagesLoading ? (
                    <div className="flex justify-center py-8">
                      <div className="size-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-accent-500 animate-spin" />
                    </div>
                  ) : appliedImages.length === 0 ? (
                    <p className="text-sm text-zinc-500">No matching images were found.</p>
                  ) : (
                    <div className="max-h-[320px] overflow-y-auto flex flex-col gap-3">
                      {appliedImages.map((image) => (
                        <Card
                          key={`${image.image_name}:${image.image_tag}:${image.image_digest}`}
                          variant="secondary"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                                {image.image_name}:{image.image_tag}
                              </p>
                              <p
                                className="font-mono text-xs text-zinc-500 truncate"
                                title={image.image_digest}
                              >
                                {image.image_digest.length > 64
                                  ? `${image.image_digest.slice(0, 64)}…`
                                  : image.image_digest}
                              </p>
                              <p
                                className="text-[11px] text-zinc-400"
                                title={fullDate(image.latest_seen_at)}
                              >
                                Last seen: {timeAgo(image.latest_seen_at)}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="shrink-0"
                              isDisabled={!image.latest_scan_id}
                              onPress={() => {
                                if (!image.latest_scan_id) return;
                                imagesModal.close();
                                router.push(`/scans/${image.latest_scan_id}`);
                              }}
                            >
                              Open Scan
                            </Button>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button onPress={imagesModal.close} variant="secondary">
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
