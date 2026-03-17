'use client';
import { createTag, deleteTag, listTags, Tag, updateTag } from '@/lib/api';
import { Modal, useOverlayState } from '@heroui/react';
import { Delete01Icon, PencilEdit01Icon, PlusSignIcon } from 'hugeicons-react';
import { useCallback, useEffect, useState } from 'react';

const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6'];

const inputCls = 'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors';

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

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditing(null); setName(''); setColor(COLORS[0]); setFormError('');
    modal.open();
  }

  function openEdit(tag: Tag) {
    setEditing(tag); setName(tag.name); setColor(tag.color); setFormError('');
    modal.open();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(''); setSaving(true);
    try {
      if (editing) await updateTag(editing.id, name, color);
      else await createTag(name, color);
      modal.close();
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this tag? It will be removed from all scans.')) return;
    await deleteTag(id).catch(() => {});
    load();
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Tags</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Organize your scans with color-coded labels</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <PlusSignIcon size={16} />
          New Tag
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 rounded-full border-2 border-zinc-700 border-t-violet-500 animate-spin" />
        </div>
      ) : tags.length === 0 ? (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 py-16 text-center text-zinc-600 text-sm">
          No tags yet. Create one to organize your scans.
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 divide-y divide-zinc-800">
          {tags.map((tag) => (
            <div key={tag.id} className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-800/40 transition-colors">
              <div
                className="w-3.5 h-3.5 rounded-full shrink-0 ring-2 ring-offset-1 ring-offset-zinc-900"
                style={{ background: tag.color }}
              />
              <span className="flex-1 text-sm font-medium text-zinc-200">{tag.name}</span>
              <span className="font-mono text-xs text-zinc-600">{tag.color}</span>
              <button
                onClick={() => openEdit(tag)}
                className="text-zinc-600 hover:text-zinc-300 transition-colors p-1"
                title="Edit"
              >
                <PencilEdit01Icon size={15} />
              </button>
              <button
                onClick={() => handleDelete(tag.id)}
                className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                title="Delete"
              >
                <Delete01Icon size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="sm" placement="center">
            <Modal.Dialog className="bg-zinc-900 border border-zinc-800 rounded-2xl">
              <Modal.Header className="border-b border-zinc-800 px-6 py-4">
                <Modal.Heading className="text-white font-semibold">{editing ? 'Edit Tag' : 'New Tag'}</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="tag-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-sm text-red-400">
                      {formError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-300">Name</label>
                    <input
                      className={inputCls}
                      placeholder="production"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-300">Color</label>
                    <div className="flex flex-wrap gap-2">
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setColor(c)}
                          className="w-7 h-7 rounded-full transition-all"
                          style={{
                            background: c,
                            outline: color === c ? `2px solid ${c}` : 'none',
                            outlineOffset: '2px',
                            transform: color === c ? 'scale(1.15)' : 'scale(1)',
                          }}
                        />
                      ))}
                      <input
                        type="color"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        className="w-7 h-7 rounded-full cursor-pointer border-0 p-0 bg-transparent"
                        title="Custom color"
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <span className="w-4 h-4 rounded-full shrink-0" style={{ background: color }} />
                      <span className="text-xs font-mono text-zinc-500">{color}</span>
                    </div>
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer className="border-t border-zinc-800 px-6 py-4 flex gap-3 justify-end">
                <button
                  onClick={modal.close}
                  className="px-4 py-2 text-sm rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="tag-form"
                  disabled={saving}
                  className="px-4 py-2 text-sm rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium disabled:opacity-60 transition-colors flex items-center gap-2"
                >
                  {saving ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
                  {editing ? 'Save' : 'Create'}
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
