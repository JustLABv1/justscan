'use client';

import { useConfirmDialog } from '@/components/confirm-dialog';
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
  Input,
  ListBox,
  Modal,
  Pagination,
  SearchField,
  Select,
  Table,
  useOverlayState,
} from '@heroui/react';
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
  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

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
    await deleteAutoTagRule(id).catch(() => {});
    await load();
  }

  const tagById = useCallback((id: string) => tags.find((tag) => tag.id === id), [tags]);

  const filteredRules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rules.filter((rule) => {
      const tag = rule.tag ?? tagById(rule.tag_id);
      return (
        q.length === 0 ||
        rule.pattern.toLowerCase().includes(q) ||
        rule.tag_id.toLowerCase().includes(q) ||
        (tag?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [rules, searchQuery, tagById]);

  const totalPages = Math.max(1, Math.ceil(filteredRules.length / PAGE_SIZE));
  const effectivePage = Math.min(page, totalPages);
  const pagedRules = filteredRules.slice((effectivePage - 1) * PAGE_SIZE, effectivePage * PAGE_SIZE);

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
      {error && (
        <Card className="border border-danger/30 bg-danger/10">
          <Card.Content>
            <p className="text-sm text-danger">{error}</p>
          </Card.Content>
        </Card>
      )}

      <div className="flex justify-end">
        <Button onPress={openCreate} variant="secondary">
          <PlusSignIcon size={15} />
          Add Rule
        </Button>
      </div>

      <Card className="space-y-4">
        <SearchField name="admin-autotags-search" variant="secondary" className="w-full sm:max-w-md">
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input
              placeholder="Filter by pattern or tag..."
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setPage(1);
              }}
            />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>

        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label="Auto tag rules" className="min-w-[880px]">
              <Table.Header>
                <Table.Column isRowHeader>Pattern</Table.Column>
                <Table.Column>Tag</Table.Column>
                <Table.Column>Created</Table.Column>
                <Table.Column className="text-right">Actions</Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <div className="py-10 text-center text-sm text-zinc-500">
                    {loading ? 'Loading auto-tag rules...' : 'No auto-tag rules match your filter.'}
                  </div>
                )}
              >
                {pagedRules.map((rule) => {
                  const tag = rule.tag ?? tagById(rule.tag_id);
                  return (
                    <Table.Row key={rule.id} id={rule.id} className="hover:bg-[var(--row-hover)]">
                      <Table.Cell className="font-mono text-sm">{rule.pattern}</Table.Cell>
                      <Table.Cell>
                        {tag ? (
                          <span
                            className="text-xs font-medium rounded-full px-2.5 py-0.5"
                            style={{
                              background: `${tag.color}22`,
                              color: tag.color,
                              border: `1px solid ${tag.color}44`,
                            }}
                          >
                            {tag.name}
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-400 font-mono">{rule.tag_id}</span>
                        )}
                      </Table.Cell>
                      <Table.Cell className="text-xs text-zinc-500">
                        <span title={fullDate(rule.created_at)}>{timeAgo(rule.created_at)}</span>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex justify-end">
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
                                onAction: () => {
                                  void handleDelete(rule.id);
                                },
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
          <Table.Footer className="grid grid-cols-[1fr_auto_1fr] items-center px-4 py-3 gap-3">
            <span className="text-xs text-zinc-500 whitespace-nowrap">
              Showing {filteredRules.length === 0 ? 0 : (effectivePage - 1) * PAGE_SIZE + 1}-
              {Math.min(effectivePage * PAGE_SIZE, filteredRules.length)} of {filteredRules.length}
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
                    <Pagination.Item key={`autotags-ellipsis-${index}`}>
                      <Pagination.Ellipsis />
                    </Pagination.Item>
                  ) : (
                    <Pagination.Item key={`autotags-page-${item}`}>
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
                <Modal.Heading>{isCreate ? 'Add Auto-Tag Rule' : 'Edit Auto-Tag Rule'}</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body>
                <form id="autotag-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && <p className="text-sm text-danger">{formError}</p>}
                  <Input
                    value={formPattern}
                    onChange={(event) => setFormPattern(event.target.value)}
                    placeholder="nginx/*"
                    variant="secondary"
                    required
                  />
                  {tags.length === 0 ? (
                    <p className="text-sm text-zinc-500">No tags available. Create tags first.</p>
                  ) : (
                    <Select value={formTagId} onChange={(value) => setFormTagId(String(value))} variant="secondary" isRequired>
                      <Select.Trigger>
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="shrink-0 text-zinc-400">
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
                  )}
                </form>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" onPress={modal.close}>Cancel</Button>
                <Button type="submit" form="autotag-form" variant="primary" isDisabled={saving || tags.length === 0}>
                  {saving ? 'Saving...' : isCreate ? 'Create' : 'Save'}
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
