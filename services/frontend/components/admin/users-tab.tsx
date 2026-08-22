'use client';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { FormField } from '@/components/ui/form-field';
import { StatusAlert } from '@/components/ui/form-alert';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import {
  createAdminUser,
  deleteAdminUser,
  disableAdminUser,
  listAdminUsers,
  updateAdminUser,
} from '@/lib/api/admin';
import type { AdminUser } from '@/lib/api/types/admin';
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
  useOverlayState,
} from '@heroui/react';
import {
  Delete01Icon,
  PencilEdit01Icon,
  PlusSignIcon,
  Refresh01Icon,
  Shield01Icon,
} from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

const PAGE_SIZE = 10;

const USER_AUTH_LABEL: Record<string, string> = {
  local: 'Local',
  oidc: 'OIDC',
};

function userAuthLabel(authType?: string) {
  return USER_AUTH_LABEL[authType ?? 'local'] ?? (authType ? authType.toUpperCase() : 'Unknown');
}

export function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [isCreate, setIsCreate] = useState(false);
  const [formUsername, setFormUsername] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState('user');
  const [formPassword, setFormPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'user'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const [page, setPage] = useState(1);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setUsers(await listAdminUsers());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => deferEffect(load), [load]);

  function openCreate() {
    setIsCreate(true);
    setEditingUser(null);
    setFormUsername('');
    setFormEmail('');
    setFormRole('user');
    setFormPassword('');
    setFormError('');
    modal.open();
  }

  function openEdit(user: AdminUser) {
    setIsCreate(false);
    setEditingUser(user);
    setFormUsername(user.username);
    setFormEmail(user.email);
    setFormRole(user.role);
    setFormPassword('');
    setFormError('');
    modal.open();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setFormError('');
    setSaving(true);
    try {
      if (isCreate) {
        await createAdminUser(formUsername, formEmail, formPassword, formRole);
      } else if (editingUser) {
        await updateAdminUser(editingUser.id, {
          username: formUsername,
          email: formEmail,
          role: formRole,
          ...(editingUser.auth_type !== 'oidc' && formPassword ? { password: formPassword } : {}),
        });
      }
      modal.close();
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(user: AdminUser) {
    const ok = await confirm({
      title: `Delete "${user.username}"?`,
      message: 'This will permanently remove the user and cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    if (pendingAction) return;
    setPendingAction(`delete:${user.id}`);
    try {
      await deleteAdminUser(user.id);
      toast.success('User deleted');
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setPendingAction(null);
    }
  }

  async function handleToggleDisable(user: AdminUser) {
    const newDisabled = !user.disabled;
    const ok = await confirm(
      newDisabled
        ? {
            title: `Disable "${user.username}"?`,
            message: 'The user will no longer be able to log in.',
            confirmLabel: 'Disable',
            variant: 'warning',
          }
        : {
            title: `Re-enable "${user.username}"?`,
            message: 'The user will regain access to their account.',
            confirmLabel: 'Enable',
            variant: 'default',
          }
    );
    if (!ok) return;
    if (pendingAction) return;
    setPendingAction(`toggle:${user.id}`);
    try {
      await disableAdminUser(user.id, newDisabled);
      toast.success(newDisabled ? 'User disabled' : 'User enabled');
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update user status');
    } finally {
      setPendingAction(null);
    }
  }

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch =
        q.length === 0 ||
        user.username.toLowerCase().includes(q) ||
        user.email.toLowerCase().includes(q) ||
        userAuthLabel(user.auth_type).toLowerCase().includes(q);
      const matchesRole = roleFilter === 'all' || user.role === roleFilter;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && !user.disabled) ||
        (statusFilter === 'disabled' && user.disabled);
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, searchQuery, roleFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const effectivePage = Math.min(page, totalPages);
  const pagedUsers = filteredUsers.slice(
    (effectivePage - 1) * PAGE_SIZE,
    effectivePage * PAGE_SIZE
  );

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
      {error ? (
        <StatusAlert status="danger" title="Users failed to load" description={error} />
      ) : null}

      <div className="flex justify-end">
        <Button onPress={openCreate} variant="secondary">
          <PlusSignIcon size={15} />
          Add User
        </Button>
      </div>

      <Card className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <SearchField name="admin-users-search" variant="secondary" className="w-full sm:max-w-sm">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                aria-label="Filter admin users"
                placeholder="Filter users by name, email, or auth..."
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setPage(1);
                }}
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Select
              aria-label="Filter users by role"
              value={roleFilter}
              onChange={(value) => {
                setRoleFilter(String(value) as 'all' | 'admin' | 'user');
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
                  <ListBox.Item id="all">All roles</ListBox.Item>
                  <ListBox.Item id="admin">Admin</ListBox.Item>
                  <ListBox.Item id="user">User</ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
            <Select
              aria-label="Filter users by status"
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
        </div>

        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label="Admin users" className="min-w-[980px]">
              <Table.Header>
                <Table.Column isRowHeader>Username</Table.Column>
                <Table.Column>Email</Table.Column>
                <Table.Column>Auth</Table.Column>
                <Table.Column>Role</Table.Column>
                <Table.Column>Status</Table.Column>
                <Table.Column>Last Login</Table.Column>
                <Table.Column>Created</Table.Column>
                <Table.Column className="text-right">Actions</Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <div className="py-10 text-center text-sm text-zinc-500">
                    {loading ? 'Loading users...' : 'No users match your filters.'}
                  </div>
                )}
              >
                {pagedUsers.map((user) => (
                  <Table.Row key={user.id} id={user.id} className="hover:bg-[var(--row-hover)]">
                    <Table.Cell className="font-medium">{user.username}</Table.Cell>
                    <Table.Cell className="text-xs text-zinc-500">{user.email}</Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" variant="soft">
                        {userAuthLabel(user.auth_type)}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" variant="soft">
                        {user.role}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" color={user.disabled ? 'danger' : 'success'} variant="soft">
                        {user.disabled ? 'Disabled' : 'Active'}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell className="text-xs text-zinc-500">
                      {user.last_login_at ? (
                        <div className="space-y-0.5">
                          <p title={fullDate(user.last_login_at)}>{timeAgo(user.last_login_at)}</p>
                          <p className="text-[11px] text-zinc-400">
                            via{' '}
                            {userAuthLabel(user.last_login_method || user.auth_type).toLowerCase()}
                          </p>
                        </div>
                      ) : (
                        <span className="text-zinc-400">Never</span>
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-xs text-zinc-500">
                      <span title={fullDate(user.created_at)}>{timeAgo(user.created_at)}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex justify-end">
                        <RowActionsMenu
                          label={`Open actions for ${user.username}`}
                          items={[
                            {
                              id: 'toggle',
                              label: user.disabled ? 'Enable user' : 'Disable user',
                              icon: <Refresh01Icon size={15} />,
                              pending: pendingAction === `toggle:${user.id}`,
                              disabled:
                                pendingAction !== null && pendingAction !== `toggle:${user.id}`,
                              onAction: () => {
                                void handleToggleDisable(user);
                              },
                            },
                            {
                              id: 'edit',
                              label: 'Edit user',
                              icon: <PencilEdit01Icon size={15} />,
                              onAction: () => openEdit(user),
                            },
                            {
                              id: 'delete',
                              label: 'Delete user',
                              icon: <Delete01Icon size={15} />,
                              variant: 'danger',
                              pending: pendingAction === `delete:${user.id}`,
                              disabled:
                                pendingAction !== null && pendingAction !== `delete:${user.id}`,
                              onAction: () => {
                                void handleDelete(user);
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
              Showing {filteredUsers.length === 0 ? 0 : (effectivePage - 1) * PAGE_SIZE + 1}-
              {Math.min(effectivePage * PAGE_SIZE, filteredUsers.length)} of {filteredUsers.length}
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
                    <Pagination.Item key={`users-ellipsis-${index}`}>
                      <Pagination.Ellipsis />
                    </Pagination.Item>
                  ) : (
                    <Pagination.Item key={`users-page-${item}`}>
                      <Pagination.Link
                        isActive={item === effectivePage}
                        onPress={() => setPage(item)}
                      >
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
                <Modal.Heading>{isCreate ? 'Add User' : 'Edit User'}</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body>
                <form id="user-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError ? (
                    <StatusAlert
                      status="danger"
                      title="User could not be saved"
                      description={formError}
                    />
                  ) : null}
                  <Input
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                    placeholder="username"
                    required
                    aria-label="Username"
                  />
                  <Input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="user@example.com"
                    required
                    aria-label="Email"
                  />
                  <Select value={formRole} onChange={(value) => setFormRole(String(value))}>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        <ListBox.Item id="user">User</ListBox.Item>
                        <ListBox.Item id="admin">Admin</ListBox.Item>
                      </ListBox>
                    </Select.Popover>
                  </Select>
                  <FormField
                    autoComplete={editingUser?.auth_type === 'oidc' ? 'off' : 'new-password'}
                    description={
                      editingUser?.auth_type === 'oidc'
                        ? 'Password changes are disabled for OIDC users.'
                        : !isCreate
                          ? 'Leave blank to keep unchanged.'
                          : undefined
                    }
                    disabled={Boolean(editingUser?.auth_type === 'oidc')}
                    label="Password"
                    name="user-password"
                    onChange={(event) => setFormPassword(event.target.value)}
                    placeholder={isCreate ? 'Password' : '••••••••'}
                    required={isCreate}
                    type="password"
                    value={formPassword}
                  />
                </form>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" onPress={modal.close}>
                  Cancel
                </Button>
                <Button type="submit" form="user-form" isPending={saving} variant="primary">
                  <Shield01Icon size={14} />
                  {isCreate ? 'Create' : 'Save'}
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
