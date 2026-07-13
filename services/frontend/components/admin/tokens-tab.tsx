'use client';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { StatusAlert } from '@/components/ui/form-alert';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { deleteAdminToken, listAdminTokens, updateAdminToken } from '@/lib/api/admin';
import type { AdminToken } from '@/lib/api/types/admin';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';
import {
  Button,
  Card,
  Chip,
  Input,
  ListBox,
  Modal,
  Pagination,
  SearchField,
  Select,
  Table,
  TextArea,
  useOverlayState,
} from '@heroui/react';
import { Delete01Icon, PencilEdit01Icon, Refresh01Icon } from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

const PAGE_SIZE = 10;

export function TokensTab() {
  const [tokens, setTokens] = useState<AdminToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingToken, setEditingToken] = useState<AdminToken | null>(null);
  const [description, setDescription] = useState('');
  const [disabledReason, setDisabledReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const [page, setPage] = useState(1);
  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setTokens(await listAdminTokens());
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load tokens');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    return deferEffect(load);
  }, [load]);

  function openEdit(token: AdminToken) {
    setEditingToken(token);
    setDescription(token.description ?? '');
    setDisabledReason(token.disabled_reason ?? '');
    modal.open();
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!editingToken) return;
    setSaving(true);
    try {
      await updateAdminToken(editingToken.id, {
        description,
        disabled: editingToken.disabled,
        disabled_reason: disabledReason,
      });
      modal.close();
      await load();
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update token');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(token: AdminToken) {
    const nextDisabled = !token.disabled;
    const confirmed = await confirm(
      nextDisabled
        ? {
            title: `Disable token "${token.description || token.id.slice(0, 8)}"?`,
            message: 'The token will stop working immediately.',
            confirmLabel: 'Disable',
            variant: 'warning',
          }
        : {
            title: `Re-enable token "${token.description || token.id.slice(0, 8)}"?`,
            message: 'The token will become valid again immediately.',
            confirmLabel: 'Enable',
            variant: 'default',
          }
    );
    if (!confirmed) return;

    try {
      await updateAdminToken(token.id, {
        description: token.description,
        disabled: nextDisabled,
        disabled_reason: nextDisabled ? token.disabled_reason || 'Disabled by admin' : '',
      });
      await load();
    } catch (toggleError: unknown) {
      setError(toggleError instanceof Error ? toggleError.message : 'Failed to update token');
    }
  }

  async function handleDelete(token: AdminToken) {
    const confirmed = await confirm({
      title: `Delete token "${token.description || token.id.slice(0, 8)}"?`,
      message: 'This cannot be undone. Any service using the token will stop authenticating.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await deleteAdminToken(token.id);
      await load();
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete token');
    }
  }

  const filteredTokens = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tokens.filter((token) => {
      const matchesSearch =
        q.length === 0 ||
        (token.description ?? '').toLowerCase().includes(q) ||
        token.type.toLowerCase().includes(q) ||
        token.key.toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && !token.disabled) ||
        (statusFilter === 'disabled' && token.disabled);
      return matchesSearch && matchesStatus;
    });
  }, [tokens, searchQuery, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredTokens.length / PAGE_SIZE));
  const effectivePage = Math.min(page, totalPages);
  const pagedTokens = filteredTokens.slice((effectivePage - 1) * PAGE_SIZE, effectivePage * PAGE_SIZE);

  const paginationItems = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const items: Array<number | 'ellipsis'> = [1];
    if (effectivePage > 3) items.push('ellipsis');
    const start = Math.max(2, effectivePage - 1);
    const end = Math.min(totalPages - 1, effectivePage + 1);
    for (let i = start; i <= end; i += 1) items.push(i);
    if (effectivePage < totalPages - 2) items.push('ellipsis');
    items.push(totalPages);
    return items;
  }, [effectivePage, totalPages]);

  return (
    <div className="space-y-4">
      {error ? <StatusAlert status="danger" title="Tokens failed to load" description={error} /> : null}

      <Card className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <SearchField name="admin-tokens-search" variant="secondary" className="w-full sm:max-w-sm">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                placeholder="Filter tokens by description, type, or key..."
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setPage(1);
                }}
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <Select
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(String(value) as 'all' | 'active' | 'disabled');
              setPage(1);
            }}
            variant="secondary"
            className="w-full sm:w-36"
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="all">All status</ListBox.Item>
                <ListBox.Item id="active">Active</ListBox.Item>
                <ListBox.Item id="disabled">Disabled</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </div>

        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label="Admin tokens" className="min-w-[980px]">
              <Table.Header>
                <Table.Column isRowHeader>Description</Table.Column>
                <Table.Column>Type</Table.Column>
                <Table.Column>Key</Table.Column>
                <Table.Column>Expires</Table.Column>
                <Table.Column>Status</Table.Column>
                <Table.Column className="text-right">Actions</Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <div className="py-10 text-center text-sm text-zinc-500">
                    {loading ? 'Loading tokens...' : 'No tokens match your filters.'}
                  </div>
                )}
              >
                {pagedTokens.map((token) => (
                  <Table.Row key={token.id} id={token.id} className="hover:bg-[var(--row-hover)]">
                    <Table.Cell className="font-medium">{token.description || 'No description'}</Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" variant="soft">{token.type}</Chip>
                    </Table.Cell>
                    <Table.Cell className="font-mono text-xs text-zinc-500">
                      {token.key.slice(0, 6)}••••••••{token.key.slice(-4)}
                    </Table.Cell>
                    <Table.Cell className="text-xs text-zinc-500">
                      <span title={fullDate(token.expires_at)}>{timeAgo(token.expires_at)}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" color={token.disabled ? 'danger' : 'success'} variant="soft">
                        {token.disabled ? 'Disabled' : 'Active'}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex justify-end">
                        <RowActionsMenu
                          label={`Open actions for token ${token.description || token.id.slice(0, 8)}`}
                          items={[
                            {
                              id: 'toggle',
                              label: token.disabled ? 'Enable token' : 'Disable token',
                              icon: <Refresh01Icon size={15} />,
                              onAction: () => {
                                void handleToggle(token);
                              },
                            },
                            {
                              id: 'edit',
                              label: 'Edit token',
                              icon: <PencilEdit01Icon size={15} />,
                              onAction: () => openEdit(token),
                            },
                            {
                              id: 'delete',
                              label: 'Delete token',
                              icon: <Delete01Icon size={15} />,
                              variant: 'danger',
                              onAction: () => {
                                void handleDelete(token);
                              },
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
              Showing {filteredTokens.length === 0 ? 0 : (effectivePage - 1) * PAGE_SIZE + 1}-
              {Math.min(effectivePage * PAGE_SIZE, filteredTokens.length)} of {filteredTokens.length}
            </span>
            <Pagination size="sm" className="justify-self-center">
              <Pagination.Content>
                <Pagination.Item>
                  <Pagination.Previous
                    isDisabled={effectivePage === 1}
                    onPress={() => setPage((previous) => Math.max(1, previous - 1))}
                  >
                    <Pagination.PreviousIcon />
                    <span>Previous</span>
                  </Pagination.Previous>
                </Pagination.Item>
                {paginationItems.map((item, index) =>
                  item === 'ellipsis' ? (
                    <Pagination.Item key={`tokens-ellipsis-${index}`}>
                      <Pagination.Ellipsis />
                    </Pagination.Item>
                  ) : (
                    <Pagination.Item key={`tokens-page-${item}`}>
                      <Pagination.Link isActive={item === effectivePage} onPress={() => setPage(item)}>
                        {item}
                      </Pagination.Link>
                    </Pagination.Item>
                  )
                )}
                <Pagination.Item>
                  <Pagination.Next
                    isDisabled={effectivePage === totalPages}
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

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Edit Token</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body>
                <form id="token-form" onSubmit={handleSave} className="space-y-4">
                  <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="CI token" aria-label="Description" />
                  <TextArea value={disabledReason} onChange={(event) => setDisabledReason(event.target.value)} placeholder="Why this token was disabled" aria-label="Disabled reason" />
                </form>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" onPress={modal.close}>Cancel</Button>
                <Button type="submit" form="token-form" variant="primary" isDisabled={saving}>Save</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </div>
  );
}
