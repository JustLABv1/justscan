'use client';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import {
    createStatusPage,
    deleteStatusPage,
    getStatusPage,
    listStatusPages,
    listStatusPageTargetOptions,
    StatusPage,
    StatusPagePayload,
    StatusPageTarget,
    StatusPageTargetOption,
    updateStatusPage,
} from '@/lib/api';
import { timeAgo } from '@/lib/time';
import { Button, Card, Input, Label, ListBox, Modal, Select, Switch, TextArea, useOverlayState } from '@heroui/react';
import { Delete01Icon, EyeIcon, PencilEdit01Icon, PlusSignIcon } from 'hugeicons-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

const fieldCls = 'glass-input w-full min-h-11 rounded-xl px-3 text-sm';
const textareaCls = 'glass-input w-full min-h-28 rounded-xl px-3 py-2.5 text-sm resize-y';
const selectTriggerCls = 'glass-input w-full min-h-11 rounded-xl px-3 text-sm';
const fieldLabelCls = 'block text-sm font-medium text-zinc-600 dark:text-zinc-300';

const visibilityOptions: Array<StatusPage['visibility']> = ['private', 'authenticated', 'public'];
const updateLevelOptions = ['info', 'maintenance', 'incident'] as const;

export default function StatusPagesPage() {
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
  const [updateTitle, setUpdateTitle] = useState('');
  const [updateBody, setUpdateBody] = useState('');
  const [updateLevel, setUpdateLevel] = useState<(typeof updateLevelOptions)[number]>('info');
  const modal = useOverlayState();
  const toast = useToast();
  const { confirm, dialog } = useConfirmDialog();

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

  const selectedTargetSummary = useMemo(() => {
    if (selectedTargets.length === 0) return 'No image tags selected';
    if (selectedTargets.length === 1) return `${selectedTargets[0].image_name}:${selectedTargets[0].image_tag}`;
    return `${selectedTargets.length} image tags selected`;
  }, [selectedTargets]);

  function resetForm() {
    setEditing(null);
    setName('');
    setSlug('');
    setDescription('');
    setVisibility('private');
    setIncludeAllTags(false);
    setStaleAfterHours('72');
    setSelectedTargetKeys(new Set());
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
      include_all_tags: includeAllTags,
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
          className="rounded-xl text-sm font-semibold"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 20px rgba(124,58,237,0.4),inset 0 1px 0 rgba(255,255,255,0.15)' }}
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
                  <td className="px-4 py-3 text-xs text-zinc-500">{page.include_all_tags ? 'All image tags' : `${page.targets?.length ?? 0} selected`}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300">/status/{page.slug}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{timeAgo(page.updated_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`/status/${page.slug}`} target="_blank" className="text-zinc-400 dark:text-zinc-600 hover:text-violet-500 dark:hover:text-violet-400 transition-colors p-1.5" title="Open page">
                        <EyeIcon size={15} />
                      </Link>
                      <button onClick={() => openEdit(page)} className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors p-1.5" title="Edit" type="button">
                        <PencilEdit01Icon size={15} />
                      </button>
                      <button onClick={() => handleDelete(page.id)} className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors p-1.5" title="Delete" type="button">
                        <Delete01Icon size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="lg" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">{editing ? 'Edit Status Page' : 'Create Status Page'}</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
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
                      <Input className={fieldCls} placeholder="Production Containers" value={name} onChange={event => setName(event.target.value)} isRequired />
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

                  <Select
                    placeholder={loadingOptions ? 'Loading image tags...' : 'Select one or more image tags'}
                    selectionMode="multiple"
                    selectedKeys={selectedTargetKeys}
                    onSelectionChange={selection => {
                      if (selection === 'all') {
                        setSelectedTargetKeys(new Set(targetOptions.map(option => option.id)));
                        return;
                      }
                      setSelectedTargetKeys(new Set(Array.from(selection).map(String)));
                    }}
                    isDisabled={includeAllTags}
                    className="w-full"
                  >
                    <Label className={fieldLabelCls}>Selected Image Tags</Label>
                    <Select.Trigger className={`${selectTriggerCls} min-h-12`}>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox selectionMode="multiple">
                        {targetOptions.map(option => (
                          <ListBox.Item id={option.id} key={option.id} textValue={option.label}>
                            <div className="grid w-full grid-cols-[minmax(0,1fr)_3rem_1.25rem] items-start gap-3">
                              <div className="min-w-0">
                                <p className="font-mono text-sm break-words text-zinc-800 dark:text-zinc-100">{option.label}</p>
                                <p className="text-xs text-zinc-500 mt-0.5">{option.latest_status} · {timeAgo(option.observed_at)}</p>
                              </div>
                              <div className="pt-0.5 text-right text-xs text-zinc-500">
                                <p>C {option.critical_count}</p>
                                <p>H {option.high_count}</p>
                              </div>
                              <div className="flex justify-end pt-0.5">
                                <ListBox.ItemIndicator className="shrink-0 text-violet-400" />
                              </div>
                            </div>
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                  <p className="text-xs text-zinc-500">Choose one or more `image:tag` entries, or enable “Include all image tags”.</p>
                  {!includeAllTags && selectedTargets.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedTargets.map(target => (
                        <span
                          key={`${target.image_name}:${target.image_tag}`}
                          className="rounded-full px-2.5 py-1 text-xs font-medium"
                          style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.22)', color: '#c4b5fd' }}
                        >
                          {target.image_name}:{target.image_tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {!includeAllTags && selectedTargets.length === 0 && !loadingOptions && (
                    <p className="text-xs text-zinc-500">{selectedTargetSummary}</p>
                  )}
                  {!includeAllTags && !loadingOptions && selectedTargets.length === 0 && (
                    <p className="text-xs text-red-400">Select at least one image tag.</p>
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
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <Button onPress={modal.close} className="rounded-xl" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}>Cancel</Button>
                <Button type="submit" form="status-page-form" isDisabled={saving || (!includeAllTags && selectedTargets.length === 0)}
                  className="rounded-xl text-white"
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 16px rgba(124,58,237,0.35),inset 0 1px 0 rgba(255,255,255,0.15)' }}>
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {editing ? 'Save' : 'Create'}
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