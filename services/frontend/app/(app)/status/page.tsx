'use client';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { OwnershipBadge } from '@/components/ui/badges';
import { fieldLabelClassName, heroFieldClassName, heroSelectTriggerClassName, heroTextAreaClassName } from '@/components/ui/form-styles';
import { useOrgDirectory } from '@/hooks/use-org-name-map';
import {
    createStatusPage,
    deleteStatusPage,
  getTokenType,
    getUser,
  getWorkScope,
    getStatusPage,
    listStatusPages,
  listStatusPageShares,
    listStatusPageTargetOptions,
  ResourceShare,
  shareStatusPage,
    StatusPage,
    StatusPagePayload,
    StatusPageTarget,
    StatusPageTargetOption,
  unshareStatusPage,
    updateStatusPage,
} from '@/lib/api';
import { timeAgo } from '@/lib/time';
import { Button, Card, Input, Label, ListBox, Modal, Select, Switch, TextArea, useOverlayState } from '@heroui/react';
import { Delete01Icon, EyeIcon, PencilEdit01Icon, PlusSignIcon, Shield01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

const fieldCls = heroFieldClassName;
const textareaCls = heroTextAreaClassName;
const selectTriggerCls = heroSelectTriggerClassName;
const fieldLabelCls = fieldLabelClassName;

const visibilityOptions: Array<StatusPage['visibility']> = ['private', 'authenticated', 'public'];
const updateLevelOptions = ['info', 'maintenance', 'incident'] as const;
const exactSelectionBadgeStyle = {
  background: 'rgba(124,58,237,0.12)',
  border: '1px solid rgba(124,58,237,0.22)',
  color: '#c4b5fd',
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
    .map(pattern => pattern.trim())
    .filter(pattern => {
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

export default function StatusPagesPage() {
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
  const [shareOrgId, setShareOrgId] = useState('');
  const [shareError, setShareError] = useState('');
  const [shareSaving, setShareSaving] = useState(false);
  const [sharesLoading, setSharesLoading] = useState(false);
  const modal = useOverlayState();
  const shareModal = useOverlayState();
  const toast = useToast();
  const { confirm, dialog } = useConfirmDialog();
  const isPlatformAdmin = getTokenType() === 'admin';
  const currentUserId = getUser()?.id as string | undefined;
  const manageableOrgIds = new Set(orgs.filter((org) => org.current_user_role === 'owner' || org.current_user_role === 'admin').map((org) => org.id));

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
    load();
  }, [load]);

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
  }, []);

  useEffect(() => {
    if (!modal.isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        modal.close();
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [modal]);

  const selectedTargets = useMemo(() => {
    const keys = Array.from(selectedTargetKeys).map(String);
    return keys
      .map((key, index) => {
        const option = targetOptions.find(candidate => candidate.id === key);
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
    return splitImagePatterns(imagePatternText).map(pattern => {
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
    () => parsedImagePatterns.filter(pattern => !pattern.error).map(pattern => pattern.pattern),
    [parsedImagePatterns],
  );

  const invalidImagePatterns = useMemo(
    () => parsedImagePatterns.filter(pattern => Boolean(pattern.error)),
    [parsedImagePatterns],
  );

  const filteredTargetOptions = useMemo(() => {
    const query = targetQuery.trim().toLowerCase();
    if (!query) {
      return targetOptions;
    }
    return targetOptions.filter(option => (
      option.label.toLowerCase().includes(query)
      || option.image_name.toLowerCase().includes(query)
      || option.image_tag.toLowerCase().includes(query)
      || option.latest_status.toLowerCase().includes(query)
    ));
  }, [targetOptions, targetQuery]);

  const regexMatchedOptions = useMemo(() => {
    const regexes = parsedImagePatterns.flatMap(pattern => (pattern.regex ? [pattern.regex] : []));
    if (includeAllTags || regexes.length === 0) {
      return [];
    }

    return targetOptions.filter(option => {
      if (selectedTargetKeys.has(option.id)) {
        return false;
      }
      return regexes.some(regex => matchesPattern(regex, option));
    });
  }, [includeAllTags, parsedImagePatterns, selectedTargetKeys, targetOptions]);

  const scopeIsValid = includeAllTags || selectedTargets.length > 0 || imagePatterns.length > 0;

  function canManageStatusPage(page: StatusPage) {
    if (isPlatformAdmin) return true;
    if (page.owner_type === 'org' && page.owner_org_id) {
      return manageableOrgIds.has(page.owner_org_id);
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
    setShareTarget(page);
    setShareOrgId('');
    setShareError('');
    setShares([]);
    shareModal.open();
    void loadShares(page.id);
  }

  async function handleGrantShare() {
    if (!shareTarget || !shareOrgId) return;
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
    if (!shareTarget) return;
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

  const availableShareTargets = shareTarget
    ? orgs.filter((org) => (isPlatformAdmin || manageableOrgIds.has(org.id)) && org.id !== shareTarget.owner_org_id && !shares.some((share) => share.org_id === org.id))
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
      setSelectedTargetKeys(new Set((full.page.targets ?? []).map(target => `${target.image_name}:${target.image_tag}`)));
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
    event.preventDefault();
    setSaving(true);
    setFormError('');

    const payload: StatusPagePayload = {
      name,
      slug: slug || undefined,
      description,
      visibility,
      ...(editing ? {} : (() => {
        const currentScope = getWorkScope();
        return currentScope.kind === 'org' ? { org_id: currentScope.orgId } : {};
      })()),
      include_all_tags: includeAllTags,
      image_patterns: imagePatterns,
      stale_after_hours: Number(staleAfterHours) || 72,
      targets: selectedTargets,
      updates: updateTitle.trim()
        ? [{ title: updateTitle.trim(), body: updateBody.trim(), level: updateLevel }]
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
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Status Pages</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Publish current image-tag health internally or externally.</p>
        </div>
        <Button
          onPress={openCreate}
          className="btn-primary"
        >
          <PlusSignIcon size={15} /> New Status Page
        </Button>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
        </div>
      ) : pages.length === 0 ? (
        <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3 text-center">
          <EyeIcon size={32} color="rgba(113,113,122,0.5)" />
          <p className="text-sm text-zinc-500 max-w-lg">No status pages yet. Create one to share the latest status of all image tags or a curated subset.</p>
        </div>
      ) : (
        <Card className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Visibility</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Scope</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Slug</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {pages.map((page, index) => (
                <tr
                  key={page.id}
                  style={{ borderTop: index > 0 ? '1px solid var(--row-divider)' : undefined }}
                  onMouseEnter={event => (event.currentTarget.style.background = 'var(--row-hover)')}
                  onMouseLeave={event => (event.currentTarget.style.background = 'transparent')}
                >
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-zinc-800 dark:text-zinc-100">{page.name}</p>
                      <p className="text-xs text-zinc-500 mt-0.5 line-clamp-1">{page.description || 'No description'}</p>
                      <div className="mt-1.5">
                        <OwnershipBadge ownerType={page.owner_type} ownerOrgId={page.owner_org_id} orgNamesById={orgNamesById} />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                      style={page.visibility === 'public'
                        ? { background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)' }
                        : page.visibility === 'authenticated'
                        ? { background: 'rgba(59,130,246,0.12)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.2)' }
                        : { background: 'rgba(113,113,122,0.12)', color: '#a1a1aa', border: '1px solid rgba(113,113,122,0.2)' }}>
                      {page.visibility}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{describeScope(page)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300">/status/{page.slug}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{timeAgo(page.updated_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`/status/${page.slug}`} target="_blank" className="text-zinc-400 dark:text-zinc-600 hover:text-violet-500 dark:hover:text-violet-400 transition-colors p-1.5" title="Open page">
                        <EyeIcon size={15} />
                      </Link>
                      {canManageStatusPage(page) && (
                        <>
                          <button onClick={() => openShareModal(page)} className="text-zinc-400 dark:text-zinc-600 hover:text-violet-500 dark:hover:text-violet-400 transition-colors p-1.5" title="Manage access" type="button">
                            <Shield01Icon size={15} />
                          </button>
                          <button onClick={() => openEdit(page)} className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors p-1.5" title="Edit" type="button">
                            <PencilEdit01Icon size={15} />
                          </button>
                          <button onClick={() => handleDelete(page.id)} className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors p-1.5" title="Delete" type="button">
                            <Delete01Icon size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {modal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <button
            type="button"
            aria-label="Close status page editor"
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={modal.close}
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="status-page-modal-heading"
            className="glass-modal relative z-10 grid max-h-[calc(100dvh-2rem)] w-[min(1120px,calc(100vw-1.5rem))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl"
          >
            <div className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="flex items-center justify-between gap-4">
                <h2 id="status-page-modal-heading" className="text-zinc-900 dark:text-white font-semibold">{editing ? 'Edit Status Page' : 'Create Status Page'}</h2>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={modal.close}
                  className="rounded-md px-2 py-1 text-sm text-zinc-500 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  x
                </button>
              </div>
            </div>

            <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-5">
                <form id="status-page-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-xl px-3 py-2.5 text-sm"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {formError}
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                    <div className="space-y-1.5">
                      <Label className={fieldLabelCls}>Name</Label>
                      <Input className={fieldCls} placeholder="Production Containers" value={name} onChange={event => setName(event.target.value)} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label className={fieldLabelCls}>Slug</Label>
                      <Input className={`${fieldCls} font-mono`} placeholder="production-containers" value={slug} onChange={event => setSlug(event.target.value)} />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className={fieldLabelCls}>Description</Label>
                    <TextArea className={textareaCls} placeholder="Share current security and scan freshness for externally visible workloads." value={description} onChange={event => setDescription(event.target.value)} />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                    <Select selectedKey={visibility} onSelectionChange={key => setVisibility(String(key) as StatusPage['visibility'])} className="w-full" placeholder="Select visibility">
                      <Label className={fieldLabelCls}>Visibility</Label>
                      <Select.Trigger className={selectTriggerCls}>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {visibilityOptions.map(option => (
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
                      <Input className={fieldCls} value={staleAfterHours} onChange={event => setStaleAfterHours(event.target.value)} inputMode="numeric" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className={fieldLabelCls}>Image Tag Scope</Label>
                    <div
                      className="rounded-xl border px-4 py-3 transition-colors"
                      style={includeAllTags
                        ? {
                            borderColor: 'rgba(124,58,237,0.32)',
                            background: 'rgba(124,58,237,0.12)',
                            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 0 0 1px rgba(124,58,237,0.08)',
                          }
                        : {
                            borderColor: 'var(--glass-border)',
                            background: 'var(--row-hover)',
                          }}
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <Switch isSelected={includeAllTags} onChange={setIncludeAllTags}>
                          <Switch.Control>
                            <Switch.Thumb />
                          </Switch.Control>
                          <Switch.Content>
                            <Label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Include all image tags</Label>
                            <p className="text-xs text-zinc-500">Ignore the manual selection list and publish every tracked image tag on this page.</p>
                          </Switch.Content>
                        </Switch>
                        <span
                          className="shrink-0 self-start rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide md:self-center"
                          style={includeAllTags
                            ? { background: 'rgba(124,58,237,0.18)', color: '#c4b5fd' }
                            : { background: 'rgba(113,113,122,0.12)', color: '#a1a1aa' }}
                        >
                          {includeAllTags ? 'On' : 'Off'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.95fr)]">
                    <div
                      className={`space-y-3 rounded-2xl border p-4${includeAllTags ? ' opacity-50' : ''}`}
                      style={{ borderColor: 'var(--glass-border)', background: 'var(--input-bg)' }}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Exact Image Tags</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">Pick individual `image:tag` entries for a tightly curated page.</p>
                        </div>
                        <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={exactSelectionBadgeStyle}>
                          {selectedTargets.length} selected
                        </span>
                      </div>

                      <Input
                        className={`${fieldCls} font-mono`}
                        placeholder="Filter by image, tag, or status"
                        value={targetQuery}
                        onChange={event => setTargetQuery(event.target.value)}
                        disabled={includeAllTags}
                      />

                      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)' }}>
                        {loadingOptions ? (
                          <p className="px-4 py-4 text-sm text-zinc-500">Loading image tags…</p>
                        ) : filteredTargetOptions.length === 0 ? (
                          <p className="px-4 py-8 text-sm text-zinc-500">
                            {targetQuery.trim() ? 'No image tags match the current filter.' : 'No tracked image tags are available yet.'}
                          </p>
                        ) : (
                          <div className="max-h-80 overflow-y-auto divide-y">
                            {filteredTargetOptions.map(option => {
                              const isSelected = selectedTargetKeys.has(option.id);
                              return (
                                <label
                                  key={option.id}
                                  className="flex items-start gap-3 px-3 py-3 cursor-pointer transition-colors"
                                  style={isSelected
                                    ? { background: 'rgba(124,58,237,0.09)' }
                                    : undefined}
                                >
                                  {/* Wrap the visual checkbox in a relative container so the
                                      native input can be overlaid exactly on top of it.
                                      This ensures that when the input receives focus after a click,
                                      the browser's scroll-to-element moves to the exact spot the
                                      user already clicked — resulting in zero scroll movement. */}
                                  <span className="relative mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors"
                                    style={isSelected
                                      ? { borderColor: '#7c3aed', background: '#7c3aed' }
                                      : { borderColor: 'rgba(113,113,122,0.4)' }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      disabled={includeAllTags}
                                      className="absolute inset-0 cursor-pointer opacity-0"
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        setSelectedTargetKeys(current => {
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
                                      <svg className="h-3 w-3 text-white pointer-events-none" viewBox="0 0 12 12" fill="none">
                                        <path d="M2.5 6l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    )}
                                  </span>

                                  <span className="min-w-0 flex-1 text-left"
                                    >
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-mono text-sm break-all text-zinc-800 dark:text-zinc-100">{option.label}</p>
                                        <span
                                          className="rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize"
                                          style={option.latest_status === 'failed'
                                            ? { background: 'rgba(239,68,68,0.12)', color: '#f87171' }
                                            : option.latest_status === 'completed'
                                              ? { background: 'rgba(34,197,94,0.12)', color: '#4ade80' }
                                              : { background: 'rgba(59,130,246,0.12)', color: '#93c5fd' }}
                                        >
                                          {option.latest_status}
                                        </span>
                                      </div>
                                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                                        <span>Seen {timeAgo(option.observed_at)}</span>
                                        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>
                                          C {option.critical_count}
                                        </span>
                                        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'rgba(249,115,22,0.1)', color: '#fb923c' }}>
                                          H {option.high_count}
                                        </span>
                                      </div>
                                    </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    <div
                      className={`space-y-3 rounded-2xl border p-4${includeAllTags ? ' opacity-50' : ''}`}
                      style={{ borderColor: 'var(--glass-border)', background: 'var(--input-bg)' }}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Regex Include Patterns</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">One RE2-compatible regex per line. Patterns match against `image:tag`, image name, and tag.</p>
                        </div>
                        <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={exactSelectionBadgeStyle}>
                          {imagePatterns.length} active
                        </span>
                      </div>

                      <TextArea
                        className={`${textareaCls} min-h-40 font-mono`}
                        placeholder={`^ghcr\\.io/acme/.+:prod-.*$\n^nginx$\n^.*:stable$`}
                        value={imagePatternText}
                        onChange={event => setImagePatternText(event.target.value)}
                        disabled={includeAllTags}
                      />

                      <p className="text-xs leading-5 text-zinc-500">Use regex when the scope is tag-driven or too large to maintain manually. Invalid patterns block save.</p>

                      {invalidImagePatterns.length > 0 && (
                        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-3 py-3 text-xs text-red-400">
                          {invalidImagePatterns.map(pattern => (
                            <p key={pattern.pattern} className="font-mono break-all">{pattern.pattern}: {pattern.error}</p>
                          ))}
                        </div>
                      )}

                      <div className="rounded-2xl border px-3 py-3" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)' }}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Preview</p>
                          <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={exactSelectionBadgeStyle}>
                            {regexMatchedOptions.length} matching
                          </span>
                        </div>

                        {imagePatterns.length === 0 ? (
                          <p className="mt-3 text-xs leading-5 text-zinc-500">Add a pattern to preview the tracked tags it would include.</p>
                        ) : regexMatchedOptions.length === 0 ? (
                          <p className="mt-3 text-xs leading-5 text-zinc-500">Current patterns do not match any tracked image tags outside your exact selections.</p>
                        ) : (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {regexMatchedOptions.slice(0, 10).map(option => (
                              <span
                                key={option.id}
                                className="rounded-full px-2.5 py-1 text-xs font-mono"
                                style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.2)', color: '#93c5fd' }}
                              >
                                {option.label}
                              </span>
                            ))}
                            {regexMatchedOptions.length > 10 && (
                              <span className="rounded-full px-2.5 py-1 text-xs font-semibold text-zinc-500" style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--glass-border)' }}>
                                +{regexMatchedOptions.length - 10} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-zinc-500">Choose one or more exact `image:tag` entries, add regex include patterns, or enable “Include all image tags”.</p>

                  {!includeAllTags && (
                    <div
                      className="space-y-3 rounded-2xl border px-4 py-4 min-h-[8.5rem]"
                      style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)', overflowAnchor: 'none' }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Publish Scope</p>
                          <p className="mt-1 text-xs text-zinc-500">{selectedTargets.length} exact tag{selectedTargets.length === 1 ? '' : 's'} and {imagePatterns.length} regex pattern{imagePatterns.length === 1 ? '' : 's'} configured.</p>
                        </div>
                      </div>

                      {selectedTargets.length > 0 && (
                        <div className="max-h-24 overflow-y-auto [overflow-anchor:none]">
                          <div className="flex flex-wrap gap-2">
                          {selectedTargets.slice(0, 12).map(target => (
                            <span
                              key={`${target.image_name}:${target.image_tag}`}
                              className="rounded-full px-2.5 py-1 text-xs font-medium"
                              style={exactSelectionBadgeStyle}
                            >
                              {target.image_name}:{target.image_tag}
                            </span>
                          ))}
                          {selectedTargets.length > 12 && (
                            <span className="rounded-full px-2.5 py-1 text-xs font-semibold text-zinc-500" style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--glass-border)' }}>
                              +{selectedTargets.length - 12} more exact tags
                            </span>
                          )}
                          </div>
                        </div>
                      )}

                      {imagePatterns.length > 0 && (
                        <div className="max-h-24 overflow-y-auto [overflow-anchor:none]">
                          <div className="flex flex-wrap gap-2">
                          {imagePatterns.map(pattern => (
                            <span
                              key={pattern}
                              className="rounded-full px-2.5 py-1 text-xs font-mono"
                              style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.2)', color: '#93c5fd' }}
                            >
                              {pattern}
                            </span>
                          ))}
                          </div>
                        </div>
                      )}

                      {selectedTargets.length === 0 && imagePatterns.length === 0 && (
                        <p className="text-xs leading-5 text-zinc-500">Selections and regex matches will appear here without changing the modal height.</p>
                      )}
                    </div>
                  )}

                  {!includeAllTags && !loadingOptions && !scopeIsValid && (
                    <p className="text-xs text-red-400">Select at least one exact image tag or add a regex include pattern.</p>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                    <div className="space-y-1.5">
                      <Label className={fieldLabelCls}>Active Banner Title</Label>
                      <Input className={fieldCls} value={updateTitle} onChange={event => setUpdateTitle(event.target.value)} placeholder="Database refresh in progress" />
                    </div>
                    <Select selectedKey={updateLevel} onSelectionChange={key => setUpdateLevel(String(key) as (typeof updateLevelOptions)[number])} className="w-full" placeholder="Select a banner level">
                      <Label className={fieldLabelCls}>Banner Level</Label>
                      <Select.Trigger className={selectTriggerCls}>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {updateLevelOptions.map(option => (
                            <ListBox.Item id={option} key={option} textValue={option}>
                              {option}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className={fieldLabelCls}>Active Banner Message</Label>
                    <TextArea className={textareaCls} value={updateBody} onChange={event => setUpdateBody(event.target.value)} placeholder="We are re-scanning images after a registry credential rotation. Short-lived stale states are expected." />
                  </div>
                </form>
            </div>

            <div className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <Button className="btn-secondary" onPress={modal.close}>Cancel</Button>
                <Button type="submit" form="status-page-form" isDisabled={saving || invalidImagePatterns.length > 0 || !scopeIsValid}
                  className="btn-primary">
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {editing ? 'Save' : 'Create'}
                </Button>
            </div>
          </div>
        </div>
      )}
      <Modal state={shareModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">Manage Status Page Access</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5 space-y-4">
                {shareError && (
                  <div className="rounded-xl px-3 py-2.5 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                    {shareError}
                  </div>
                )}
                {shareTarget ? (
                  <div className="rounded-xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{shareTarget.name}</p>
                    <p className="mt-1 text-xs text-zinc-500 font-mono">/status/{shareTarget.slug}</p>
                    <div className="mt-2">
                      <OwnershipBadge ownerType={shareTarget.owner_type} ownerOrgId={shareTarget.owner_org_id} orgNamesById={orgNamesById} />
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Current access</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">Organizations listed here can open and manage this status page.</p>
                  </div>
                  {sharesLoading ? (
                    <div className="flex justify-center py-6">
                      <div className="w-5 h-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
                    </div>
                  ) : shares.length === 0 ? (
                    <p className="text-sm text-zinc-500">No organization grants yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {shares.map((share) => (
                        <div key={share.org_id} className="flex items-start justify-between gap-3 rounded-xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{share.org_name}</p>
                            <p className="text-xs text-zinc-500 mt-0.5">{share.is_owner ? 'Owner workspace' : 'Shared access'}</p>
                          </div>
                          {share.is_owner ? (
                            <span className="text-xs font-medium text-zinc-500">Locked</span>
                          ) : (
                            <button type="button" onClick={() => { void handleRevokeShare(share.org_id); }} disabled={shareSaving} className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors disabled:opacity-50">
                              <Delete01Icon size={15} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Grant access</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">Share this status page with another organization you manage.</p>
                  </div>
                  {availableShareTargets.length === 0 ? (
                    <p className="text-sm text-zinc-500">No additional organizations are available for sharing.</p>
                  ) : (
                    <div className="flex gap-2">
                      <select
                        className={`${heroFieldClassName} flex-1`}
                        value={shareOrgId}
                        onChange={(event) => setShareOrgId(event.target.value)}
                      >
                        <option value="">Select an organization</option>
                        {availableShareTargets.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
                      </select>
                      <Button type="button" onPress={() => { void handleGrantShare(); }} isDisabled={!shareOrgId || shareSaving} className="btn-primary">
                        Grant
                      </Button>
                    </div>
                  )}
                </div>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <Button className="btn-secondary" onPress={shareModal.close}>Close</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {dialog}
    </div>
  );
}