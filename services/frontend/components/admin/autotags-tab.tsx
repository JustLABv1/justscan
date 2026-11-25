'use client';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { FormAlert, StatusAlert } from '@/components/ui/form-alert';
import { StatusTag } from '@/components/ui/status-dot';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import {
  createAutoTagRule,
  deleteAutoTagRule,
  listAutoTagRules,
  updateAutoTagRule,
} from '@/lib/api/admin';
import { listTags } from '@/lib/api/tags';
import type { AutoTagRule } from '@/lib/api/types/registries';
import type { Tag } from '@/lib/api/types/scans';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';
import {
  Button,
  Card,
  Description,
  Input,
  Label,
  ListBox,
  Modal,
  ResourceList,
  SearchField,
  Select,
  TablePager,
  TextField,
  useOverlayState,
} from '@/components/ui';
import { Delete01Icon, PencilEdit01Icon, PlusSignIcon, Tag01Icon } from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

const PAGE_SIZE = 10;

export function AutoTagsTab() {
  const [rules, setRules] = useState<AutoTagRule[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingRule, setEditingRule] = useState<AutoTagRule | null>(null);
  const [isCreate, setIsCreate] = useState(false);
  const [formPattern, setFormPattern] = useState('');
  const [formTagId, setFormTagId] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextRules, nextTags] = await Promise.all([listAutoTagRules(), listTags()]);
      setRules(nextRules);
      setTags(nextTags);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load auto-tag rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => deferEffect(load), [load]);

  function openCreate() {
    setIsCreate(true);
    setEditingRule(null);
    setFormPattern('');
    setFormTagId(tags[0]?.id ?? '');
    setFormError('');
    modal.open();
  }

  function openEdit(rule: AutoTagRule) {
    setIsCreate(false);
    setEditingRule(rule);
    setFormPattern(rule.pattern);
    setFormTagId(rule.tag_id);
    setFormError('');
    modal.open();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setFormError('');
    setSaving(true);
    try {
      if (isCreate) await createAutoTagRule(formPattern, formTagId);
      else if (editingRule) await updateAutoTagRule(editingRule.id, formPattern, formTagId);
      modal.close();
      await load();
    } catch (saveError: unknown) {
      setFormError(saveError instanceof Error ? saveError.message : 'Failed to save auto-tag rule');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: 'Delete auto-tag rule?',
      message: 'The rule will no longer apply to new scans.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    if (pendingAction) return;
    setPendingAction(`delete:${id}`);
    try {
      await deleteAutoTagRule(id);
      toast.success('Auto-tag rule deleted');
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete auto-tag rule');
    } finally {
      setPendingAction(null);
    }
  }

  const tagById = useCallback((id: string) => tags.find((tag) => tag.id === id), [tags]);

  const filteredRules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rules.filter((rule) => {
      const tag = rule.tag ?? tagById(rule.tag_id);
      return (
        q.length === 0 ||
        rule.pattern.toLowerCase().includes(q) ||
        (tag?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [rules, searchQuery, tagById]);

  const totalPages = Math.max(1, Math.ceil(filteredRules.length / PAGE_SIZE));
  const effectivePage = Math.min(page, totalPages);
  const pagedRules = filteredRules.slice(
    (effectivePage - 1) * PAGE_SIZE,
    effectivePage * PAGE_SIZE
  );

  return (
    <AdminPageShell
      actions={
        <Button size="sm" onPress={openCreate}>
          <PlusSignIcon size={15} />
          Add rule
        </Button>
      }
    >
      <div className="space-y-4">
        {error ? (
          <StatusAlert status="danger" title="Auto-tag rules failed to load" description={error} />
        ) : null}

        {!loading && !error && rules.length === 0 ? (
          <EmptyState
            icon={<Tag01Icon size={20} />}
            title="No auto-tag rules yet"
            description="Rules tag new scans automatically when the image name matches a pattern such as nginx/*."
            action={{ label: 'Add rule', onClick: openCreate }}
          />
        ) : (
          <Card className="gap-0 overflow-hidden py-0">
            <div className="border-b border-border p-4">
              <FilterToolbar
                search={
                  <SearchField
                    aria-label="Filter auto-tag rules"
                    name="admin-autotags-search"
                    variant="secondary"
                    className="w-full sm:max-w-md"
                    value={searchQuery}
                    onChange={(value) => {
                      setSearchQuery(value);
                      setPage(1);
                    }}
                  >
                    <SearchField.Group>
                      <SearchField.SearchIcon />
                      <SearchField.Input placeholder="Filter by pattern or tag..." />
                      <SearchField.ClearButton />
                    </SearchField.Group>
                  </SearchField>
                }
              />
            </div>

            {pagedRules.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                {loading ? 'Loading auto-tag rules...' : 'No auto-tag rules match your filter.'}
              </p>
            ) : (
              <ResourceList bordered={false} aria-label="Auto-tag rules">
                {pagedRules.map((rule) => {
                  const tag = rule.tag ?? tagById(rule.tag_id);
                  return (
                    <ResourceList.Item
                      key={rule.id}
                      title={<span className="font-mono">{rule.pattern}</span>}
                      titleTooltip={rule.pattern}
                      description={
                        <span title={fullDate(rule.created_at)}>
                          Created {timeAgo(rule.created_at)}
                        </span>
                      }
                      meta={
                        tag ? (
                          <span className="inline-flex max-w-48 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-medium">
                            <span
                              aria-hidden
                              className="size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: tag.color }}
                            />
                            <span className="truncate" title={tag.name}>
                              {tag.name}
                            </span>
                          </span>
                        ) : (
                          <StatusTag tone="warning">Deleted tag</StatusTag>
                        )
                      }
                      actions={
                        <RowActionsMenu
                          label={`Open actions for pattern ${rule.pattern}`}
                          items={[
                            {
                              id: 'edit',
                              label: 'Edit rule',
                              icon: <PencilEdit01Icon size={15} />,
                              onAction: () => openEdit(rule),
                            },
                            {
                              id: 'delete',
                              label: 'Delete rule',
                              icon: <Delete01Icon size={15} />,
                              variant: 'danger',
                              pending: pendingAction === `delete:${rule.id}`,
                              disabled:
                                pendingAction !== null && pendingAction !== `delete:${rule.id}`,
                              onAction: () => {
                                void handleDelete(rule.id);
                              },
                            },
                          ]}
                        />
                      }
                    />
                  );
                })}
              </ResourceList>
            )}
            <TablePager
              page={effectivePage}
              pageSize={PAGE_SIZE}
              total={filteredRules.length}
              onPageChange={setPage}
              noun="rules"
            />
          </Card>
        )}

        <Modal state={modal}>
          <Modal.Backdrop isDismissable={false}>
            <Modal.Container size="md" placement="center">
              <Modal.Dialog>
                <Modal.Header>
                  <Modal.Heading>
                    {isCreate ? 'Add auto-tag rule' : 'Edit auto-tag rule'}
                  </Modal.Heading>
                  <Modal.CloseTrigger />
                </Modal.Header>
                <Modal.Body>
                  <form id="autotag-form" onSubmit={handleSubmit} className="space-y-4">
                    {formError ? (
                      <FormAlert title="Rule not saved" description={formError} />
                    ) : null}
                    <TextField isRequired value={formPattern} onChange={setFormPattern}>
                      <Label>Image pattern</Label>
                      <Input placeholder="nginx/*" variant="secondary" />
                      <Description>
                        Use * to match any characters, e.g. registry.example.com/team/*.
                      </Description>
                    </TextField>
                    {tags.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No tags available. Create tags first.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        <Label id="autotag-tag-label">Tag to apply</Label>
                        <Select
                          aria-label="Tag to apply"
                          value={formTagId}
                          onChange={(value) => setFormTagId(String(value))}
                          variant="secondary"
                          isRequired
                        >
                          <Select.Trigger>
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <span className="shrink-0 text-muted-foreground">
                                <Tag01Icon size={15} />
                              </span>
                              <Select.Value />
                            </div>
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              {tags.map((tag) => (
                                <ListBox.Item key={tag.id} id={tag.id}>
                                  {tag.name}
                                </ListBox.Item>
                              ))}
                            </ListBox>
                          </Select.Popover>
                        </Select>
                      </div>
                    )}
                  </form>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="secondary" onPress={modal.close}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    form="autotag-form"
                    variant="primary"
                    isPending={saving}
                    isDisabled={tags.length === 0}
                  >
                    {isCreate ? 'Create' : 'Save'}
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
        {confirmDialog}
      </div>
    </AdminPageShell>
  );
}
