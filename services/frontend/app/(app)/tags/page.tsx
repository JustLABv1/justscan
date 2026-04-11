'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { EmptyState } from '@/components/ui/empty-state';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { createTag, deleteTag, listTags, Tag, updateTag } from '@/lib/api';
import { Modal, useOverlayState } from '@heroui/react';
import { Delete01Icon, PencilEdit01Icon, PlusSignIcon, Tag01Icon } from 'hugeicons-react';
import { useCallback, useEffect, useState } from 'react';

const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6'];
const inputCls = 'w-full px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input';

export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState<Tag | null>(null);
  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try { setTags(await listTags()); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditing(null); setName(''); setColor(COLORS[0]); setFormError(''); modal.open(); }
  function openEdit(tag: Tag) { setEditing(tag); setName(tag.name); setColor(tag.color); setFormError(''); modal.open(); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setFormError(''); setSaving(true);
    try {
      if (editing) { await updateTag(editing.id, name, color); toast.success('Tag updated'); }
      else { await createTag(name, color); toast.success(`Tag "${name}" created`); }
      modal.close(); await load();
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
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
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Tags</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Organize your scans with color-coded labels</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-xl transition-all hover:opacity-90 active:scale-95"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 20px rgba(124,58,237,0.4),inset 0 1px 0 rgba(255,255,255,0.15)' }}
        >
          <PlusSignIcon size={15} /> New Tag
        </button>
      </div>

      {error ? <FormAlert description={error} title="Tag loading failed" /> : null}

      {loading ? (
        <div className="glass-panel rounded-2xl overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5"
              style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}>
              <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
              <Skeleton className="h-4 w-28 rounded" />
              <div className="flex-1" />
              <Skeleton className="h-4 w-16 rounded" />
              <Skeleton className="h-7 w-7 rounded-lg" />
              <Skeleton className="h-7 w-7 rounded-lg" />
            </div>
          ))}
        </div>
      ) : tags.length === 0 ? (
        <EmptyState
          icon={<Tag01Icon size={28} />}
          title="No tags yet"
          description="Create color-coded tags to group and filter your scans. Tags can be assigned to any scan."
          action={{ label: '+ New Tag', onClick: openCreate }}
        />
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          {tags.map((tag, i) => (
            <div
              key={tag.id}
              className="flex items-center gap-4 px-4 py-3.5 transition-colors"
              style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <div
                className="w-4 h-4 rounded-full shrink-0"
                style={{ background: tag.color, boxShadow: `0 0 8px ${tag.color}88`, outline: `2px solid ${tag.color}40`, outlineOffset: 2 }}
              />
              <span
                className="text-xs font-medium px-2.5 py-0.5 rounded-full shrink-0"
                style={{ background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }}
              >
                {tag.name}
              </span>
              <span className="flex-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">{tag.name}</span>
              <span className="font-mono text-xs text-zinc-500">{tag.color}</span>
              <RowActionsMenu
                label={`Open actions menu for tag ${tag.name}`}
                items={[
                  { id: 'edit', label: 'Edit tag', icon: <PencilEdit01Icon size={15} />, onAction: () => openEdit(tag) },
                  { id: 'delete', label: 'Delete tag', icon: <Delete01Icon size={15} />, variant: 'danger', onAction: () => { void handleDelete(tag.id); } },
                ]}
              />
            </div>
          ))}
        </div>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="sm" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">{editing ? 'Edit Tag' : 'New Tag'}</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="tag-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError ? <FormAlert description={formError} title="Tag save failed" /> : null}
                  <FormField label="Name" onChange={(e) => setName(e.target.value)} placeholder="production" required value={name} />
                  <div className="space-y-2.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Color</label>
                    <div className="flex flex-wrap gap-2">
                      {COLORS.map((c) => (
                        <button key={c} type="button" onClick={() => setColor(c)}
                          className="w-7 h-7 rounded-full transition-all"
                          style={{
                            background: c,
                            boxShadow: color === c ? `0 0 10px ${c}99` : 'none',
                            outline: color === c ? `2px solid ${c}` : `2px solid transparent`,
                            outlineOffset: 2,
                            transform: color === c ? 'scale(1.15)' : 'scale(1)',
                          }} />
                      ))}
                      <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                        className="w-7 h-7 rounded-full cursor-pointer border-0 p-0 bg-transparent" title="Custom color" />
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}88` }} />
                      <span className="text-xs font-mono text-zinc-500">{color}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium ml-1"
                        style={{ background: color + '22', color, border: `1px solid ${color}44` }}>
                        {name || 'preview'}
                      </span>
                    </div>
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button onClick={modal.close} className="px-4 py-2 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
                  style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>Cancel</button>
                <button type="submit" form="tag-form" disabled={saving}
                  className="px-4 py-2 text-sm rounded-xl font-semibold text-white disabled:opacity-60 flex items-center gap-2 transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 16px rgba(124,58,237,0.35),inset 0 1px 0 rgba(255,255,255,0.15)' }}>
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {editing ? 'Save' : 'Create'}
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </div>
  );
}
