'use client';
import { createTag, deleteTag, listTags, Tag, updateTag } from '@/lib/api';
import { Modal, useOverlayState } from '@heroui/react';
import { Delete01Icon, PencilEdit01Icon, PlusSignIcon, Tag01Icon } from 'hugeicons-react';
import { useCallback, useEffect, useState } from 'react';

const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6'];

const panel: React.CSSProperties = {
  background: 'linear-gradient(145deg,rgba(255,255,255,0.038) 0%,rgba(255,255,255,0.01) 100%)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255,255,255,0.07)',
  boxShadow: '0 4px 32px rgba(0,0,0,0.25),inset 0 1px 0 rgba(255,255,255,0.05)',
};
const modalPanel: React.CSSProperties = {
  background: 'linear-gradient(145deg,rgba(20,20,24,0.97) 0%,rgba(15,15,18,0.99) 100%)',
  backdropFilter: 'blur(32px)',
  WebkitBackdropFilter: 'blur(32px)',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 25px 50px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.06)',
};
const inputStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, color: '#f4f4f5' };
const inputCls = 'w-full px-3 py-2.5 text-sm placeholder-zinc-600 outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl';

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
      if (editing) await updateTag(editing.id, name, color);
      else await createTag(name, color);
      modal.close(); await load();
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this tag? It will be removed from all scans.')) return;
    await deleteTag(id).catch(() => {}); load();
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Tags</h1>
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

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 rounded-full border-2 border-zinc-800 border-t-violet-500 animate-spin" />
        </div>
      ) : tags.length === 0 ? (
        <div className="rounded-2xl py-16 flex flex-col items-center gap-3" style={panel}>
          <Tag01Icon size={32} color="rgba(113,113,122,0.5)" />
          <p className="text-sm text-zinc-600">No tags yet. Create one to organize your scans.</p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={panel}>
          {tags.map((tag, i) => (
            <div
              key={tag.id}
              className="flex items-center gap-4 px-4 py-3.5 transition-colors"
              style={{ borderTop: i > 0 ? '1px solid rgba(255,255,255,0.05)' : undefined }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {/* Color swatch with glow */}
              <div
                className="w-4 h-4 rounded-full shrink-0"
                style={{
                  background: tag.color,
                  boxShadow: `0 0 8px ${tag.color}88`,
                  outline: `2px solid ${tag.color}40`,
                  outlineOffset: 2,
                }}
              />
              {/* Preview pill */}
              <span
                className="text-xs font-medium px-2.5 py-0.5 rounded-full shrink-0"
                style={{ background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }}
              >
                {tag.name}
              </span>
              <span className="flex-1 text-sm font-medium text-zinc-300">{tag.name}</span>
              <span className="font-mono text-xs text-zinc-600">{tag.color}</span>
              <button onClick={() => openEdit(tag)} className="text-zinc-600 hover:text-zinc-300 transition-colors p-1" title="Edit">
                <PencilEdit01Icon size={15} />
              </button>
              <button onClick={() => handleDelete(tag.id)} className="text-zinc-600 hover:text-red-400 transition-colors p-1" title="Delete">
                <Delete01Icon size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="sm" placement="center">
            <Modal.Dialog className="rounded-2xl overflow-hidden" style={modalPanel}>
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <Modal.Heading className="text-white font-semibold">{editing ? 'Edit Tag' : 'New Tag'}</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="tag-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-xl px-3 py-2.5 text-sm"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {formError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-300">Name</label>
                    <input className={inputCls} style={inputStyle} placeholder="production"
                      value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                  <div className="space-y-2.5">
                    <label className="text-sm font-medium text-zinc-300">Color</label>
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
                    {/* Preview */}
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
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                <button onClick={modal.close} className="px-4 py-2 text-sm rounded-xl text-zinc-300 hover:text-white transition-colors"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>Cancel</button>
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
    </div>
  );
}
