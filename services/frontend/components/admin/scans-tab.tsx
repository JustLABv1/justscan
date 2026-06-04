'use client';

import { useConfirmDialog } from '@/components/confirm-dialog';
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
  Chip,
  ListBox,
  Modal,
  Pagination,
  SearchField,
  Select,
  Table,
  useOverlayState,
} from '@heroui/react';
import {
  Cancel01Icon,
  CopyLinkIcon,
  Delete01Icon,
  Refresh01Icon,
  Share01Icon,
  Tag01Icon,
} from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [imageFilter, setImageFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'running' | 'pending' | 'failed'>('all');
  const [page, setPage] = useState(1);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [selectedTagId, setSelectedTagId] = useState('');
  const [tagScan, setTagScan] = useState<AdminScan | null>(null);
  const tagModal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  function statusColor(status: string): 'success' | 'warning' | 'danger' | 'default' {
    if (status === 'completed') return 'success';
    if (status === 'running' || status === 'pending') return 'warning';
    if (status === 'failed') return 'danger';
    return 'default';
  }

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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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

  async function refreshCurrentPage() {
    await load();
  }

  async function handleRescan(scan: AdminScan) {
    setActionLoadingId(`${scan.id}:rescan`);
    setFeedback(null);
    try {
      await reScan(scan.id);
      setFeedback({ type: 'success', text: `Queued rescan for ${scan.image_name}:${scan.image_tag}.` });
      await refreshCurrentPage();
    } catch (actionError: unknown) {
      setFeedback({
        type: 'error',
        text: actionError instanceof Error ? actionError.message : 'Failed to queue rescan',
      });
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
      setFeedback({ type: 'success', text: `Cancelled ${scan.image_name}:${scan.image_tag}.` });
      await refreshCurrentPage();
    } catch (actionError: unknown) {
      setFeedback({
        type: 'error',
        text: actionError instanceof Error ? actionError.message : 'Failed to cancel scan',
      });
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleCreateShare(scan: AdminScan) {
    setActionLoadingId(`${scan.id}:share`);
    try {
      const result = await createShare(scan.id, 'public');
      await copyToClipboard(`${window.location.origin}/shared/${result.share_token}`);
      setFeedback({ type: 'success', text: `Share link copied for ${scan.image_name}:${scan.image_tag}.` });
      await refreshCurrentPage();
    } catch (actionError: unknown) {
      setFeedback({
        type: 'error',
        text: actionError instanceof Error ? actionError.message : 'Failed to create share link',
      });
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleCopyShare(scan: AdminScan) {
    if (!scan.share_token) return;
    try {
      await copyToClipboard(`${window.location.origin}/shared/${scan.share_token}`);
      setFeedback({ type: 'success', text: `Copied share link for ${scan.image_name}:${scan.image_tag}.` });
    } catch (copyError: unknown) {
      setFeedback({
        type: 'error',
        text: copyError instanceof Error ? copyError.message : 'Failed to copy share link',
      });
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
      setFeedback({ type: 'success', text: `Revoked share link for ${scan.image_name}:${scan.image_tag}.` });
      await refreshCurrentPage();
    } catch (actionError: unknown) {
      setFeedback({
        type: 'error',
        text: actionError instanceof Error ? actionError.message : 'Failed to revoke share link',
      });
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
      setFeedback({ type: 'success', text: `Added tag to ${tagScan.image_name}:${tagScan.image_tag}.` });
      await refreshCurrentPage();
    } catch (actionError: unknown) {
      setFeedback({
        type: 'error',
        text: actionError instanceof Error ? actionError.message : 'Failed to add tag',
      });
    } finally {
      setActionLoadingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <Card className="border border-danger/30 bg-danger/10">
          <Card.Content>
            <p className="text-sm text-danger">{error}</p>
          </Card.Content>
        </Card>
      )}

      {feedback && (
        <Card className={feedback.type === 'success' ? 'border border-success/30 bg-success/10' : 'border border-danger/30 bg-danger/10'}>
          <Card.Content>
            <p className={feedback.type === 'success' ? 'text-sm text-success' : 'text-sm text-danger'}>{feedback.text}</p>
          </Card.Content>
        </Card>
      )}

      <Card className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid w-full gap-2 sm:grid-cols-3">
            <SearchField name="admin-scans-image-search" variant="secondary">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input
                  placeholder="Filter by image..."
                  value={imageFilter}
                  onChange={(event) => {
                    setImageFilter(event.target.value);
                    setPage(1);
                  }}
                />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <SearchField name="admin-scans-owner-search" variant="secondary">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input
                  placeholder="Filter by owner..."
                  value={ownerFilter}
                  onChange={(event) => {
                    setOwnerFilter(event.target.value);
                    setPage(1);
                  }}
                />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <Select
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(String(value) as typeof statusFilter);
                setPage(1);
              }}
              variant="secondary"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="all">All status</ListBox.Item>
                  <ListBox.Item id="completed">Completed</ListBox.Item>
                  <ListBox.Item id="running">Running</ListBox.Item>
                  <ListBox.Item id="pending">Pending</ListBox.Item>
                  <ListBox.Item id="failed">Failed</ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
        </div>

        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label="Admin scans" className="min-w-[1200px]">
              <Table.Header>
                <Table.Column isRowHeader>Image</Table.Column>
                <Table.Column>Status</Table.Column>
                <Table.Column>C</Table.Column>
                <Table.Column>H</Table.Column>
                <Table.Column>M</Table.Column>
                <Table.Column>L</Table.Column>
                <Table.Column>Owner</Table.Column>
                <Table.Column>Share</Table.Column>
                <Table.Column>Date</Table.Column>
                <Table.Column className="text-right">Actions</Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <div className="py-10 text-center text-sm text-zinc-500">
                    {loading ? 'Loading scans...' : 'No scans match your filters.'}
                  </div>
                )}
              >
                {scans.map((scan) => (
                  <Table.Row key={scan.id} id={scan.id} className="hover:bg-[var(--row-hover)]">
                    <Table.Cell className="font-mono text-xs">
                      {scan.image_name}:{scan.image_tag}
                    </Table.Cell>
                    <Table.Cell>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={statusColor(scan.status)}
                        className="capitalize"
                      >
                        {scan.status}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell className="font-mono text-xs text-red-400">{scan.critical_count || 0}</Table.Cell>
                    <Table.Cell className="font-mono text-xs text-orange-400">{scan.high_count || 0}</Table.Cell>
                    <Table.Cell className="font-mono text-xs text-yellow-400">{scan.medium_count || 0}</Table.Cell>
                    <Table.Cell className="font-mono text-xs text-blue-400">{scan.low_count || 0}</Table.Cell>
                    <Table.Cell className="text-xs text-zinc-500">{scan.owner_email || 'anonymous'}</Table.Cell>
                    <Table.Cell className="text-xs text-zinc-500">{scan.share_token ? scan.share_visibility || 'shared' : 'private'}</Table.Cell>
                    <Table.Cell className="text-xs text-zinc-500">
                      <span title={fullDate(scan.created_at)}>{timeAgo(scan.created_at)}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex justify-end">
                        <RowActionsMenu
                          label={`Open actions for ${scan.image_name}:${scan.image_tag}`}
                          items={[
                            {
                              id: 'rescan',
                              label: 'Rescan',
                              icon: <Refresh01Icon size={15} />,
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
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
          <Table.Footer className="grid grid-cols-[1fr_auto_1fr] items-center px-4 py-3 gap-3">
            <span className="text-xs text-zinc-500 whitespace-nowrap">
              Showing {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} of {total}
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
                    <Pagination.Item key={`scans-ellipsis-${index}`}>
                      <Pagination.Ellipsis />
                    </Pagination.Item>
                  ) : (
                    <Pagination.Item key={`scans-page-${item}`}>
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
        </Table>
      </Card>

      <Modal state={tagModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <div className="flex min-w-0 items-center gap-3">
                  <Modal.Icon className="bg-default text-foreground">
                    <Tag01Icon size={18} />
                  </Modal.Icon>
                  <Modal.Heading>Add Tag</Modal.Heading>
                </div>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body>
                <form id="add-tag-form" onSubmit={handleAddTag} className="space-y-4">
                  <p className="text-sm text-zinc-500">
                    Assign a tag to {tagScan ? `${tagScan.image_name}:${tagScan.image_tag}` : 'this scan'}.
                  </p>
                  <Select value={selectedTagId} onChange={(value) => setSelectedTagId(String(value))} variant="secondary">
                    <Select.Trigger>
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-zinc-400 shrink-0">
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
                <Button variant="secondary" onPress={tagModal.close}>Cancel</Button>
                <Button
                  type="submit"
                  form="add-tag-form"
                  variant="primary"
                  isDisabled={!selectedTagId || actionLoadingId === `${tagScan?.id}:tag`}
                >
                  Add Tag
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
