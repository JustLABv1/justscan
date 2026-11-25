'use client';

import Link from 'next/link';
import { SeverityCounts, StatusBadge } from '@/components/ui/badges';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { useToast } from '@/components/toast';
import { VISIBILITY_LABELS, labelFor, splitImageRef } from '@/lib/labels';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { StatusAlert } from '@/components/ui/form-alert';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { listAdminScans } from '@/lib/api/admin';
import { cancelScan, createShare, deleteShare, reScan } from '@/lib/api/scans';
import { addTagToScan, listTags } from '@/lib/api/tags';
import type { Tag } from '@/lib/api/types/scans';
import type { AdminScan } from '@/lib/api/types/scans';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';
import {
  Button,
  Card,
  ListBox,
  Modal,
  SearchField,
  Select,
  ResourceList,
  Table,
  TablePager,
  useOverlayState,
} from '@/components/ui';
import {
  Cancel01Icon,
  CopyLinkIcon,
  Delete01Icon,
  Refresh01Icon,
  Share01Icon,
  Tag01Icon,
} from 'hugeicons-react';
import { useCallback, useEffect, useState } from 'react';

const PAGE_SIZE = 20;

async function copyToClipboard(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export function ScansTab() {
  const [scans, setScans] = useState<AdminScan[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const toast = useToast();
  const [imageFilter, setImageFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'completed' | 'running' | 'pending' | 'failed'
  >('all');
  const [page, setPage] = useState(1);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [selectedTagId, setSelectedTagId] = useState('');
  const [tagScan, setTagScan] = useState<AdminScan | null>(null);
  const tagModal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await listAdminScans(
        page,
        PAGE_SIZE,
        imageFilter || undefined,
        statusFilter === 'all' ? undefined : statusFilter,
        undefined,
        ownerFilter || undefined
      );
      setScans(response.data ?? []);
      setTotal(response.total ?? 0);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load scans');
    } finally {
      setLoading(false);
    }
  }, [imageFilter, ownerFilter, page, statusFilter]);

  useEffect(() => deferEffect(load), [load]);

  useEffect(() => {
    listTags()
      .then((tags) => {
        setAvailableTags(tags);
        if (tags.length > 0) setSelectedTagId(tags[0].id);
      })
      .catch(() => setAvailableTags([]));
  }, []);

  async function refreshCurrentPage() {
    await load();
  }

  async function handleRescan(scan: AdminScan) {
    setActionLoadingId(`${scan.id}:rescan`);
    try {
      await reScan(scan.id);
      toast.success(`Queued rescan for ${scan.image_name}:${scan.image_tag}.`);
      await refreshCurrentPage();
    } catch (actionError: unknown) {
      toast.error(actionError instanceof Error ? actionError.message : 'Failed to queue rescan');
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleCancel(scan: AdminScan) {
    const ok = await confirm({
      title: `Cancel ${scan.image_name}:${scan.image_tag}?`,
      message: 'The running or pending scan will be marked as cancelled.',
      confirmLabel: 'Cancel scan',
      variant: 'warning',
    });
    if (!ok) return;

    setActionLoadingId(`${scan.id}:cancel`);
    try {
      await cancelScan(scan.id);
      toast.success(`Cancelled ${scan.image_name}:${scan.image_tag}.`);
      await refreshCurrentPage();
    } catch (actionError: unknown) {
      toast.error(actionError instanceof Error ? actionError.message : 'Failed to cancel scan');
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleCreateShare(scan: AdminScan) {
    setActionLoadingId(`${scan.id}:share`);
    try {
      const result = await createShare(scan.id, 'public');
      await copyToClipboard(`${window.location.origin}/shared/${result.share_token}`);
      toast.success(`Share link copied for ${scan.image_name}:${scan.image_tag}.`);
      await refreshCurrentPage();
    } catch (actionError: unknown) {
      toast.error(
        actionError instanceof Error ? actionError.message : 'Failed to create share link'
      );
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleCopyShare(scan: AdminScan) {
    if (!scan.share_token) return;
    try {
      await copyToClipboard(`${window.location.origin}/shared/${scan.share_token}`);
      toast.success(`Copied share link for ${scan.image_name}:${scan.image_tag}.`);
    } catch (copyError: unknown) {
      toast.error(copyError instanceof Error ? copyError.message : 'Failed to copy share link');
    }
  }

  async function handleRevokeShare(scan: AdminScan) {
    const ok = await confirm({
      title: `Revoke share for ${scan.image_name}:${scan.image_tag}?`,
      message: 'The existing shared link will stop working immediately.',
      confirmLabel: 'Revoke share',
      variant: 'danger',
    });
    if (!ok) return;

    setActionLoadingId(`${scan.id}:revoke`);
    try {
      await deleteShare(scan.id);
      toast.success(`Revoked share link for ${scan.image_name}:${scan.image_tag}.`);
      await refreshCurrentPage();
    } catch (actionError: unknown) {
      toast.error(
        actionError instanceof Error ? actionError.message : 'Failed to revoke share link'
      );
    } finally {
      setActionLoadingId(null);
    }
  }

  function openTagModal(scan: AdminScan) {
    setTagScan(scan);
    setSelectedTagId(availableTags[0]?.id ?? '');
    tagModal.open();
  }

  async function handleAddTag(event: React.FormEvent) {
    event.preventDefault();
    if (!tagScan || !selectedTagId) return;

    setActionLoadingId(`${tagScan.id}:tag`);
    try {
      await addTagToScan(tagScan.id, selectedTagId);
      tagModal.close();
      toast.success(`Added tag to ${tagScan.image_name}:${tagScan.image_tag}.`);
      await refreshCurrentPage();
    } catch (actionError: unknown) {
      toast.error(actionError instanceof Error ? actionError.message : 'Failed to add tag');
    } finally {
      setActionLoadingId(null);
    }
  }

  const statusSelect = (
    <Select
      aria-label="Scan status"
      value={statusFilter}
      onChange={(value) => {
        setStatusFilter(String(value) as typeof statusFilter);
        setPage(1);
      }}
      variant="secondary"
      className="sm:w-44"
    >
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="all">All statuses</ListBox.Item>
          <ListBox.Item id="completed">Completed</ListBox.Item>
          <ListBox.Item id="running">Running</ListBox.Item>
          <ListBox.Item id="pending">Queued</ListBox.Item>
          <ListBox.Item id="failed">Failed</ListBox.Item>
        </ListBox>
      </Select.Popover>
    </Select>
  );

  return (
    <div className="space-y-4">
      {error ? (
        <StatusAlert status="danger" title="Scans failed to load" description={error} />
      ) : null}

      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b border-border p-4">
          <FilterToolbar
            search={
              <div className="grid gap-2 sm:grid-cols-2">
                <SearchField
                  aria-label="Filter by image"
                  name="admin-scans-image-search"
                  variant="secondary"
                  value={imageFilter}
                  onChange={(value) => {
                    setImageFilter(value);
                    setPage(1);
                  }}
                >
                  <SearchField.Group>
                    <SearchField.SearchIcon />
                    <SearchField.Input placeholder="Filter by image..." />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>
                <SearchField
                  aria-label="Filter by owner"
                  name="admin-scans-owner-search"
                  variant="secondary"
                  value={ownerFilter}
                  onChange={(value) => {
                    setOwnerFilter(value);
                    setPage(1);
                  }}
                >
                  <SearchField.Group>
                    <SearchField.SearchIcon />
                    <SearchField.Input placeholder="Filter by owner..." />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>
              </div>
            }
            filters={statusSelect}
          />
        </div>

        <Table.Responsive
          cards={
            <ResourceList aria-label="Admin scans" bordered={false}>
              {!scans.length && (
                <li className="p-4 text-sm text-muted-foreground">
                  {loading ? 'Loading scans…' : 'No scans match your filters.'}
                </li>
              )}
              {scans.map((scan) => {
                const reference = `${scan.image_name}:${scan.image_tag}`;
                const { host, name } = splitImageRef(scan.image_name);
                return (
                  <ResourceList.Item
                    key={scan.id}
                    title={`${name}:${scan.image_tag}`}
                    titleTooltip={reference}
                    href={`/scans/details/${scan.id}`}
                    description={host}
                    meta={
                      <StatusBadge
                        status={scan.status}
                        externalStatus={scan.external_status}
                        currentStep={scan.current_step}
                      />
                    }
                    actions={
                      <RowActionsMenu
                        label={`Open actions for ${reference}`}
                        items={[
                          {
                            id: 'rescan',
                            label: 'Rescan',
                            icon: <Refresh01Icon size={15} />,
                            pending: actionLoadingId === `${scan.id}:rescan`,
                            onAction: () => {
                              void handleRescan(scan);
                            },
                          },
                          ...(scan.status === 'pending' || scan.status === 'running'
                            ? [
                                {
                                  id: 'cancel',
                                  label: 'Cancel',
                                  icon: <Cancel01Icon size={15} />,
                                  onAction: () => {
                                    void handleCancel(scan);
                                  },
                                },
                              ]
                            : []),
                          ...(!scan.share_token
                            ? [
                                {
                                  id: 'share',
                                  label: 'Create share link',
                                  icon: <Share01Icon size={15} />,
                                  onAction: () => {
                                    void handleCreateShare(scan);
                                  },
                                },
                              ]
                            : [
                                {
                                  id: 'copy-share',
                                  label: 'Copy share link',
                                  icon: <CopyLinkIcon size={15} />,
                                  onAction: () => {
                                    void handleCopyShare(scan);
                                  },
                                },
                                {
                                  id: 'revoke-share',
                                  label: 'Revoke share link',
                                  icon: <Delete01Icon size={15} />,
                                  variant: 'danger' as const,
                                  onAction: () => {
                                    void handleRevokeShare(scan);
                                  },
                                },
                              ]),
                          {
                            id: 'tag',
                            label: 'Add tag',
                            icon: <Tag01Icon size={15} />,
                            onAction: () => openTagModal(scan),
                          },
                        ]}
                      />
                    }
                  >
                    <SeverityCounts
                      critical={scan.critical_count || 0}
                      high={scan.high_count || 0}
                      medium={scan.medium_count || 0}
                      low={scan.low_count || 0}
                      emptyLabel={scan.status === 'completed' ? 'No findings' : '—'}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {scan.owner_email || scan.owner_username || 'Public visitor'} ·{' '}
                      {fullDate(scan.created_at)}
                    </p>
                    {scan.share_token && (
                      <p className="text-xs text-muted-foreground">
                        Shared · {labelFor(VISIBILITY_LABELS, scan.share_visibility || 'public')}
                      </p>
                    )}
                  </ResourceList.Item>
                );
              })}
            </ResourceList>
          }
        >
          <Table variant="secondary">
            <Table.ScrollContainer className="rounded-none border-0">
              <Table.Content aria-label="Admin scans" aria-busy={loading}>
                <Table.Header>
                  <Table.Column isRowHeader className="px-4">
                    Image
                  </Table.Column>
                  <Table.Column>Status</Table.Column>
                  <Table.Column>Findings</Table.Column>
                  <Table.Column className="hidden md:table-cell">Owner</Table.Column>
                  <Table.Column className="hidden md:table-cell">Created</Table.Column>
                  <Table.Column className="px-4 text-right">
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      {loading ? 'Loading scans...' : 'No scans match your filters.'}
                    </div>
                  )}
                >
                  {scans.map((scan) => {
                    const reference = `${scan.image_name}:${scan.image_tag}`;
                    const { host, name } = splitImageRef(scan.image_name);
                    return (
                      <Table.Row key={scan.id} id={scan.id}>
                        <Table.Cell className="max-w-0 px-4 sm:w-[40%]">
                          <div className="min-w-0">
                            <Link
                              href={`/scans/details/${scan.id}`}
                              className="block truncate font-medium text-foreground hover:underline"
                              title={reference}
                            >
                              {name}
                              <span className="text-muted-foreground">:{scan.image_tag}</span>
                            </Link>
                            {host ? (
                              <p className="truncate text-xs text-muted-foreground" title={host}>
                                {host}
                              </p>
                            ) : null}
                            {scan.share_token ? (
                              <p className="text-xs text-muted-foreground">
                                Shared ·{' '}
                                {labelFor(VISIBILITY_LABELS, scan.share_visibility || 'public')}
                              </p>
                            ) : null}
                          </div>
                        </Table.Cell>
                        <Table.Cell className="whitespace-nowrap">
                          <StatusBadge
                            status={scan.status}
                            externalStatus={scan.external_status}
                            currentStep={scan.current_step}
                          />
                        </Table.Cell>
                        <Table.Cell>
                          <SeverityCounts
                            critical={scan.critical_count || 0}
                            high={scan.high_count || 0}
                            medium={scan.medium_count || 0}
                            low={scan.low_count || 0}
                            emptyLabel={scan.status === 'completed' ? 'No findings' : '—'}
                          />
                        </Table.Cell>
                        <Table.Cell className="hidden max-w-48 md:table-cell">
                          <span
                            className="block truncate text-muted-foreground"
                            title={scan.owner_email || undefined}
                          >
                            {scan.owner_email || scan.owner_username || 'Public visitor'}
                          </span>
                        </Table.Cell>
                        <Table.Cell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                          <span title={fullDate(scan.created_at)}>{timeAgo(scan.created_at)}</span>
                        </Table.Cell>
                        <Table.Cell className="px-4">
                          <div className="flex justify-end">
                            <RowActionsMenu
                              label={`Open actions for ${reference}`}
                              items={[
                                {
                                  id: 'rescan',
                                  label: 'Rescan',
                                  icon: <Refresh01Icon size={15} />,
                                  pending: actionLoadingId === `${scan.id}:rescan`,
                                  onAction: () => {
                                    void handleRescan(scan);
                                  },
                                },
                                ...(scan.status === 'pending' || scan.status === 'running'
                                  ? [
                                      {
                                        id: 'cancel',
                                        label: 'Cancel',
                                        icon: <Cancel01Icon size={15} />,
                                        onAction: () => {
                                          void handleCancel(scan);
                                        },
                                      },
                                    ]
                                  : []),
                                ...(!scan.share_token
                                  ? [
                                      {
                                        id: 'share',
                                        label: 'Create share link',
                                        icon: <Share01Icon size={15} />,
                                        onAction: () => {
                                          void handleCreateShare(scan);
                                        },
                                      },
                                    ]
                                  : [
                                      {
                                        id: 'copy-share',
                                        label: 'Copy share link',
                                        icon: <CopyLinkIcon size={15} />,
                                        onAction: () => {
                                          void handleCopyShare(scan);
                                        },
                                      },
                                      {
                                        id: 'revoke-share',
                                        label: 'Revoke share link',
                                        icon: <Delete01Icon size={15} />,
                                        variant: 'danger' as const,
                                        onAction: () => {
                                          void handleRevokeShare(scan);
                                        },
                                      },
                                    ]),
                                {
                                  id: 'tag',
                                  label: 'Add tag',
                                  icon: <Tag01Icon size={15} />,
                                  onAction: () => openTagModal(scan),
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
        </Table.Responsive>
        <TablePager
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={setPage}
          noun="scans"
        />
      </Card>

      <Modal state={tagModal}>
        <Modal.Backdrop isDismissable={false}>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <div className="flex min-w-0 items-center gap-3">
                  <Modal.Icon className="bg-default text-foreground">
                    <Tag01Icon size={18} />
                  </Modal.Icon>
                  <Modal.Heading>Add tag</Modal.Heading>
                </div>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body>
                <form id="add-tag-form" onSubmit={handleAddTag} className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Assign a tag to{' '}
                    {tagScan ? `${tagScan.image_name}:${tagScan.image_tag}` : 'this scan'}.
                  </p>
                  <Select
                    aria-label="Tag"
                    value={selectedTagId}
                    onChange={(value) => setSelectedTagId(String(value))}
                    variant="secondary"
                  >
                    <Select.Trigger>
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-muted-foreground shrink-0">
                          <Tag01Icon size={15} />
                        </span>
                        <Select.Value />
                      </div>
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {availableTags.map((tag) => (
                          <ListBox.Item key={tag.id} id={tag.id}>
                            {tag.name}
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </form>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" onPress={tagModal.close}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="add-tag-form"
                  variant="primary"
                  isDisabled={!selectedTagId || actionLoadingId === `${tagScan?.id}:tag`}
                >
                  Add tag
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
