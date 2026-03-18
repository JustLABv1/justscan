'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { createRegistry, deleteRegistry, listRegistries, RegistryWithHealth, testRegistry, updateRegistry } from '@/lib/api';
import { Modal, useOverlayState } from '@heroui/react';
import { Delete01Icon, PencilEdit01Icon, PlusSignIcon, ServerStack01Icon } from 'hugeicons-react';
import { useCallback, useEffect, useState } from 'react';

const inputCls = 'w-full px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input';

const AUTH_TYPE_LABEL: Record<string, string> = {
  none: 'Public', basic: 'Basic auth', token: 'Token', aws_ecr: 'AWS ECR',
};
const AUTH_TYPE_STYLE: Record<string, React.CSSProperties> = {
  none:    { color: '#a1a1aa', background: 'rgba(161,161,170,0.08)', border: '1px solid rgba(161,161,170,0.15)' },
  basic:   { color: '#60a5fa', background: 'rgba(59,130,246,0.1)',   border: '1px solid rgba(59,130,246,0.2)'  },
  token:   { color: '#a78bfa', background: 'rgba(124,58,237,0.1)',   border: '1px solid rgba(124,58,237,0.2)'  },
  aws_ecr: { color: '#fb923c', background: 'rgba(249,115,22,0.1)',   border: '1px solid rgba(249,115,22,0.2)'  },
};

function HealthBadge({ status, message }: { status: string; message: string }) {
  const cfg = ({
    healthy:   { color: '#34d399', bg: 'rgba(16,185,129,0.1)',   border: 'rgba(16,185,129,0.2)',   label: 'Healthy'   },
    unhealthy: { color: '#f87171', bg: 'rgba(239,68,68,0.1)',    border: 'rgba(239,68,68,0.2)',    label: 'Unhealthy' },
    unknown:   { color: '#a1a1aa', bg: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.15)', label: 'Unknown'   },
  } as Record<string, { color: string; bg: string; border: string; label: string }>)[status] ?? { color: '#a1a1aa', bg: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.15)', label: status };
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full" style={{color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`}} title={message}>
      <span className="w-1.5 h-1.5 rounded-full" style={{background: cfg.color}} />
      {cfg.label}
    </span>
  );
}

export default function RegistriesPage() {
  const [registries, setRegistries] = useState<RegistryWithHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<RegistryWithHealth | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [authType, setAuthType] = useState<'none' | 'basic' | 'token' | 'aws_ecr'>('none');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try { setRegistries(await listRegistries()); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditing(null); setName(''); setUrl(''); setAuthType('none'); setUsername(''); setPassword(''); setFormError('');
    modal.open();
  }
  function openEdit(r: RegistryWithHealth) {
    setEditing(r); setName(r.name); setUrl(r.url); setAuthType(r.auth_type ?? 'none'); setUsername(r.username ?? ''); setPassword(''); setFormError('');
    modal.open();
  }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setFormError(''); setSaving(true);
    try {
      if (editing) await updateRegistry(editing.id, { name, url, auth_type: authType, username, ...(password ? { password } : {}) });
      else await createRegistry({ name, url, auth_type: authType, username: username || undefined, password: password || undefined });
      modal.close(); await load();
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSaving(false); }
  }
  async function handleDelete(id: string) {
    const ok = await confirm({
      title: 'Delete registry?',
      message: 'The registry configuration will be permanently removed.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteRegistry(id).catch(() => {}); load();
  }
  async function handleTest(id: string) {
    setTesting(id);
    try {
      await testRegistry(id);
      await load();
    } catch { /* ignore - load will show updated status */ }
    finally { setTesting(null); }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Registries</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Configure private Docker registries</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-xl transition-all hover:opacity-90 active:scale-95"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 20px rgba(124,58,237,0.4),inset 0 1px 0 rgba(255,255,255,0.15)' }}
        >
          <PlusSignIcon size={15} /> Add Registry
        </button>
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
      ) : registries.length === 0 ? (
        <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3">
          <ServerStack01Icon size={32} color="rgba(113,113,122,0.5)" />
          <p className="text-sm text-zinc-500">No registries configured. Add one to use private images.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">URL</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Auth</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Username</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Health</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {registries.map((r, i) => (
                <tr key={r.id} style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-200">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">{r.url}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-md"
                      style={AUTH_TYPE_STYLE[r.auth_type ?? 'none']}>
                      {AUTH_TYPE_LABEL[r.auth_type ?? 'none']}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">{r.username || <span className="text-zinc-400 dark:text-zinc-700">—</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <HealthBadge status={r.health_status ?? 'unknown'} message={r.health_message ?? ''} />
                      {r.last_health_check_at && (
                        <span className="text-[10px] text-zinc-500">
                          {new Date(r.last_health_check_at).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleTest(r.id)}
                        disabled={testing === r.id}
                        className="text-xs px-2.5 py-1 rounded-lg font-medium transition-all disabled:opacity-50"
                        style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', color: '#a78bfa' }}
                        title="Test connection"
                      >
                        {testing === r.id ? (
                          <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-full border border-current border-t-transparent animate-spin" />
                            Testing…
                          </span>
                        ) : 'Test'}
                      </button>
                      <button onClick={() => openEdit(r)} className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors p-1.5" title="Edit">
                        <PencilEdit01Icon size={15} />
                      </button>
                      <button onClick={() => handleDelete(r.id)} className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors p-1.5" title="Delete">
                        <Delete01Icon size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">{editing ? 'Edit Registry' : 'Add Registry'}</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="registry-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-xl px-3 py-2.5 text-sm"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {formError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Name</label>
                    <input className={inputCls} placeholder="My Registry" value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">URL</label>
                    <input className={inputCls + ' font-mono'} placeholder="https://registry.example.com" value={url} onChange={(e) => setUrl(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Auth Type</label>
                    <select value={authType} onChange={(e) => setAuthType(e.target.value as 'none' | 'basic' | 'token' | 'aws_ecr')} className={inputCls}>
                      <option value="none">None (public registry)</option>
                      <option value="basic">Basic (username / password)</option>
                      <option value="token">Token</option>
                      <option value="aws_ecr">AWS ECR</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Username <span className="text-zinc-400 dark:text-zinc-600 font-normal">(optional)</span></label>
                    <input className={inputCls} placeholder="Optional" value={username} onChange={(e) => setUsername(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                      Password{' '}
                      <span className="text-zinc-400 dark:text-zinc-600 font-normal">{editing ? '(leave blank to keep unchanged)' : '(optional)'}</span>
                    </label>
                    <input type="password" className={inputCls}
                      placeholder={editing ? '••••••••' : 'Optional'} value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button onClick={modal.close} className="px-4 py-2 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
                  style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                  Cancel
                </button>
                <button type="submit" form="registry-form" disabled={saving}
                  className="px-4 py-2 text-sm rounded-xl font-semibold text-white disabled:opacity-60 flex items-center gap-2 transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 16px rgba(124,58,237,0.35),inset 0 1px 0 rgba(255,255,255,0.15)' }}>
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {editing ? 'Save' : 'Add'}
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
