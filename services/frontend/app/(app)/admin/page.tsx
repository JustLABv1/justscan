'use client';
import {
  AdminUser,
  AutoTagRule,
  createAdminUser,
  createAutoTagRule,
  deleteAdminUser,
  deleteAutoTagRule,
  disableAdminUser,
  getAdminSettings,
  listAdminUsers,
  listAutoTagRules,
  listTags,
  setPublicScanEnabled,
  Tag,
  updateAdminUser,
  updateAutoTagRule,
} from '@/lib/api';
import { Modal, useOverlayState } from '@heroui/react';
import { Delete01Icon, PencilEdit01Icon, PlusSignIcon } from 'hugeicons-react';
import { useCallback, useEffect, useState } from 'react';

const inputCls = 'w-full px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input';

// ── Settings Tab ──────────────────────────────────────────────────────
function SettingsTab() {
  const [publicScanEnabled, setPublicScanEnabledState] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    getAdminSettings()
      .then(settings => {
        setPublicScanEnabledState(settings['public_scan_enabled'] !== 'false');
      })
      .catch(() => setError('Failed to load settings'));
  }, []);

  async function handleTogglePublicScan(enabled: boolean) {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await setPublicScanEnabled(enabled);
      setPublicScanEnabledState(enabled);
      setSuccess(`Public scanning ${enabled ? 'enabled' : 'disabled'} successfully`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update setting');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.18)', color: '#34d399' }}>
          {success}
        </div>
      )}

      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Public Scanning</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Allow unauthenticated users to scan Docker images at{' '}
            <a href="/scan" target="_blank" className="text-violet-500 hover:underline">/scan</a>.
            Rate limited to 5 scans per hour per IP.
          </p>
        </div>

        {publicScanEnabled === null ? (
          <div className="w-5 h-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
        ) : (
          <div className="flex items-center justify-between gap-4 p-4 rounded-xl" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  background: publicScanEnabled ? 'rgba(124,58,237,0.15)' : 'rgba(113,113,122,0.1)',
                  border: publicScanEnabled ? '1px solid rgba(167,139,250,0.3)' : '1px solid rgba(113,113,122,0.2)',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke={publicScanEnabled ? '#a78bfa' : '#71717a'}
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  {publicScanEnabled
                    ? <polyline points="9 12 11 14 15 10" />
                    : <><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></>}
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Public scanning is currently{' '}
                  <span className={publicScanEnabled ? 'text-emerald-500' : 'text-red-400'}>
                    {publicScanEnabled ? 'enabled' : 'disabled'}
                  </span>
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {publicScanEnabled
                    ? 'Anyone can scan images without an account'
                    : 'Only authenticated users can scan images'}
                </p>
              </div>
            </div>

            <button
              onClick={() => handleTogglePublicScan(!publicScanEnabled)}
              disabled={saving}
              className="shrink-0 px-4 py-2 text-sm font-medium rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={publicScanEnabled
                ? { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }
                : { background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(167,139,250,0.3)', color: '#a78bfa' }}
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-current/30 border-t-current animate-spin" />
                  Saving…
                </span>
              ) : publicScanEnabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────
function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [isCreate, setIsCreate] = useState(false);
  const [formUsername, setFormUsername] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState('user');
  const [formPassword, setFormPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const modal = useOverlayState();

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await listAdminUsers()); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load users'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setIsCreate(true);
    setEditingUser(null);
    setFormUsername(''); setFormEmail(''); setFormRole('user'); setFormPassword(''); setFormError('');
    modal.open();
  }
  function openEdit(u: AdminUser) {
    setIsCreate(false);
    setEditingUser(u);
    setFormUsername(u.username); setFormEmail(u.email); setFormRole(u.role); setFormPassword(''); setFormError('');
    modal.open();
  }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setFormError(''); setSaving(true);
    try {
      if (isCreate) {
        await createAdminUser(formUsername, formEmail, formPassword, formRole);
      } else if (editingUser) {
        await updateAdminUser(editingUser.id, {
          username: formUsername,
          email: formEmail,
          role: formRole,
          ...(formPassword ? { password: formPassword } : {}),
        });
      }
      modal.close(); await load();
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSaving(false); }
  }
  async function handleDelete(u: AdminUser) {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    await deleteAdminUser(u.id).catch(() => {}); load();
  }
  async function handleToggleDisable(u: AdminUser) {
    const newDisabled = !u.disabled;
    await disableAdminUser(u.id, newDisabled).catch(() => {});
    load();
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={openCreate}
          className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-xl transition-all hover:opacity-90 active:scale-95"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 20px rgba(124,58,237,0.4),inset 0 1px 0 rgba(255,255,255,0.15)' }}
        >
          <PlusSignIcon size={15} /> Add User
        </button>
      </div>

      {users.length === 0 ? (
        <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3">
          <p className="text-sm text-zinc-500">No users found.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Username</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Email</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Role</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={u.id}
                  style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-200">{u.username}</td>
                  <td className="px-4 py-3 text-sm text-zinc-500">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-md"
                      style={u.role === 'admin'
                        ? { color: '#a78bfa', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' }
                        : { color: '#a1a1aa', background: 'rgba(161,161,170,0.08)', border: '1px solid rgba(161,161,170,0.15)' }}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.disabled ? (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: '#f87171', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                        Disabled
                      </span>
                    ) : (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: '#34d399', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleToggleDisable(u)}
                        className="text-xs px-2.5 py-1 rounded-lg font-medium transition-all"
                        style={u.disabled
                          ? { color: '#34d399', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }
                          : { color: '#fb923c', background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.2)' }}
                        title={u.disabled ? 'Enable user' : 'Disable user'}
                      >
                        {u.disabled ? 'Enable' : 'Disable'}
                      </button>
                      <button onClick={() => openEdit(u)} className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors p-1.5" title="Edit">
                        <PencilEdit01Icon size={15} />
                      </button>
                      <button onClick={() => handleDelete(u)} className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors p-1.5" title="Delete">
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
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">{isCreate ? 'Add User' : 'Edit User'}</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="user-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-xl px-3 py-2.5 text-sm"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {formError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Username</label>
                    <input className={inputCls} placeholder="username" value={formUsername} onChange={e => setFormUsername(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Email</label>
                    <input type="email" className={inputCls} placeholder="user@example.com" value={formEmail} onChange={e => setFormEmail(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Role</label>
                    <select className={inputCls} value={formRole} onChange={e => setFormRole(e.target.value)}>
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                      Password{' '}
                      {!isCreate && <span className="text-zinc-400 dark:text-zinc-600 font-normal">(leave blank to keep unchanged)</span>}
                    </label>
                    <input type="password" className={inputCls}
                      placeholder={isCreate ? 'Password' : '••••••••'}
                      value={formPassword}
                      onChange={e => setFormPassword(e.target.value)}
                      required={isCreate} />
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button onClick={modal.close} className="px-4 py-2 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
                  style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                  Cancel
                </button>
                <button type="submit" form="user-form" disabled={saving}
                  className="px-4 py-2 text-sm rounded-xl font-semibold text-white disabled:opacity-60 flex items-center gap-2 transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 16px rgba(124,58,237,0.35),inset 0 1px 0 rgba(255,255,255,0.15)' }}>
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {isCreate ? 'Create' : 'Save'}
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}

// ── Auto Tags Tab ─────────────────────────────────────────────────────
function AutoTagsTab() {
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
  const modal = useOverlayState();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, t] = await Promise.all([listAutoTagRules(), listTags()]);
      setRules(r); setTags(t);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setIsCreate(true); setEditingRule(null);
    setFormPattern(''); setFormTagId(tags[0]?.id ?? ''); setFormError('');
    modal.open();
  }
  function openEdit(r: AutoTagRule) {
    setIsCreate(false); setEditingRule(r);
    setFormPattern(r.pattern); setFormTagId(r.tag_id); setFormError('');
    modal.open();
  }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setFormError(''); setSaving(true);
    try {
      if (isCreate) await createAutoTagRule(formPattern, formTagId);
      else if (editingRule) await updateAutoTagRule(editingRule.id, formPattern, formTagId);
      modal.close(); await load();
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSaving(false); }
  }
  async function handleDelete(id: string) {
    if (!confirm('Delete this auto-tag rule?')) return;
    await deleteAutoTagRule(id).catch(() => {}); load();
  }

  const tagById = (id: string) => tags.find(t => t.id === id);

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">Automatically apply tags to scans based on image name patterns.</p>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-xl transition-all hover:opacity-90 active:scale-95"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 20px rgba(124,58,237,0.4),inset 0 1px 0 rgba(255,255,255,0.15)' }}
        >
          <PlusSignIcon size={15} /> Add Rule
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3">
          <p className="text-sm text-zinc-500">No auto-tag rules yet.</p>
          <p className="text-xs text-zinc-400">Use patterns like <code className="px-1 py-0.5 rounded font-mono" style={{background:'var(--row-hover)'}}>nginx/*</code> to match image names.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Pattern</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Tag</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r, i) => {
                const tag = r.tag ?? tagById(r.tag_id);
                return (
                  <tr key={r.id}
                    style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td className="px-4 py-3 font-mono text-sm text-zinc-700 dark:text-zinc-300">{r.pattern}</td>
                    <td className="px-4 py-3">
                      {tag ? (
                        <span className="text-xs font-medium px-2.5 py-0.5 rounded-full"
                          style={{ background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }}>
                          {tag.name}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400 font-mono">{r.tag_id}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(r)} className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors p-1.5" title="Edit">
                          <PencilEdit01Icon size={15} />
                        </button>
                        <button onClick={() => handleDelete(r.id)} className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors p-1.5" title="Delete">
                          <Delete01Icon size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">{isCreate ? 'Add Auto-Tag Rule' : 'Edit Auto-Tag Rule'}</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="autotag-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-xl px-3 py-2.5 text-sm"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {formError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Pattern</label>
                    <input className={inputCls + ' font-mono'} placeholder="nginx/*" value={formPattern} onChange={e => setFormPattern(e.target.value)} required />
                    <p className="text-xs text-zinc-500">
                      Use glob patterns to match image names. Examples:{' '}
                      <code className="font-mono px-1 py-0.5 rounded" style={{background:'var(--row-hover)'}}>nginx/*</code>{' '}
                      <code className="font-mono px-1 py-0.5 rounded" style={{background:'var(--row-hover)'}}>myrepo/api*</code>{' '}
                      <code className="font-mono px-1 py-0.5 rounded" style={{background:'var(--row-hover)'}}>*/prod-*</code>
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Tag</label>
                    {tags.length === 0 ? (
                      <p className="text-sm text-zinc-500">No tags available. Create tags first.</p>
                    ) : (
                      <select className={inputCls} value={formTagId} onChange={e => setFormTagId(e.target.value)} required>
                        <option value="">Select a tag…</option>
                        {tags.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button onClick={modal.close} className="px-4 py-2 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
                  style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                  Cancel
                </button>
                <button type="submit" form="autotag-form" disabled={saving || tags.length === 0}
                  className="px-4 py-2 text-sm rounded-xl font-semibold text-white disabled:opacity-60 flex items-center gap-2 transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 16px rgba(124,58,237,0.35),inset 0 1px 0 rgba(255,255,255,0.15)' }}>
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {isCreate ? 'Create' : 'Save'}
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<'settings' | 'users' | 'autotags'>('settings');

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Admin</h1>
        <p className="text-sm text-zinc-500 mt-1">Manage system configuration, users, and automation rules.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-xl" style={{background:'var(--glass-bg)', border:'1px solid var(--glass-border)'}}>
        {(['settings', 'users', 'autotags'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className="px-4 py-1.5 text-sm font-medium rounded-lg transition-all capitalize"
            style={activeTab === t
              ? {background:'linear-gradient(135deg,#7c3aed,#6d28d9)', color:'white'}
              : {color:'var(--text-muted)'}}>
            {t === 'autotags' ? 'Auto Tags' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'settings' && <SettingsTab />}
      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'autotags' && <AutoTagsTab />}
    </div>
  );
}
