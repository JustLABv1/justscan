'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { OwnershipBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { heroSelectTriggerClassName } from '@/components/ui/form-styles';
import { PageHeader } from '@/components/ui/page-header';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrgDirectory } from '@/hooks/use-org-name-map';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  createTag,
  deleteTag,
  getTokenType,
  getUser,
  getWorkScope,
  listTags,
  listTagShares,
  ResourceShare,
  shareTag,
  Tag,
  unshareTag,
  updateTag,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { canManageOrg, canMutateOrg } from '@/lib/org-permissions';
import {
  Button,
  Card,
  ColorField,
  ColorPicker,
  ColorSwatch,
  ColorSwatchPicker,
  Label,
  ListBox,
  Modal,
  Pagination,
  parseColor,
  SearchField,
  Select,
  type SortDescriptor,
  Table,
  useOverlayState,
} from '@heroui/react';
import {
  Delete01Icon,
  PencilEdit01Icon,
  PlusSignIcon,
  Shield01Icon,
  Tag01Icon,
} from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

const COLORS = [
  '#6366f1',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#ef4444',
  'color-mix(in srgb, var(--accent) 88%, white)',
  '#14b8a6',
];
const selectTriggerCls = heroSelectTriggerClassName;

export default function TagsPage() {
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const { orgs, orgNamesById } = useOrgDirectory();
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState<Tag | null>(null);
  const [shareTarget, setShareTarget] = useState<Tag | null>(null);
  const [shares, setShares] = useState<ResourceShare[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareOrgId, setShareOrgId] = useState('');
  const [shareSaving, setShareSaving] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [page, setPage] = useState(1);
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: 'name',
    direction: 'ascending',
  });
  const PAGE_SIZE = 10;
  const parsedColor = useMemo(() => {
    try {
      return parseColor(color);
    } catch {
      return parseColor(COLORS[0]);
    }
  }, [color]);
  const modal = useOverlayState();
  const shareModal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();
  const isPlatformAdmin = getTokenType() === 'admin';
  const currentUserId = getUser()?.id as string | undefined;
  const orgRoleById = useMemo(
    () => new Map(orgs.map((org) => [org.id, org.current_user_role] as const)),
    [orgs]
  );
  const canMutateActiveScope =
    isPlatformAdmin || workScope.kind !== 'org' || canMutateOrg(orgRoleById.get(workScope.orgId));
  const manageableOrgIds = new Set<string>();
  for (const org of orgs) {
    if (canManageOrg(org.current_user_role)) manageableOrgIds.add(org.id);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTags(await listTags());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => deferEffect(load), [load, scopeKey]);

  function openCreate() {
    if (!canMutateActiveScope) return;
    setEditing(null);
    setName('');
    setColor(COLORS[0]);
    setFormError('');
    modal.open();
  }
  function openEdit(tag: Tag) {
    if (!canMutateTag(tag)) return;
    setEditing(tag);
    setName(tag.name);
    setColor(tag.color);
    setFormError('');
    modal.open();
  }

  function canMutateTag(tag: Tag) {
    if (tag.owner_type === 'system') return isPlatformAdmin;
    if (isPlatformAdmin) return true;
    if (tag.owner_type === 'org' && tag.owner_org_id) {
      return canMutateOrg(orgRoleById.get(tag.owner_org_id));
    }
    return !tag.owner_user_id || tag.owner_user_id === currentUserId;
  }

  function canManageTag(tag: Tag) {
    if (tag.owner_type === 'system') return isPlatformAdmin;
    if (isPlatformAdmin) return true;
    if (tag.owner_type === 'org' && tag.owner_org_id) {
      return manageableOrgIds.has(tag.owner_org_id);
    }
    return !tag.owner_user_id || tag.owner_user_id === currentUserId;
  }

  async function loadShares(tagId: string) {
    setSharesLoading(true);
    setShareError('');
    try {
      setShares(await listTagShares(tagId));
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to load access grants');
    } finally {
      setSharesLoading(false);
    }
  }

  function openShareModal(tag: Tag) {
    if (!canManageTag(tag)) return;
    setShareTarget(tag);
    setShares([]);
    setShareOrgId('');
    setShareError('');
    shareModal.open();
    void loadShares(tag.id);
  }

  async function handleGrantShare() {
    if (!shareTarget || !shareOrgId || !canManageTag(shareTarget)) return;
    setShareSaving(true);
    setShareError('');
    try {
      await shareTag(shareTarget.id, shareOrgId);
      toast.success('Tag access granted');
      setShareOrgId('');
      await loadShares(shareTarget.id);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to grant access');
    } finally {
      setShareSaving(false);
    }
  }

  async function handleRevokeShare(orgId: string) {
    if (!shareTarget || !canManageTag(shareTarget)) return;
    setShareSaving(true);
    setShareError('');
    try {
      await unshareTag(shareTarget.id, orgId);
      toast.success('Tag access revoked');
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
  const visibleTags = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    const filtered = query
      ? tags.filter((tag) => {
          const ownerLabel =
            tag.owner_type === 'org'
              ? `org ${(tag.owner_org_id ? orgNamesById[tag.owner_org_id] : '') ?? ''}`
              : tag.owner_type === 'system'
                ? 'system'
                : 'personal';
          return (
            tag.name.toLowerCase().includes(query) ||
            tag.color.toLowerCase().includes(query) ||
            ownerLabel.toLowerCase().includes(query)
          );
        })
      : tags;

    const sorted = [...filtered].sort((a, b) => {
      const column = sortDescriptor.column as string;
      const direction = sortDescriptor.direction === 'descending' ? -1 : 1;

      if (column === 'owner') {
        const ownerA =
          a.owner_type === 'org'
            ? (orgNamesById[a.owner_org_id ?? ''] ?? 'Org workspace')
            : a.owner_type === 'system'
              ? 'System'
              : 'Personal';
        const ownerB =
          b.owner_type === 'org'
            ? (orgNamesById[b.owner_org_id ?? ''] ?? 'Org workspace')
            : b.owner_type === 'system'
              ? 'System'
              : 'Personal';
        return ownerA.localeCompare(ownerB, undefined, { sensitivity: 'base' }) * direction;
      }

      const valueA = column === 'color' ? a.color : a.name;
      const valueB = column === 'color' ? b.color : b.name;
      return valueA.localeCompare(valueB, undefined, { sensitivity: 'base' }) * direction;
    });

    return sorted;
  }, [filterQuery, tags, sortDescriptor, orgNamesById]);
  const totalPages = Math.max(1, Math.ceil(visibleTags.length / PAGE_SIZE));
  const effectivePage = Math.min(page, totalPages);
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
  const pagedTags = useMemo(() => {
    const start = (effectivePage - 1) * PAGE_SIZE;
    return visibleTags.slice(start, start + PAGE_SIZE);
  }, [effectivePage, visibleTags]);

  async function handleSubmit(e: React.FormEvent) {
    if (editing ? !canMutateTag(editing) : !canMutateActiveScope) return;
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const currentScope = getWorkScope();
      if (editing) {
        await updateTag(editing.id, name, color);
        toast.success('Tag updated');
      } else {
        await createTag(name, color, currentScope.kind === 'org' ? currentScope.orgId : undefined);
        toast.success(`Tag "${name}" created`);
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
    const tag = tags.find((candidate) => candidate.id === id);
    if (tag && !canMutateTag(tag)) return;
    const ok = await confirm({
      title: 'Delete tag?',
      message: 'The tag will be removed from all scans.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteTag(id).catch(() => {});
    toast.success('Tag deleted');
    load();
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Tags"
        description={
          tags.length > 0
            ? `${tags.length} ${tags.length === 1 ? 'tag' : 'tags'} organized for filtering.`
            : 'Organize your scans with color-coded labels.'
        }
        actions={
          tags.length > 0 ? (
            <Button
              onPress={openCreate}
              className="inline-flex items-center gap-2"
              isDisabled={!canMutateActiveScope}
              variant="primary"
            >
              <PlusSignIcon size={15} /> New Tag
            </Button>
          ) : undefined
        }
      />

      {error ? <FormAlert description={error} title="Tag loading failed" /> : null}

      {loading ? (
        <Card className="space-y-4">
          <SearchField name="tags-search" variant="secondary" className="w-full xl:max-w-md">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                aria-label="Filter tags"
                placeholder="Filter tags by name, owner, or color..."
                value={filterQuery}
                onChange={(event) => {
                  setFilterQuery(event.target.value);
                  setPage(1);
                }}
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <div className="surface-panel rounded-2xl overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 px-4 py-3.5"
                style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
              >
                <Skeleton className="size-8 rounded-lg shrink-0" />
                <Skeleton className="h-4 w-28 rounded" />
                <div className="flex-1" />
                <Skeleton className="h-4 w-16 rounded" />
                <Skeleton className="size-7 rounded-lg" />
                <Skeleton className="size-7 rounded-lg" />
              </div>
            ))}
          </div>
        </Card>
      ) : tags.length === 0 ? (
        <EmptyState
          icon={<Tag01Icon size={28} />}
          title="No tags yet"
          description="Create color-coded tags to group and filter your scans. Tags can be assigned to any scan."
          action={canMutateActiveScope ? { label: 'New Tag', onClick: openCreate } : undefined}
        />
      ) : (
        <Card className="space-y-4">
          <SearchField name="tags-search" variant="secondary" className="w-full xl:max-w-md">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                aria-label="Filter tags"
                placeholder="Filter tags by name, owner, or color..."
                value={filterQuery}
                onChange={(event) => {
                  setFilterQuery(event.target.value);
                  setPage(1);
                }}
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content
                aria-label="Tags table"
                className="min-w-[720px]"
                sortDescriptor={sortDescriptor}
                onSortChange={setSortDescriptor}
              >
                <Table.Header>
                  <Table.Column id="name" allowsSorting isRowHeader>
                    Tag
                  </Table.Column>
                  <Table.Column id="owner" allowsSorting>
                    Owner
                  </Table.Column>
                  <Table.Column className="text-right">Actions</Table.Column>
                </Table.Header>
                <Table.Body
                  items={pagedTags}
                  renderEmptyState={() => (
                    <div className="py-10 text-center text-sm text-zinc-500">
                      No tags match your filter.
                    </div>
                  )}
                >
                  {(tag) => (
                    <Table.Row key={tag.id} id={tag.id}>
                      <Table.Cell>
                        <div className="flex min-w-0 items-center gap-2" title={tag.name}>
                          <span
                            className="size-3 shrink-0 rounded-full border"
                            style={{ backgroundColor: tag.color, borderColor: `${tag.color}88` }}
                            aria-hidden="true"
                          />
                          <span className="truncate text-sm font-medium">{tag.name}</span>
                          <span className="font-mono text-xs text-muted">{tag.color}</span>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <OwnershipBadge
                          ownerType={tag.owner_type}
                          ownerOrgId={tag.owner_org_id}
                          orgNamesById={orgNamesById}
                        />
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex items-center justify-end">
                          {canManageTag(tag) || canMutateTag(tag) ? (
                            <RowActionsMenu
                              label={`Open actions menu for tag ${tag.name}`}
                              items={[
                                ...(canManageTag(tag)
                                  ? [
                                      {
                                        id: 'share',
                                        label: 'Manage access',
                                        icon: <Shield01Icon size={15} />,
                                        onAction: () => openShareModal(tag),
                                      },
                                    ]
                                  : []),
                                ...(canMutateTag(tag)
                                  ? [
                                      {
                                        id: 'edit',
                                        label: 'Edit tag',
                                        icon: <PencilEdit01Icon size={15} />,
                                        onAction: () => openEdit(tag),
                                      },
                                      {
                                        id: 'delete',
                                        label: 'Delete tag',
                                        icon: <Delete01Icon size={15} />,
                                        variant: 'danger' as const,
                                        onAction: () => {
                                          void handleDelete(tag.id);
                                        },
                                      },
                                    ]
                                  : []),
                              ]}
                            />
                          ) : (
                            <span className="text-xs text-zinc-500">Read only</span>
                          )}
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
            <Table.Footer className="grid grid-cols-[1fr_auto_1fr] items-center px-4 py-3 gap-3">
              <span className="text-xs text-zinc-500 whitespace-nowrap">
                Showing {visibleTags.length === 0 ? 0 : (effectivePage - 1) * PAGE_SIZE + 1}-
                {Math.min(effectivePage * PAGE_SIZE, visibleTags.length)} of {visibleTags.length}
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
                      <Pagination.Item key={`tags-ellipsis-${index}`}>
                        <Pagination.Ellipsis />
                      </Pagination.Item>
                    ) : (
                      <Pagination.Item key={`tags-page-${item}`}>
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
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>{editing ? 'Edit Tag' : 'New Tag'}</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="py-5">
                <form id="tag-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError ? <FormAlert description={formError} title="Tag save failed" /> : null}
                  <FormField
                    label="Name"
                    onChange={(e) => setName(e.target.value)}
                    placeholder="production"
                    required
                    value={name}
                    className="bg-surface-secondary"
                  />
                  <div className="space-y-2.5 flex flex-col">
                    <Label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                      Color
                    </Label>
                    <ColorPicker
                      value={parsedColor}
                      onChange={(nextColor) => setColor(nextColor.toString('hex'))}
                    >
                      <ColorPicker.Trigger className="flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <ColorSwatch size="md" />
                          <span className="text-xs font-mono text-zinc-500">{color}</span>
                        </div>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{
                            background: color + '22',
                            color,
                            border: `1px solid ${color}44`,
                          }}
                        >
                          {name || 'preview'}
                        </span>
                      </ColorPicker.Trigger>
                      <ColorPicker.Popover className="w-[min(320px,calc(100vw-3rem))] space-y-3 p-3">
                        <ColorSwatchPicker size="sm" className="justify-center">
                          {COLORS.map((c) => (
                            <ColorSwatchPicker.Item key={c} color={c}>
                              <ColorSwatchPicker.Swatch />
                              <ColorSwatchPicker.Indicator />
                            </ColorSwatchPicker.Item>
                          ))}
                        </ColorSwatchPicker>
                        <ColorField aria-label="Tag color">
                          <ColorField.Group variant="secondary">
                            <ColorField.Prefix>
                              <ColorSwatch size="xs" />
                            </ColorField.Prefix>
                            <ColorField.Input />
                          </ColorField.Group>
                        </ColorField>
                      </ColorPicker.Popover>
                    </ColorPicker>
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer>
                <Button onPress={modal.close} variant="secondary">
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="tag-form"
                  isDisabled={saving || (editing ? !canMutateTag(editing) : !canMutateActiveScope)}
                  variant="primary"
                >
                  {saving && (
                    <div className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  )}
                  {editing ? 'Save' : 'Create'}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal state={shareModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Manage Tag Access</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="mt-4 space-y-4">
                {shareError ? (
                  <FormAlert description={shareError} title="Access update failed" />
                ) : null}
                {shareTarget ? (
                  <Card className="bg-surface-secondary px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span
                          className="size-4 rounded-full shrink-0"
                          style={{
                            background: shareTarget.color,
                            boxShadow: `0 0 8px ${shareTarget.color}88`,
                          }}
                        />
                        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                          {shareTarget.name}
                        </p>
                      </div>
                      <OwnershipBadge
                        ownerType={shareTarget.owner_type}
                        ownerOrgId={shareTarget.owner_org_id}
                        orgNamesById={orgNamesById}
                      />
                    </div>
                  </Card>
                ) : null}

                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                      Current access
                    </h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Organizations listed here can apply this tag to scans they manage.
                    </p>
                  </div>
                  {sharesLoading ? (
                    <div className="flex justify-center py-6">
                      <div className="size-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-accent-500 animate-spin" />
                    </div>
                  ) : shares.length === 0 ? (
                    <p className="text-sm text-zinc-500">No organization grants yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {shares.map((share) => (
                        <Card
                          key={share.org_id}
                          className="flex bg-surface-secondary items-start justify-between gap-3 px-4 py-3"
                        >
                          <div className="flex flex-wrap items-center justify-between w-full">
                            <div className="flex flex-col">
                              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                                {share.org_name}
                              </p>
                              <p className="text-xs text-zinc-500 mt-0.5">
                                {share.is_owner ? 'Owner workspace' : 'Shared access'}
                              </p>
                            </div>
                            {share.is_owner ? (
                              <span className="text-xs font-medium text-zinc-500">Locked</span>
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
                        </Card>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                      Grant access
                    </h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Share this tag with another organization you manage.
                    </p>
                  </div>
                  {availableShareTargets.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                      No additional organizations are available for sharing.
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
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
                        type="button"
                        onPress={() => {
                          void handleGrantShare();
                        }}
                        isDisabled={!shareOrgId || shareSaving}
                        className="btn-primary disabled:opacity-60"
                        variant="primary"
                      >
                        Grant
                      </Button>
                    </div>
                  )}
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button onPress={shareModal.close} variant="secondary">
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
