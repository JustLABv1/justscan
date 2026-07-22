'use client';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { OwnershipTransfer } from '@/components/ownership-transfer';
import { useToast } from '@/components/toast';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusAlert } from '@/components/ui/form-alert';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { OwnershipBadge } from '@/components/ui/badges';
import {
  fieldLabelClassName,
  heroFieldClassName,
  heroSelectTriggerClassName,
  heroTextAreaClassName,
} from '@/components/ui/form-styles';
import { PageHeader } from '@/components/ui/page-header';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { useOrgDirectory } from '@/hooks/use-org-name-map';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  createStatusPage,
  deleteStatusPage,
  getStatusPage,
  getTokenType,
  getUser,
  getWorkScope,
  listStatusPages,
  listStatusPageShares,
  listStatusPageTargetOptions,
  ResourceShare,
  shareStatusPage,
  StatusPage,
  StatusPagePayload,
  StatusPageTarget,
  StatusPageTargetOption,
  transferStatusPageOwnership,
  unshareStatusPage,
  updateStatusPage,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { canManageOrg, canMutateOrg } from '@/lib/org-permissions';
import { timeAgo } from '@/lib/time';
import {
  Alert,
  Button,
  Card,
  Chip,
  Input,
  Label,
  ListBox,
  Modal,
  SearchField,
  Select,
  Spinner,
  Switch,
  Table,
  TextArea,
  useOverlayState,
} from '@heroui/react';
import {
  Delete01Icon,
  EyeIcon,
  PencilEdit01Icon,
  PlusSignIcon,
  Shield01Icon,
} from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

const fieldCls = heroFieldClassName;
const textareaCls = heroTextAreaClassName;
const selectTriggerCls = heroSelectTriggerClassName;
const fieldLabelCls = fieldLabelClassName;

const visibilityOptions: Array<StatusPage['visibility']> = ['private', 'authenticated', 'public'];
const updateLevelOptions = ['info', 'maintenance', 'incident'] as const;
const exactSelectionBadgeStyle = {
  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
  border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)',
  color: 'color-mix(in srgb, var(--accent) 62%, white)',
};

type ParsedImagePattern = {
  pattern: string;
  regex: RegExp | null;
  error: string;
};

function splitImagePatterns(value: string) {
  const seen = new Set<string>();
  return value
    .split(/\r?\n/)
    .map((pattern) => pattern.trim())
    .filter((pattern) => {
      if (!pattern || seen.has(pattern)) {
        return false;
      }
      seen.add(pattern);
      return true;
    });
}

function matchesPattern(regex: RegExp, option: StatusPageTargetOption) {
  return regex.test(option.label) || regex.test(option.image_name) || regex.test(option.image_tag);
}

function describeScope(page: StatusPage) {
  if (page.include_all_tags) {
    return 'All image tags';
  }
  if ((page.image_patterns ?? []).length > 0) {
    return 'Exact tags + regex';
  }
  return 'Curated tags';
}

function visibilityTone(visibility: StatusPage['visibility']): 'default' | 'accent' | 'success' {
  if (visibility === 'public') return 'success';
  if (visibility === 'authenticated') return 'accent';
  return 'default';
}

export default function StatusPagesPage() {
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const { orgs, orgNamesById } = useOrgDirectory();
  const [pages, setPages] = useState<StatusPage[]>([]);
  const [targetOptions, setTargetOptions] = useState<StatusPageTargetOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<StatusPage | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<StatusPage['visibility']>('private');
  const [includeAllTags, setIncludeAllTags] = useState(false);
  const [staleAfterHours, setStaleAfterHours] = useState('72');
  const [selectedTargetKeys, setSelectedTargetKeys] = useState<Set<string>>(new Set());
  const [targetQuery, setTargetQuery] = useState('');
  const [imagePatternText, setImagePatternText] = useState('');
  const [updateTitle, setUpdateTitle] = useState('');
  const [updateBody, setUpdateBody] = useState('');
  const [updateLevel, setUpdateLevel] = useState<(typeof updateLevelOptions)[number]>('info');
  const [shareTarget, setShareTarget] = useState<StatusPage | null>(null);
  const [shares, setShares] = useState<ResourceShare[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | StatusPage['visibility']>('all');
  const [shareOrgId, setShareOrgId] = useState('');
  const [transferOrgId, setTransferOrgId] = useState('');
  const [shareError, setShareError] = useState('');
  const [shareSaving, setShareSaving] = useState(false);
  const [sharesLoading, setSharesLoading] = useState(false);
  const modal = useOverlayState();
  const shareModal = useOverlayState();
  const toast = useToast();
  const { confirm, dialog } = useConfirmDialog();
  const isPlatformAdmin = getTokenType() === 'admin';
  const currentUserId = getUser()?.id as string | undefined;
  const orgRoleById = useMemo(
    () => new Map(orgs.map((org) => [org.id, org.current_user_role] as const)),
    [orgs]
  );
  const canMutateActiveScope =
    isPlatformAdmin || workScope.kind !== 'org' || canMutateOrg(orgRoleById.get(workScope.orgId));
  const manageableOrgIds = new Set(
    orgs.filter((org) => canManageOrg(org.current_user_role)).map((org) => org.id)
  );
  const filteredPages = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return pages.filter((page) => {
      const visibilityMatches = visibilityFilter === 'all' || page.visibility === visibilityFilter;
      if (!visibilityMatches) return false;
      if (!query) return true;
      return [page.name, page.description, page.slug]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [pages, searchQuery, visibilityFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPages(await listStatusPages());
      setError('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load status pages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    return deferEffect(load);
  }, [load, scopeKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      setLoadingOptions(true);
      try {
        const options = await listStatusPageTargetOptions();
        if (!cancelled) {
          setTargetOptions(options);
        }
      } catch {
        if (!cancelled) {
          setTargetOptions([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingOptions(false);
        }
      }
    }

    loadOptions();
    return () => {
      cancelled = true;
    };
  }, [scopeKey]);

  const selectedTargets = useMemo(() => {
    const keys = Array.from(selectedTargetKeys).map(String);
    return keys
      .map((key, index) => {
        const option = targetOptions.find((candidate) => candidate.id === key);
        if (!option) return null;
        return {
          image_name: option.image_name,
          image_tag: option.image_tag,
          display_order: index + 1,
        } satisfies StatusPageTarget;
      })
      .filter((target): target is StatusPageTarget => Boolean(target));
  }, [selectedTargetKeys, targetOptions]);

  const parsedImagePatterns = useMemo<ParsedImagePattern[]>(() => {
    return splitImagePatterns(imagePatternText).map((pattern) => {
      try {
        return {
          pattern,
          regex: new RegExp(pattern),
          error: '',
        };
      } catch (error) {
        return {
          pattern,
          regex: null,
          error: error instanceof Error ? error.message : 'Invalid regex pattern',
        };
      }
    });
  }, [imagePatternText]);

  const imagePatterns = useMemo(
    () => parsedImagePatterns.filter((pattern) => !pattern.error).map((pattern) => pattern.pattern),
    [parsedImagePatterns]
  );

  const invalidImagePatterns = useMemo(
    () => parsedImagePatterns.filter((pattern) => Boolean(pattern.error)),
    [parsedImagePatterns]
  );

  const filteredTargetOptions = useMemo(() => {
    const query = targetQuery.trim().toLowerCase();
    if (!query) {
      return targetOptions;
    }
    return targetOptions.filter(
      (option) =>
        option.label.toLowerCase().includes(query) ||
        option.image_name.toLowerCase().includes(query) ||
        option.image_tag.toLowerCase().includes(query) ||
        option.latest_status.toLowerCase().includes(query)
    );
  }, [targetOptions, targetQuery]);

  const regexMatchedOptions = useMemo(() => {
    const regexes = parsedImagePatterns.flatMap((pattern) =>
      pattern.regex ? [pattern.regex] : []
    );
    if (includeAllTags || regexes.length === 0) {
      return [];
    }

    return targetOptions.filter((option) => {
      if (selectedTargetKeys.has(option.id)) {
        return false;
      }
      return regexes.some((regex) => matchesPattern(regex, option));
    });
  }, [includeAllTags, parsedImagePatterns, selectedTargetKeys, targetOptions]);

  const scopeIsValid = includeAllTags || selectedTargets.length > 0 || imagePatterns.length > 0;

  function canManageStatusPage(page: StatusPage) {
    if (isPlatformAdmin) return true;
    if (page.owner_type === 'org' && page.owner_org_id) {
      return canManageOrg(orgRoleById.get(page.owner_org_id));
    }
    return !page.owner_user_id || page.owner_user_id === currentUserId;
  }

  async function loadShares(pageId: string) {
    setSharesLoading(true);
    setShareError('');
    try {
      setShares(await listStatusPageShares(pageId));
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to load access grants');
    } finally {
      setSharesLoading(false);
    }
  }

  function openShareModal(page: StatusPage) {
    if (!canManageStatusPage(page)) return;
    setShareTarget(page);
    setShareOrgId('');
    setTransferOrgId('');
    setShareError('');
    setShares([]);
    shareModal.open();
    void loadShares(page.id);
  }

  async function handleGrantShare() {
    if (!shareTarget || !shareOrgId || !canManageStatusPage(shareTarget)) return;
    setShareSaving(true);
    setShareError('');
    try {
      await shareStatusPage(shareTarget.id, shareOrgId);
      toast.success('Status page access granted');
      setShareOrgId('');
      await loadShares(shareTarget.id);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to grant access');
    } finally {
      setShareSaving(false);
    }
  }

  async function handleRevokeShare(orgId: string) {
    if (!shareTarget || !canManageStatusPage(shareTarget)) return;
    setShareSaving(true);
    setShareError('');
    try {
      await unshareStatusPage(shareTarget.id, orgId);
      toast.success('Status page access revoked');
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
      !canManageStatusPage(shareTarget)
    )
      return;
    const destination =
      orgs.find((org) => org.id === transferOrgId)?.name ?? 'the selected organization';
    const ok = await confirm({
      title: `Transfer status page ownership to ${destination}?`,
      message:
        'The current owner will retain shared access. The status page will begin showing the destination organization’s scans and policy results.',
      confirmLabel: 'Transfer',
      variant: 'danger',
    });
    if (!ok) return;
    setShareSaving(true);
    setShareError('');
    try {
      await transferStatusPageOwnership(shareTarget.id, transferOrgId);
      toast.success('Status page ownership transferred');
      shareModal.close();
      await load();
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to transfer ownership');
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
  const transferTargets =
    shareTarget?.owner_type === 'org'
      ? orgs.filter(
          (org) =>
            (isPlatformAdmin || manageableOrgIds.has(org.id)) && org.id !== shareTarget.owner_org_id
        )
      : [];

  function resetForm() {
    setEditing(null);
    setName('');
    setSlug('');
    setDescription('');
    setVisibility('private');
    setIncludeAllTags(false);
    setStaleAfterHours('72');
    setSelectedTargetKeys(new Set());
    setTargetQuery('');
    setImagePatternText('');
    setUpdateTitle('');
    setUpdateBody('');
    setUpdateLevel('info');
    setFormError('');
  }

  function openCreate() {
    if (!canMutateActiveScope) return;
    resetForm();
    modal.open();
  }

  async function openEdit(page: StatusPage) {
    setFormError('');
    try {
      const full = await getStatusPage(page.id);
      setEditing(full.page);
      setName(full.page.name);
      setSlug(full.page.slug);
      setDescription(full.page.description ?? '');
      setVisibility(full.page.visibility);
      setIncludeAllTags(full.page.include_all_tags);
      setStaleAfterHours(String(full.page.stale_after_hours));
      setSelectedTargetKeys(
        new Set(
          (full.page.targets ?? []).map((target) => `${target.image_name}:${target.image_tag}`)
        )
      );
      setTargetQuery('');
      setImagePatternText((full.page.image_patterns ?? []).join('\n'));
      const firstUpdate = full.page.updates?.[0];
      setUpdateTitle(firstUpdate?.title ?? '');
      setUpdateBody(firstUpdate?.body ?? '');
      setUpdateLevel(firstUpdate?.level ?? 'info');
      modal.open();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load status page');
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: 'Delete status page?',
      message: 'The page URL will stop working immediately and all manual updates will be removed.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      await deleteStatusPage(id);
      toast.success('Status page deleted');
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete status page');
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (editing ? !canManageStatusPage(editing) : !canMutateActiveScope) return;
    event.preventDefault();
    setSaving(true);
    setFormError('');

    const trimmedUpdateTitle = updateTitle.trim();
    const trimmedUpdateBody = updateBody.trim();

    const payload: StatusPagePayload = {
      name,
      slug: slug || undefined,
      description,
      visibility,
      ...(editing
        ? {}
        : (() => {
            const currentScope = getWorkScope();
            return currentScope.kind === 'org' ? { org_id: currentScope.orgId } : {};
          })()),
      include_all_tags: includeAllTags,
      image_patterns: imagePatterns,
      stale_after_hours: Number(staleAfterHours) || 72,
      targets: selectedTargets,
      updates:
        trimmedUpdateTitle || trimmedUpdateBody
          ? [{ title: trimmedUpdateTitle, body: trimmedUpdateBody, level: updateLevel }]
          : [],
    };

    try {
      if (editing) {
        await updateStatusPage(editing.id, payload);
        toast.success('Status page updated');
      } else {
        await createStatusPage(payload);
        toast.success('Status page created');
      }
      modal.close();
      resetForm();
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to save status page');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Status Pages"
        description="Publish current image-tag health internally or externally."
        actions={
          <Button onPress={openCreate} isDisabled={!canMutateActiveScope}>
            <PlusSignIcon size={15} /> New Status Page
          </Button>
        }
      />

      {error ? (
        <StatusAlert status="danger" title="Status pages failed to load" description={error} />
      ) : null}

      <div className="space-y-4">
        <Card className="p-3">
          <FilterToolbar
            filters={
              <Select
                value={visibilityFilter}
                onChange={(value) =>
                  setVisibilityFilter(
                    value === 'private' || value === 'authenticated' || value === 'public'
                      ? value
                      : 'all'
                  )
                }
                className="w-full sm:w-[180px]"
                variant="secondary"
              >
                <Select.Trigger className={selectTriggerCls}>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="all">All visibility</ListBox.Item>
                    <ListBox.Item id="private">Private</ListBox.Item>
                    <ListBox.Item id="authenticated">Authenticated</ListBox.Item>
                    <ListBox.Item id="public">Public</ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            }
            search={
              <SearchField
                name="status-pages-search"
                variant="secondary"
                className="w-full sm:max-w-sm"
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search name, slug, or description..."
                  />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
            }
          />
        </Card>

        {loading ? (
          <div className="surface-card flex justify-center rounded-3xl border border-divider/70 py-16">
            <Spinner size="lg" />
          </div>
        ) : filteredPages.length === 0 ? (
          <EmptyState
            action={
              pages.length > 0 || !canMutateActiveScope
                ? undefined
                : { label: 'Create status page', onClick: openCreate }
            }
            description={
              pages.length > 0
                ? 'No status pages match the current filters. Adjust visibility or search terms to widen the results.'
                : 'No status pages exist yet. Create one to publish current image-tag health for a curated or global set of workloads.'
            }
            eyebrow="Status pages"
            icon={<EyeIcon size={28} />}
            title={pages.length > 0 ? 'No matching pages' : 'No status pages yet'}
          />
        ) : (
          <Card className="surface-card overflow-hidden rounded-3xl border border-divider/70">
            <Card.Content className="p-0">
              <Table variant="secondary">
                <Table.ScrollContainer>
                  <Table.Content aria-label="Status pages" className="min-w-[920px]">
                    <Table.Header>
                      <Table.Column isRowHeader>Name</Table.Column>
                      <Table.Column>Visibility</Table.Column>
                      <Table.Column>Scope</Table.Column>
                      <Table.Column>Slug</Table.Column>
                      <Table.Column>Access</Table.Column>
                      <Table.Column>Updated</Table.Column>
                      <Table.Column className="text-right">Actions</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {filteredPages.map((page) => (
                        <Table.Row
                          key={page.id}
                          id={page.id}
                          className="hover:bg-[var(--row-hover)]"
                        >
                          <Table.Cell>
                            <div>
                              <p className="font-medium text-zinc-800 dark:text-zinc-100">
                                {page.name}
                              </p>
                              <p className="text-xs text-zinc-500 mt-0.5 line-clamp-1">
                                {page.description || 'No description'}
                              </p>
                            </div>
                          </Table.Cell>
                          <Table.Cell>
                            <Chip
                              className="capitalize"
                              color={visibilityTone(page.visibility)}
                              size="sm"
                              variant="soft"
                            >
                              {page.visibility}
                            </Chip>
                          </Table.Cell>
                          <Table.Cell className="text-xs text-zinc-500">
                            {describeScope(page)}
                          </Table.Cell>
                          <Table.Cell className="font-mono text-xs text-zinc-600 dark:text-zinc-300">
                            /status/{page.slug}
                          </Table.Cell>
                          <Table.Cell>
                            <div className="mt-1.5">
                              <OwnershipBadge
                                ownerType={page.owner_type}
                                ownerOrgId={page.owner_org_id}
                                orgNamesById={orgNamesById}
                              />
                            </div>
                          </Table.Cell>
                          <Table.Cell className="text-xs text-zinc-500">
                            {timeAgo(page.updated_at)}
                          </Table.Cell>
                          <Table.Cell>
                            <div className="flex justify-end">
                              <RowActionsMenu
                                label={`Open actions menu for ${page.name}`}
                                items={[
                                  {
                                    id: 'open',
                                    label: 'Open page',
                                    icon: <EyeIcon size={15} />,
                                    onAction: () => window.open(`/status/${page.slug}`, '_blank'),
                                  },
                                  ...(canManageStatusPage(page)
                                    ? [
                                        {
                                          id: 'share',
                                          label: 'Manage access',
                                          icon: <Shield01Icon size={15} />,
                                          onAction: () => openShareModal(page),
                                        },
                                        {
                                          id: 'edit',
                                          label: 'Edit status page',
                                          icon: <PencilEdit01Icon size={15} />,
                                          onAction: () => openEdit(page),
                                        },
                                        {
                                          id: 'delete',
                                          label: 'Delete status page',
                                          icon: <Delete01Icon size={15} />,
                                          variant: 'danger' as const,
                                          onAction: () => {
                                            void handleDelete(page.id);
                                          },
                                        },
                                      ]
                                    : []),
                                ]}
                              />
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            </Card.Content>
          </Card>
        )}
      </div>

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="cover" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">
                  {editing ? 'Edit Status Page' : 'Create Status Page'}
                </Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>

              <Modal.Body className="min-h-0 overflow-y-auto overscroll-contain py-5">
                <form id="status-page-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <Alert status="danger">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>{formError}</Alert.Title>
                      </Alert.Content>
                    </Alert>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                    <div className="space-y-1.5">
                      <Label className={fieldLabelCls}>Name</Label>
                      <Input
                        className={fieldCls + ' bg-surface-secondary'}
                        placeholder="Production Containers"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className={fieldLabelCls}>Slug</Label>
                      <Input
                        className={fieldCls + ' bg-surface-secondary'}
                        placeholder="production-containers"
                        value={slug}
                        onChange={(event) => setSlug(event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className={fieldLabelCls}>Description</Label>
                    <TextArea
                      className={textareaCls + ' bg-surface-secondary'}
                      placeholder="Share current security and scan freshness for externally visible workloads."
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                    <Select
                      value={visibility}
                      onChange={(value) => setVisibility(String(value) as StatusPage['visibility'])}
                      className="w-full"
                      placeholder="Select visibility"
                    >
                      <Label className={fieldLabelCls}>Visibility</Label>
                      <Select.Trigger className={selectTriggerCls + ' bg-surface-secondary'}>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {visibilityOptions.map((option) => (
                            <ListBox.Item id={option} key={option} textValue={option}>
                              {option}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <div className="space-y-1.5">
                      <Label className={fieldLabelCls}>Stale After Hours</Label>
                      <Input
                        className={fieldCls + ' bg-surface-secondary'}
                        value={staleAfterHours}
                        onChange={(event) => setStaleAfterHours(event.target.value)}
                        inputMode="numeric"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className={fieldLabelCls}>Image Tag Scope</Label>
                    <Card className="px-4 py-3 bg-surface-secondary">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <Switch isSelected={includeAllTags} onChange={setIncludeAllTags}>
                          <Switch.Content>
                            <Switch.Control>
                              <Switch.Thumb />
                            </Switch.Control>
                            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                              Include all image tags
                            </span>
                            <p className="text-xs text-zinc-500">
                              Ignore the manual selection list and publish every tracked image tag
                              on this page.
                            </p>
                          </Switch.Content>
                        </Switch>
                        <Chip color={includeAllTags ? 'accent' : 'default'} variant="soft">
                          {includeAllTags ? 'On' : 'Off'}
                        </Chip>
                      </div>
                    </Card>
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.95fr)]">
                    <Card
                      className={`space-y-3 bg-surface-secondary p-4${includeAllTags ? ' opacity-50' : ''}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                            Exact Image Tags
                          </p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">
                            Pick individual `image:tag` entries for a tightly curated page.
                          </p>
                        </div>
                        <Chip color="accent" variant="soft">
                          {selectedTargets.length} selected
                        </Chip>
                      </div>

                      <Input
                        className={`${fieldCls} font-mono`}
                        placeholder="Filter by image, tag, or status"
                        value={targetQuery}
                        onChange={(event) => setTargetQuery(event.target.value)}
                        disabled={includeAllTags}
                      />

                      <Card className="overflow-hidden">
                        {loadingOptions ? (
                          <p className="p-4 text-sm text-zinc-500">Loading image tags…</p>
                        ) : filteredTargetOptions.length === 0 ? (
                          <p className="px-4 py-8 text-sm text-zinc-500">
                            {targetQuery.trim()
                              ? 'No image tags match the current filter.'
                              : 'No tracked image tags are available yet.'}
                          </p>
                        ) : (
                          <div className="max-h-80 overflow-y-auto divide-y">
                            {filteredTargetOptions.map((option) => {
                              const isSelected = selectedTargetKeys.has(option.id);
                              return (
                                <label
                                  key={option.id}
                                  className="flex items-start gap-3 p-3 cursor-pointer transition-colors"
                                  style={
                                    isSelected
                                      ? {
                                          background:
                                            'color-mix(in srgb, var(--accent) 9%, transparent)',
                                        }
                                      : undefined
                                  }
                                >
                                  <span
                                    className="relative mt-1 flex size-4 shrink-0 items-center justify-center rounded border transition-colors"
                                    style={
                                      isSelected
                                        ? {
                                            borderColor: 'var(--accent)',
                                            background: 'var(--accent)',
                                          }
                                        : { borderColor: 'rgba(113,113,122,0.4)' }
                                    }
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      disabled={includeAllTags}
                                      className="absolute inset-0 cursor-pointer opacity-0"
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        setSelectedTargetKeys((current) => {
                                          const next = new Set(current);
                                          if (checked) {
                                            next.add(option.id);
                                          } else {
                                            next.delete(option.id);
                                          }
                                          return next;
                                        });
                                      }}
                                    />
                                    {isSelected && (
                                      <svg
                                        className="size-3 text-white pointer-events-none"
                                        viewBox="0 0 12 12"
                                        fill="none"
                                      >
                                        <path
                                          d="M2.5 6l2.5 2.5 4.5-5"
                                          stroke="currentColor"
                                          strokeWidth="1.5"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                      </svg>
                                    )}
                                  </span>

                                  <span className="min-w-0 flex-1 text-left">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="font-mono text-sm break-all text-zinc-800 dark:text-zinc-100">
                                        {option.label}
                                      </p>
                                      <span
                                        className="rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize"
                                        style={
                                          option.latest_status === 'failed'
                                            ? {
                                                background: 'rgba(239,68,68,0.12)',
                                                color: '#f87171',
                                              }
                                            : option.latest_status === 'completed'
                                              ? {
                                                  background: 'rgba(34,197,94,0.12)',
                                                  color: '#4ade80',
                                                }
                                              : {
                                                  background: 'rgba(59,130,246,0.12)',
                                                  color: '#93c5fd',
                                                }
                                        }
                                      >
                                        {option.latest_status}
                                      </span>
                                    </div>
                                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                                      <span>Seen {timeAgo(option.observed_at)}</span>
                                      <span
                                        className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                                        style={{
                                          background: 'rgba(239,68,68,0.1)',
                                          color: '#f87171',
                                        }}
                                      >
                                        C {option.critical_count}
                                      </span>
                                      <span
                                        className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                                        style={{
                                          background: 'rgba(249,115,22,0.1)',
                                          color: '#fb923c',
                                        }}
                                      >
                                        H {option.high_count}
                                      </span>
                                    </div>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </Card>
                    </Card>

                    <Card
                      className={`space-y-3 bg-surface-secondary p-4${includeAllTags ? ' opacity-50' : ''}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                            Regex Include Patterns
                          </p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">
                            One RE2-compatible regex per line. Patterns match against `image:tag`,
                            image name, and tag.
                          </p>
                        </div>
                        <Chip color="accent" variant="soft">
                          {imagePatterns.length} active
                        </Chip>
                      </div>

                      <TextArea
                        className={`${textareaCls} min-h-40 font-mono`}
                        placeholder={`^ghcr\\.io/acme/.+:prod-.*$\n^nginx$\n^.*:stable$`}
                        value={imagePatternText}
                        onChange={(event) => setImagePatternText(event.target.value)}
                        disabled={includeAllTags}
                      />

                      <p className="text-xs leading-5 text-zinc-500">
                        Use regex when the scope is tag-driven or too large to maintain manually.
                        Invalid patterns block save.
                      </p>

                      {invalidImagePatterns.length > 0 && (
                        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">
                          {invalidImagePatterns.map((pattern) => (
                            <p key={pattern.pattern} className="font-mono break-all">
                              {pattern.pattern}: {pattern.error}
                            </p>
                          ))}
                        </div>
                      )}

                      <Card>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                            Preview
                          </p>
                          <Chip color="accent" variant="soft">
                            {regexMatchedOptions.length} matching
                          </Chip>
                        </div>

                        {imagePatterns.length === 0 ? (
                          <p className="mt-3 text-xs leading-5 text-zinc-500">
                            Add a pattern to preview the tracked tags it would include.
                          </p>
                        ) : regexMatchedOptions.length === 0 ? (
                          <p className="mt-3 text-xs leading-5 text-zinc-500">
                            Current patterns do not match any tracked image tags outside your exact
                            selections.
                          </p>
                        ) : (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {regexMatchedOptions.slice(0, 10).map((option) => (
                              <span
                                key={option.id}
                                className="rounded-full px-2.5 py-1 text-xs font-mono"
                                style={{
                                  background: 'rgba(59,130,246,0.12)',
                                  border: '1px solid rgba(59,130,246,0.2)',
                                  color: '#93c5fd',
                                }}
                              >
                                {option.label}
                              </span>
                            ))}
                            {regexMatchedOptions.length > 10 && (
                              <span
                                className="rounded-full px-2.5 py-1 text-xs font-semibold text-zinc-500"
                                style={{
                                  background: 'var(--status-pill-bg)',
                                  border: '1px solid var(--surface-border)',
                                }}
                              >
                                +{regexMatchedOptions.length - 10} more
                              </span>
                            )}
                          </div>
                        )}
                      </Card>
                    </Card>
                  </div>

                  <p className="text-xs text-zinc-500">
                    Choose one or more exact `image:tag` entries, add regex include patterns, or
                    enable “Include all image tags”.
                  </p>

                  {!includeAllTags && (
                    <Card className="bg-surface-secondary">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                            Publish Scope
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {selectedTargets.length} exact tag
                            {selectedTargets.length === 1 ? '' : 's'} and {imagePatterns.length}{' '}
                            regex pattern{imagePatterns.length === 1 ? '' : 's'} configured.
                          </p>
                        </div>
                      </div>

                      {selectedTargets.length > 0 && (
                        <div className="max-h-24 overflow-y-auto [overflow-anchor:none]">
                          <div className="flex flex-wrap gap-2">
                            {selectedTargets.slice(0, 12).map((target) => (
                              <Chip
                                key={`${target.image_name}:${target.image_tag}`}
                                color="accent"
                                variant="soft"
                              >
                                {target.image_name}:{target.image_tag}
                              </Chip>
                            ))}
                            {selectedTargets.length > 12 && (
                              <span
                                className="rounded-full px-2.5 py-1 text-xs font-semibold text-zinc-500"
                                style={{
                                  background: 'var(--status-pill-bg)',
                                  border: '1px solid var(--surface-border)',
                                }}
                              >
                                +{selectedTargets.length - 12} more exact tags
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {imagePatterns.length > 0 && (
                        <div className="max-h-24 overflow-y-auto [overflow-anchor:none]">
                          <div className="flex flex-wrap gap-2">
                            {imagePatterns.map((pattern) => (
                              <span
                                key={pattern}
                                className="rounded-full px-2.5 py-1 text-xs font-mono"
                                style={{
                                  background: 'rgba(59,130,246,0.12)',
                                  border: '1px solid rgba(59,130,246,0.2)',
                                  color: '#93c5fd',
                                }}
                              >
                                {pattern}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {selectedTargets.length === 0 && imagePatterns.length === 0 && (
                        <p className="text-xs leading-5 text-zinc-500">
                          Selections and regex matches will appear here without changing the modal
                          height.
                        </p>
                      )}
                    </Card>
                  )}

                  {!includeAllTags && !loadingOptions && !scopeIsValid && (
                    <p className="text-xs text-red-400">
                      Select at least one exact image tag or add a regex include pattern.
                    </p>
                  )}

                  <div className="grid grid-cols-1 p-2 md:grid-cols-2 gap-4 items-start">
                    <div className="space-y-1.5">
                      <Label className={fieldLabelCls}>Active Banner Title (optional)</Label>
                      <Input
                        className={fieldCls + ' bg-surface-secondary'}
                        value={updateTitle}
                        onChange={(event) => setUpdateTitle(event.target.value)}
                        placeholder="Database refresh in progress"
                      />
                    </div>
                    <Select
                      value={updateLevel}
                      onChange={(value) =>
                        setUpdateLevel(String(value) as (typeof updateLevelOptions)[number])
                      }
                      className="w-full"
                      placeholder="Select a banner level"
                    >
                      <Label className={fieldLabelCls}>Banner Level</Label>
                      <Select.Trigger className={selectTriggerCls + ' bg-surface-secondary'}>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {updateLevelOptions.map((option) => (
                            <ListBox.Item id={option} key={option} textValue={option}>
                              {option}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>

                  <div className="space-y-1.5 p-2">
                    <Label className={fieldLabelCls}>Active Banner Message</Label>
                    <TextArea
                      className={textareaCls + ' bg-surface-secondary'}
                      value={updateBody}
                      onChange={(event) => setUpdateBody(event.target.value)}
                      placeholder="We are re-scanning images after a registry credential rotation. Short-lived stale states are expected."
                    />
                  </div>
                </form>
              </Modal.Body>

              <Modal.Footer
                className="px-6 py-4 flex gap-3 justify-end"
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                <Button variant="secondary" onPress={modal.close}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="status-page-form"
                  isDisabled={
                    saving ||
                    invalidImagePatterns.length > 0 ||
                    !scopeIsValid ||
                    (editing ? !canManageStatusPage(editing) : !canMutateActiveScope)
                  }
                  className="btn-primary"
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
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">
                  Manage Status Page Access
                </Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="py-5 space-y-4">
                {shareError && (
                  <Alert status="danger">
                    <Alert.Indicator />
                    <Alert.Title>{shareError}</Alert.Title>
                  </Alert>
                )}
                {shareTarget ? (
                  <Card className="py-3 bg-surface-secondary">
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {shareTarget.name}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 font-mono">
                      /status/{shareTarget.slug}
                    </p>
                    <div className="mt-2">
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
                      Organizations listed here can open and manage this status page.
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
                          className="flex flex-col items-start justify-between gap-3 px-4 py-3 bg-surface-secondary"
                        >
                          <div>
                            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                              {share.org_name}
                            </p>
                            <p className="text-xs text-zinc-500 mt-0.5">
                              {share.is_owner ? 'Owner workspace' : 'Shared access'}
                            </p>
                          </div>
                          <div>
                            {share.is_owner ? (
                              <span className="text-xs font-medium text-zinc-500">Locked</span>
                            ) : (
                              <Button
                                onClick={() => {
                                  void handleRevokeShare(share.org_id);
                                }}
                                isDisabled={shareSaving}
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
                      Share this status page with another organization you manage.
                    </p>
                  </div>
                  {availableShareTargets.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                      No additional organizations are available for sharing.
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        placeholder="Select an organization"
                        value={shareOrgId}
                        onChange={(value) => setShareOrgId(String(value))}
                      >
                        <Select.Trigger
                          className={`${heroFieldClassName} flex-1 bg-surface-secondary`}
                        >
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {availableShareTargets.map((org) => (
                              <ListBox.Item key={org.id} id={org.id} textValue={org.name}>
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
                        className="btn-primary"
                      >
                        Grant
                      </Button>
                    </div>
                  )}
                </div>
                <OwnershipTransfer
                  ownerOrgId={shareTarget?.owner_type === 'org' ? shareTarget.owner_org_id : null}
                  organizations={transferTargets}
                  selectedOrgId={transferOrgId}
                  onSelectedOrgIdChange={setTransferOrgId}
                  onTransfer={() => void handleTransferOwnership()}
                  isSaving={shareSaving}
                  warning="Displayed scans and policy results will use the destination organization."
                />
              </Modal.Body>
              <Modal.Footer
                className="px-6 py-4 flex justify-end"
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                <Button className="btn-secondary" onPress={shareModal.close}>
                  Close
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {dialog}
    </div>
  );
}
