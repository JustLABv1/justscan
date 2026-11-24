'use client';

import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { StatusTag } from '@/components/ui/status-dot';
import { labelFor } from '@/lib/labels';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { StatusAlert } from '@/components/ui/form-alert';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { deleteAdminToken, listAdminTokens, updateAdminToken } from '@/lib/api/admin';
import type { AdminToken } from '@/lib/api/types/admin';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo, timeUntil } from '@/lib/time';
import {
  Button,
  Card,
  Input,
  Label,
  ListBox,
  Modal,
  ResourceList,
  SearchField,
  Select,
  TablePager,
  TextArea,
  TextField,
  useOverlayState,
} from '@/components/ui';
import { Delete01Icon, PencilEdit01Icon, Refresh01Icon } from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

const PAGE_SIZE = 10;

const TOKEN_TYPE_LABELS: Record<string, string> = {
  personal: 'Personal access token',
  org: 'Organization token',
  user: 'Session token',
};

function tokenTypeLabel(type: string) {
  return labelFor(TOKEN_TYPE_LABELS, type) || 'Token';
}

function tokenName(token: AdminToken) {
  return token.description
    ? `token "${token.description}"`
    : `this ${tokenTypeLabel(token.type).toLowerCase()}`;
}

function maskKey(key: string) {
  if (!key) return '••••••••';
  return `${key.slice(0, 6)}••••${key.slice(-4)}`;
}

function tokenExpiry(expiresAt?: string | null): {
  label: string;
  title?: string;
  expired: boolean;
} {
  const date = expiresAt ? new Date(expiresAt) : null;
  if (!date || Number.isNaN(date.getTime()) || date.getFullYear() < 2000) {
    return { label: 'Never expires', expired: false };
  }
  if (date.getTime() <= Date.now()) {
    return { label: `Expired ${timeAgo(expiresAt)}`, title: fullDate(expiresAt), expired: true };
  }
  return { label: `Expires ${timeUntil(expiresAt)}`, title: fullDate(expiresAt), expired: false };
}

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
  const toast = useToast();

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
      toast.success('Token updated');
      await load();
    } catch (saveError: unknown) {
      toast.error(saveError instanceof Error ? saveError.message : 'Failed to update token');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(token: AdminToken) {
    const nextDisabled = !token.disabled;
    const confirmed = await confirm(
      nextDisabled
        ? {
            title: `Disable ${tokenName(token)}?`,
            message: 'The token will stop working immediately.',
            confirmLabel: 'Disable',
            variant: 'warning',
          }
        : {
            title: `Re-enable ${tokenName(token)}?`,
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
      toast.success(nextDisabled ? 'Token disabled' : 'Token enabled');
      await load();
    } catch (toggleError: unknown) {
      toast.error(toggleError instanceof Error ? toggleError.message : 'Failed to update token');
    }
  }

  async function handleDelete(token: AdminToken) {
    const confirmed = await confirm({
      title: `Delete ${tokenName(token)}?`,
      message: 'This cannot be undone. Any service using the token will stop authenticating.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await deleteAdminToken(token.id);
      toast.success('Token deleted');
      await load();
    } catch (deleteError: unknown) {
      toast.error(deleteError instanceof Error ? deleteError.message : 'Failed to delete token');
    }
  }

  const filteredTokens = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tokens.filter((token) => {
      const matchesSearch =
        q.length === 0 ||
        (token.description ?? '').toLowerCase().includes(q) ||
        tokenTypeLabel(token.type).toLowerCase().includes(q) ||
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
  const pagedTokens = filteredTokens.slice(
    (effectivePage - 1) * PAGE_SIZE,
    effectivePage * PAGE_SIZE
  );

  return (
    <div className="space-y-4">
      {error ? (
        <StatusAlert status="danger" title="Tokens failed to load" description={error} />
      ) : null}

      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b border-border p-4">
          <FilterToolbar
            search={
              <SearchField
                aria-label="Filter tokens"
                name="admin-tokens-search"
                variant="secondary"
                value={searchQuery}
                onChange={(value) => {
                  setSearchQuery(value);
                  setPage(1);
                }}
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="Filter by description, type, or key..." />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
            }
            filters={
              <Select
                aria-label="Filter tokens by status"
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
                    <ListBox.Item id="all">All statuses</ListBox.Item>
                    <ListBox.Item id="active">Active</ListBox.Item>
                    <ListBox.Item id="disabled">Disabled</ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            }
          />
        </div>

        {pagedTokens.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {loading ? 'Loading tokens...' : 'No tokens match your filters.'}
          </p>
        ) : (
          <ResourceList bordered={false} aria-label="Tokens">
            {pagedTokens.map((token) => {
              const expiry = tokenExpiry(token.expires_at);
              const name = tokenName(token);
              return (
                <ResourceList.Item
                  key={token.id}
                  title={token.description || `Unnamed ${tokenTypeLabel(token.type).toLowerCase()}`}
                  tone={token.disabled ? 'danger' : expiry.expired ? 'warning' : 'default'}
                  description={
                    <>
                      {tokenTypeLabel(token.type)} ·{' '}
                      <span className="font-mono text-xs">{maskKey(token.key)}</span> ·{' '}
                      <span title={expiry.title}>{expiry.label}</span>
                    </>
                  }
                  meta={
                    <StatusTag
                      tone={token.disabled ? 'danger' : expiry.expired ? 'warning' : 'success'}
                    >
                      {token.disabled ? 'Disabled' : expiry.expired ? 'Expired' : 'Active'}
                    </StatusTag>
                  }
                  actions={
                    <RowActionsMenu
                      label={`Open actions for ${name}`}
                      items={[
                        {
                          id: 'edit',
                          label: 'Edit token',
                          icon: <PencilEdit01Icon size={15} />,
                          onAction: () => openEdit(token),
                        },
                        {
                          id: 'toggle',
                          label: token.disabled ? 'Enable token' : 'Disable token',
                          icon: <Refresh01Icon size={15} />,
                          onAction: () => {
                            void handleToggle(token);
                          },
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
                  }
                >
                  {token.disabled && token.disabled_reason ? (
                    <p
                      className="truncate text-xs text-muted-foreground"
                      title={token.disabled_reason}
                    >
                      Disabled: {token.disabled_reason}
                    </p>
                  ) : null}
                </ResourceList.Item>
              );
            })}
          </ResourceList>
        )}
        <TablePager
          page={effectivePage}
          pageSize={PAGE_SIZE}
          total={filteredTokens.length}
          onPageChange={setPage}
          noun="tokens"
        />
      </Card>

      <Modal state={modal}>
        <Modal.Backdrop isDismissable={false}>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Edit token</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body>
                <form id="token-form" onSubmit={handleSave} className="space-y-4">
                  <TextField value={description} onChange={setDescription}>
                    <Label className="mb-1.5 text-sm font-medium">Description</Label>
                    <Input placeholder="CI token" variant="secondary" />
                  </TextField>
                  <TextField value={disabledReason} onChange={setDisabledReason}>
                    <Label className="mb-1.5 text-sm font-medium">Reason for disabling</Label>
                    <TextArea placeholder="Why this token was disabled" />
                  </TextField>
                </form>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" onPress={modal.close}>
                  Cancel
                </Button>
                <Button type="submit" form="token-form" variant="primary" isDisabled={saving}>
                  Save
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
