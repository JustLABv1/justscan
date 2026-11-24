'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { ManageSuppressionAccessModal } from '@/components/suppressions/manage-suppression-access-modal';
import { useToast } from '@/components/toast';
import { OwnershipBadge, SuppressionSourceBadge } from '@/components/ui/badges';
import { FormAlert } from '@/components/ui/form-alert';
import { fieldSelectTriggerClassName } from '@/components/ui/form-styles';
import { LoadableCollectionState } from '@/components/ui/loadable-collection-state';
import { FilterChips } from '@/components/ui/filter-chips';
import { StatusLabel, type StatusDotTone } from '@/components/ui/status-dot';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { useClientAuth } from '@/hooks/use-client-auth';
import { useClientNow } from '@/hooks/use-client-now';
import { useOrgDirectory } from '@/hooks/use-org-name-map';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  deleteSuppressionById,
  listAllSuppressions,
  listSuppressionImages,
  listSuppressionShares,
  ResourceShare,
  shareSuppression,
  Suppression,
  SuppressionAppliedImage,
  transferSuppressionOwnership,
  unshareSuppression,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { canManageOrg, canMutateOrg } from '@/lib/org-permissions';
import { formatDateOnly, fullDate, timeAgo } from '@/lib/time';
import {
  Button,
  Card,
  Modal,
  ResourceList,
  SearchField,
  Separator,
  Spinner,
  Table,
  TablePager,
  useOverlayState,
} from '@/components/ui';
import { pluralize, shortDigest } from '@/lib/labels';
import { Copy01Icon, Delete01Icon, SecurityLockIcon, Shield01Icon } from 'hugeicons-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STATUS_LABEL: Record<string, string> = {
  accepted: 'Accepted risk',
  wont_fix: "Won't fix",
  false_positive: 'False positive',
  xray_ignore: 'Xray ignore rule',
};

function StatusBadge({ status }: { status: string }) {
  const tone: StatusDotTone =
    status === 'false_positive'
      ? 'success'
      : status === 'xray_ignore'
        ? 'warning'
        : status === 'accepted'
          ? 'accent'
          : 'neutral';
  return <StatusLabel tone={tone} label={STATUS_LABEL[status] ?? status} />;
}

/** A short digest with the full value on hover and a copy button. */
function DigestLine({ digest, label = 'Digest' }: { digest: string; label?: string }) {
  const toast = useToast();
  return (
    <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <span className="truncate" title={digest}>
        {label} <span className="font-mono">{shortDigest(digest)}</span>
      </span>
      <Button
        aria-label={`Copy ${label.toLowerCase()}`}
        className="shrink-0"
        size="icon-xs"
        variant="tertiary"
        onPress={() => {
          void navigator.clipboard
            .writeText(digest)
            .then(() => toast.success('Digest copied'))
            .catch(() => toast.error('Could not copy the digest'));
        }}
      >
        <Copy01Icon size={13} />
      </Button>
    </span>
  );
}

const LIMIT = 50;
const selectTriggerCls = fieldSelectTriggerClassName;

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
  const [transferOrgId, setTransferOrgId] = useState('');
  const [shareSaving, setShareSaving] = useState(false);
  const [imagesTarget, setImagesTarget] = useState<Suppression | null>(null);
  const [appliedImages, setAppliedImages] = useState<SuppressionAppliedImage[]>([]);
  const [imagesTotal, setImagesTotal] = useState(0);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imagesError, setImagesError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();
  const shareModal = useOverlayState();
  const imagesModal = useOverlayState();
  const now = useClientNow();
  const { isPlatformAdmin } = useClientAuth();
  const orgRoleById = useMemo(
    () => new Map(orgs.map((org) => [org.id, org.current_user_role] as const)),
    [orgs]
  );
  const manageableOrgIds = new Set(
    orgs.filter((org) => canManageOrg(org.current_user_role)).map((org) => org.id)
  );

  const load = useCallback(async (p: number, status: string, q: string) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const res = await listAllSuppressions(p, LIMIT, status || undefined, q || undefined);
      if (requestId !== requestIdRef.current) return;
      setSuppressions(res.data ?? []);
      setTotal(res.total);
    } catch (e: unknown) {
      if (requestId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load suppressions');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
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
    setTransferOrgId('');
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

  async function handleTransferOwnership() {
    if (
      !shareTarget ||
      !transferOrgId ||
      shareTarget.owner_type !== 'org' ||
      !canManageAccess(shareTarget)
    )
      return;
    const destination =
      orgs.find((org) => org.id === transferOrgId)?.name ?? 'the selected organization';
    const ok = await confirm({
      title: `Transfer suppression ownership to ${destination}?`,
      message:
        'The current owner will retain shared access and existing organization grants will remain.',
      confirmLabel: 'Transfer',
      variant: 'danger',
    });
    if (!ok) return;
    setShareSaving(true);
    setShareError('');
    try {
      await transferSuppressionOwnership(shareTarget.id, transferOrgId);
      toast.success('Suppression ownership transferred');
      shareModal.close();
      await load(page, statusFilter, searchQuery);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to transfer ownership');
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
    if (deletingId) return;
    setDeletingId(s.id);
    try {
      await deleteSuppressionById(s.id);
      toast.success(`Suppression for ${s.vuln_id} removed`);
      await load(page, statusFilter, searchQuery);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove suppression');
    } finally {
      setDeletingId(null);
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
  const transferTargets =
    shareTarget?.owner_type === 'org'
      ? orgs.filter(
          (org) =>
            (isPlatformAdmin || manageableOrgIds.has(org.id)) && org.id !== shareTarget.owner_org_id
        )
      : [];

  function selectStatus(id: string) {
    const value = id === 'all' ? '' : id;
    setStatusFilter(value);
    setPage(1);
    void load(1, value, searchQuery);
  }

  return (
    <PageContainer>
      <PageHeader
        title="Suppressions"
        description="Manage vulnerability suppressions across all images."
      />

      <>
        <Card className="gap-0 overflow-hidden py-0">
          <Card.Header className="space-y-3 border-b p-4">
            <FilterChips
              label="Filter suppressions by status"
              onSelect={selectStatus}
              items={[
                { id: 'all', label: 'All' },
                ...Object.entries(STATUS_LABEL).map(([id, label]) => ({ id, label })),
              ].map((option) => ({
                ...option,
                active: (statusFilter || 'all') === option.id,
              }))}
            >
              {pluralize(total, 'suppression')}
            </FilterChips>
            <SearchField name="suppressions-search" variant="secondary" className="w-full">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input
                  aria-label="Search suppressions by CVE ID"
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
          </Card.Header>
          <LoadableCollectionState
            emptyState={
              <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
                <SecurityLockIcon size={32} className="text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">
                  {searchQuery || statusFilter
                    ? 'No suppressions match your filters'
                    : 'No suppressions yet'}
                </p>
                <p className="max-w-md text-sm text-muted-foreground">
                  {searchQuery || statusFilter
                    ? 'Try another status or search term.'
                    : 'Suppress a finding from a scan to acknowledge a known vulnerability.'}
                </p>
                {searchQuery || statusFilter ? (
                  <Button
                    variant="secondary"
                    onPress={() => {
                      setSearchQuery('');
                      setStatusFilter('');
                      setPage(1);
                    }}
                  >
                    Clear filters
                  </Button>
                ) : null}
              </div>
            }
            error={error || undefined}
            errorTitle="Suppressions loading failed"
            isEmpty={suppressions.length === 0}
            loading={loading}
            loadingFallback={
              <div className="flex justify-center py-16" role="status">
                <Spinner size="sm" />
                <span className="sr-only">Loading suppressions</span>
              </div>
            }
            retry={() => void load(page, statusFilter, searchQuery)}
          >
            <div>
              <Table variant="secondary">
                <Table.Responsive>
                  <Table.ScrollContainer className="rounded-none border-0">
                    <Table.Content aria-label="Suppressions" className="[&_td]:py-3">
                      <Table.Header>
                        <Table.Column isRowHeader>Vulnerability</Table.Column>
                        <Table.Column className="hidden md:table-cell">Status</Table.Column>
                        <Table.Column>Reason</Table.Column>
                        <Table.Column className="w-px whitespace-nowrap text-right">
                          <span className="sr-only">Actions</span>
                        </Table.Column>
                      </Table.Header>
                      <Table.Body>
                        {suppressions.map((s) => {
                          const imageCount = s.applies_image_count ?? 0;
                          const expired =
                            s.expires_at !== null && now !== null && new Date(s.expires_at) < now;
                          return (
                            <Table.Row id={s.id} key={s.id}>
                              <Table.Cell data-label="Vulnerability">
                                <div className="flex min-w-0 flex-col items-start gap-1">
                                  <a
                                    href={`https://nvd.nist.gov/vuln/detail/${s.vuln_id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-mono text-sm font-medium text-primary hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {s.vuln_id}
                                  </a>
                                  <button
                                    type="button"
                                    className="text-left text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
                                    onClick={() => openAppliesImagesModal(s)}
                                    title={
                                      s.image_digest
                                        ? `Image digest ${shortDigest(s.image_digest)}`
                                        : undefined
                                    }
                                  >
                                    Applies to {pluralize(imageCount, 'image')}
                                  </button>
                                </div>
                              </Table.Cell>
                              <Table.Cell data-label="Status" className="hidden md:table-cell">
                                <div className="flex flex-col items-start gap-1.5">
                                  <StatusBadge status={s.status} />
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <SuppressionSourceBadge source={s.source} />
                                    <OwnershipBadge
                                      ownerType={s.owner_type}
                                      ownerOrgId={s.owner_org_id}
                                      orgNamesById={orgNamesById}
                                    />
                                  </div>
                                </div>
                              </Table.Cell>
                              <Table.Cell data-label="Reason">
                                <div className="max-w-xl space-y-1 text-sm">
                                  <p
                                    className="line-clamp-2 text-foreground"
                                    title={s.justification || undefined}
                                  >
                                    {s.justification || 'No reason given'}
                                  </p>
                                  {s.xray_policy_name || s.xray_watch_name ? (
                                    <p className="text-xs text-muted-foreground">
                                      {[s.xray_policy_name, s.xray_watch_name]
                                        .filter(Boolean)
                                        .join(' · ')}
                                    </p>
                                  ) : null}
                                  <p className="text-xs text-muted-foreground">
                                    {s.username ? `${s.username} · ` : ''}
                                    <span title={fullDate(s.created_at)}>
                                      Added {timeAgo(s.created_at)}
                                    </span>
                                    {' · '}
                                    {s.expires_at ? (
                                      <span
                                        className={expired ? 'text-destructive' : undefined}
                                        title={fullDate(s.expires_at)}
                                      >
                                        {expired ? 'Expired' : 'Expires'}{' '}
                                        {formatDateOnly(s.expires_at)}
                                      </span>
                                    ) : (
                                      'Never expires'
                                    )}
                                  </p>
                                </div>
                              </Table.Cell>
                              <Table.Cell data-label="Actions">
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
                                                pending: deletingId === s.id,
                                                disabled:
                                                  deletingId !== null && deletingId !== s.id,
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
                                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                                    Read only
                                  </span>
                                )}
                              </Table.Cell>
                            </Table.Row>
                          );
                        })}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table.Responsive>
                <TablePager
                  page={page}
                  pageSize={LIMIT}
                  total={total}
                  onPageChange={setPage}
                  noun="suppressions"
                />
              </Table>
            </div>
          </LoadableCollectionState>
        </Card>
      </>

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
        transferTargets={transferTargets.map((org) => ({ id: org.id, name: org.name }))}
        transferOrgId={transferOrgId}
        onTransferOrgIdChange={setTransferOrgId}
        onTransfer={() => void handleTransferOwnership()}
        orgNamesById={orgNamesById}
      />

      <Modal state={imagesModal}>
        <Modal.Backdrop isDismissable={false}>
          <Modal.Container size="lg" placement="center">
            <Modal.Dialog className="surface-modal overflow-hidden">
              <Modal.Header>
                <Modal.Heading className="font-semibold text-foreground">
                  Matching images
                </Modal.Heading>
                <Modal.CloseTrigger className="text-muted-foreground hover:text-foreground" />
              </Modal.Header>
              <Modal.Body className="py-5 space-y-4">
                {imagesError ? (
                  <FormAlert description={imagesError} title="Images loading failed" />
                ) : null}
                {imagesTarget ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">{imagesTarget.vuln_id}</p>
                    <p className="text-sm text-muted-foreground">
                      {imagesLoading
                        ? 'Looking for matching images…'
                        : `${pluralize(imagesTotal, 'image')} in this workspace match this suppression.`}
                    </p>
                    {imagesTarget.image_digest ? (
                      <DigestLine digest={imagesTarget.image_digest} label="Suppression digest" />
                    ) : null}
                  </div>
                ) : null}

                <Separator />

                <div className="flex flex-col gap-2">
                  {imagesLoading ? (
                    <div className="flex justify-center py-8" role="status">
                      <Spinner size="sm" />
                      <span className="sr-only">Loading matching images</span>
                    </div>
                  ) : imagesError ? (
                    <div className="flex flex-col items-center gap-3 py-8 text-center">
                      <p className="text-sm text-muted-foreground">
                        Could not load matching images.
                      </p>
                      <Button
                        variant="secondary"
                        isPending={imagesLoading}
                        onPress={() => {
                          if (imagesTarget) void loadAppliedImages(imagesTarget.id);
                        }}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : appliedImages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No matching images were found.</p>
                  ) : (
                    <ResourceList className="max-h-80 overflow-y-auto">
                      {appliedImages.map((image) => (
                        <ResourceList.Item
                          key={`${image.image_name}:${image.image_tag}:${image.image_digest}`}
                          title={`${image.image_name}:${image.image_tag}`}
                          description={
                            <span title={fullDate(image.latest_seen_at)}>
                              Last seen {timeAgo(image.latest_seen_at)}
                            </span>
                          }
                          actions={
                            <Button
                              size="sm"
                              variant="secondary"
                              isDisabled={!image.latest_scan_id}
                              onPress={() => {
                                if (!image.latest_scan_id) return;
                                imagesModal.close();
                                router.push(`/scans/details/${image.latest_scan_id}`);
                              }}
                            >
                              Open scan
                            </Button>
                          }
                        >
                          {image.image_digest ? <DigestLine digest={image.image_digest} /> : null}
                        </ResourceList.Item>
                      ))}
                    </ResourceList>
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
    </PageContainer>
  );
}
