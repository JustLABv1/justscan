'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import {
    AdminScan,
    AdminUser,
    AuditLog,
    AutoTagRule,
    createAdminUser,
    createAutoTagRule,
    createNotificationChannel,
    deleteAdminUser,
    deleteAutoTagRule,
    deleteNotificationChannel,
    disableAdminUser,
    getAdminSettings,
    listAdminScans,
    listAdminUsers,
    listAuditLogs,
    listAutoTagRules,
    listNotificationChannels,
    listTags,
    NotificationChannel,
    setPublicScanEnabled,
    Tag,
    updateAdminUser,
    updateAutoTagRule,
    updateNotificationChannel,
    updateRateLimit,
} from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
import { ListBox, Modal, Select, useOverlayState } from '@heroui/react';
import { ArrowDown01Icon, ArrowRight01Icon, Delete01Icon, Notification01Icon, PencilEdit01Icon, PlusSignIcon } from 'hugeicons-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

const inputCls = 'w-full px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input';

// ── Settings Tab ──────────────────────────────────────────────────────
function SettingsTab() {
  const [publicScanEnabled, setPublicScanEnabledState] = useState<boolean | null>(null);
  const [rateLimit, setRateLimitState] = useState<number>(5);
  const [rateLimitInput, setRateLimitInput] = useState('5');
  const [saving, setSaving] = useState(false);
  const [savingRl, setSavingRl] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    getAdminSettings()
      .then(settings => {
        setPublicScanEnabledState(settings['public_scan_enabled'] !== 'false');
        const rl = parseInt(settings['public_scan_rate_limit'] ?? '5', 10);
        setRateLimitState(rl);
        setRateLimitInput(String(rl));
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

  async function handleSaveRateLimit() {
    const v = parseInt(rateLimitInput, 10);
    if (isNaN(v) || v < 1 || v > 1000) { setError('Rate limit must be between 1 and 1000'); return; }
    setSavingRl(true); setError(''); setSuccess('');
    try {
      await updateRateLimit(v);
      setRateLimitState(v);
      setSuccess('Rate limit updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update rate limit');
    } finally {
      setSavingRl(false);
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

      {/* Rate limit */}
      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Public Scan Rate Limit</h2>
          <p className="text-sm text-zinc-500 mt-0.5">Maximum number of public scans allowed per IP address per hour.</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1} max={1000}
            className={inputCls + ' max-w-[120px]'}
            value={rateLimitInput}
            onChange={e => setRateLimitInput(e.target.value)}
          />
          <span className="text-sm text-zinc-500">per IP / hour</span>
          <button
            onClick={handleSaveRateLimit}
            disabled={savingRl || rateLimitInput === String(rateLimit)}
            className="px-4 py-2 text-sm rounded-xl font-semibold text-white disabled:opacity-40 flex items-center gap-2 transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 16px rgba(124,58,237,0.3)' }}
          >
            {savingRl && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            Save
          </button>
        </div>
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
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

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
    const ok = await confirm({
      title: `Delete "${u.username}"?`,
      message: 'This will permanently remove the user and cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteAdminUser(u.id).catch(() => {}); load();
  }
  async function handleToggleDisable(u: AdminUser) {
    const newDisabled = !u.disabled;
    const ok = await confirm(newDisabled
      ? {
          title: `Disable "${u.username}"?`,
          message: 'The user will no longer be able to log in.',
          confirmLabel: 'Disable',
          variant: 'warning',
        }
      : {
          title: `Re-enable "${u.username}"?`,
          message: 'The user will regain access to their account.',
          confirmLabel: 'Enable',
          variant: 'default',
        });
    if (!ok) return;
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
                  <td className="px-4 py-3 text-xs text-zinc-500" title={fullDate(u.created_at)}>{timeAgo(u.created_at)}</td>
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
                    <Select selectedKey={formRole} onSelectionChange={k => setFormRole(String(k))}>
                      <Select.Trigger className={inputCls}>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="user">User</ListBox.Item>
                          <ListBox.Item id="admin">Admin</ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
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
      {confirmDialog}
    </div>
  );
}
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
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

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
    const ok = await confirm({
      title: 'Delete auto-tag rule?',
      message: 'The rule will no longer apply to new scans.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
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
                    <td className="px-4 py-3 text-xs text-zinc-500" title={fullDate(r.created_at)}>{timeAgo(r.created_at)}</td>
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
                      <Select selectedKey={formTagId} onSelectionChange={k => setFormTagId(String(k))} isRequired>
                        <Select.Trigger className={inputCls}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="">Select a tag…</ListBox.Item>
                            {tags.map(t => (
                              <ListBox.Item key={t.id} id={t.id}>{t.name}</ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
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
      {confirmDialog}
    </div>
  );
}

// ── Audit Log Tab ────────────────────────────────────────────────────
function AuditLogTab() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const limit = 50;

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const r = await listAuditLogs(p, limit);
      setLogs(r.data ?? []);
      setTotal(r.total);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load audit logs'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(page); }, [load, page]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

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
        <p className="text-sm text-zinc-500">{total} total events</p>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg disabled:opacity-40 transition-colors"
            style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
            ←
          </button>
          <span className="text-zinc-500">{page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg disabled:opacity-40 transition-colors"
            style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
            →
          </button>
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3">
          <p className="text-sm text-zinc-500">No audit log entries yet.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Time</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">User</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Operation</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l, i) => (
                <tr key={l.id}
                  style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td className="px-4 py-3 text-xs text-zinc-400 whitespace-nowrap" title={fullDate(l.created_at)}>
                    {timeAgo(l.created_at)}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300 font-medium">
                    {l.username ?? l.user_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-md"
                      style={{ background: 'rgba(124,58,237,0.1)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.2)' }}>
                      {l.operation}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-500 max-w-xs truncate">{l.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Notifications Tab ────────────────────────────────────────────────
const EVENT_OPTIONS = [
  { value: 'scan_complete', label: 'Scan Completed' },
  { value: 'scan_failed', label: 'Scan Failed' },
  { value: 'compliance_failed', label: 'Compliance Failed' },
];

function NotificationsTab() {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<NotificationChannel | null>(null);
  const [isCreate, setIsCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'discord' | 'email' | 'webhook'>('discord');
  const [formEnabled, setFormEnabled] = useState(true);
  const [formEvents, setFormEvents] = useState<string[]>(['scan_complete', 'scan_failed']);
  const [formWebhookURL, setFormWebhookURL] = useState('');
  const [formSMTPHost, setFormSMTPHost] = useState('');
  const [formSMTPPort, setFormSMTPPort] = useState('587');
  const [formSMTPUser, setFormSMTPUser] = useState('');
  const [formSMTPPass, setFormSMTPPass] = useState('');
  const [formSMTPFrom, setFormSMTPFrom] = useState('');
  const [formSMTPTo, setFormSMTPTo] = useState('');
  const [formSMTPTLS, setFormSMTPTLS] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setChannels(await listNotificationChannels()); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function resetForm(ch?: NotificationChannel) {
    setFormName(ch?.name ?? '');
    setFormType(ch?.type ?? 'discord');
    setFormEnabled(ch?.enabled ?? true);
    setFormEvents(ch?.events ?? ['scan_complete', 'scan_failed']);
    setFormWebhookURL(ch?.config?.webhook_url ?? '');
    setFormSMTPHost(ch?.config?.smtp_host ?? '');
    setFormSMTPPort(String(ch?.config?.smtp_port ?? 587));
    setFormSMTPUser(ch?.config?.smtp_username ?? '');
    setFormSMTPPass('');
    setFormSMTPFrom(ch?.config?.smtp_from ?? '');
    setFormSMTPTo((ch?.config?.to_addresses ?? []).join(', '));
    setFormSMTPTLS(ch?.config?.smtp_tls ?? false);
    setFormError('');
  }

  function openCreate() {
    setIsCreate(true); setEditing(null); resetForm(); modal.open();
  }
  function openEdit(ch: NotificationChannel) {
    setIsCreate(false); setEditing(ch); resetForm(ch); modal.open();
  }

  function buildPayload(): Partial<NotificationChannel> {
    const config: NotificationChannel['config'] = {};
    if (formType === 'discord' || formType === 'webhook') {
      config.webhook_url = formWebhookURL;
    }
    if (formType === 'email') {
      config.smtp_host = formSMTPHost;
      config.smtp_port = parseInt(formSMTPPort, 10) || 587;
      config.smtp_username = formSMTPUser;
      if (formSMTPPass) config.smtp_password = formSMTPPass;
      config.smtp_from = formSMTPFrom;
      config.to_addresses = formSMTPTo.split(',').map(s => s.trim()).filter(Boolean);
      config.smtp_tls = formSMTPTLS;
    }
    return { name: formName, type: formType, enabled: formEnabled, events: formEvents, config };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setFormError(''); setSaving(true);
    try {
      const payload = buildPayload();
      if (isCreate) await createNotificationChannel(payload);
      else if (editing) await updateNotificationChannel(editing.id, payload);
      modal.close(); await load();
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSaving(false); }
  }

  async function handleDelete(ch: NotificationChannel) {
    const ok = await confirm({
      title: `Delete "${ch.name}"?`,
      message: 'The notification channel will be permanently removed.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteNotificationChannel(ch.id).catch(() => {}); load();
  }

  async function handleToggleEnabled(ch: NotificationChannel) {
    const ok = await confirm(ch.enabled
      ? { title: `Disable "${ch.name}"?`, message: 'No notifications will be sent through this channel.', confirmLabel: 'Disable', variant: 'warning' }
      : { title: `Enable "${ch.name}"?`, message: 'Notifications will start being sent through this channel.', confirmLabel: 'Enable', variant: 'default' }
    );
    if (!ok) return;
    await updateNotificationChannel(ch.id, { enabled: !ch.enabled }).catch(() => {}); load();
  }

  function toggleEvent(ev: string) {
    setFormEvents(prev => prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev]);
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

      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">Send alerts to Discord, email, or webhooks when scan events occur.</p>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-xl transition-all hover:opacity-90 active:scale-95"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 20px rgba(124,58,237,0.4),inset 0 1px 0 rgba(255,255,255,0.15)' }}
        >
          <PlusSignIcon size={15} /> Add Channel
        </button>
      </div>

      {channels.length === 0 ? (
        <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3">
          <Notification01Icon size={32} className="text-zinc-400 dark:text-zinc-600" />
          <p className="text-sm text-zinc-500">No notification channels configured.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Type</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Events</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {channels.map((ch, i) => (
                <tr key={ch.id}
                  style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-200">{ch.name}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-md capitalize"
                      style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }}>
                      {ch.type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(ch.events ?? []).map(ev => (
                        <span key={ev} className="text-xs px-1.5 py-0.5 rounded font-mono"
                          style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                          {ev}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {ch.enabled ? (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: '#34d399', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>Active</span>
                    ) : (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: '#a1a1aa', background: 'rgba(161,161,170,0.1)', border: '1px solid rgba(161,161,170,0.2)' }}>Disabled</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => handleToggleEnabled(ch)}
                        className="text-xs px-2.5 py-1 rounded-lg font-medium transition-all"
                        style={ch.enabled
                          ? { color: '#fb923c', background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.2)' }
                          : { color: '#34d399', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                        {ch.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button onClick={() => openEdit(ch)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors p-1.5">
                        <PencilEdit01Icon size={15} />
                      </button>
                      <button onClick={() => handleDelete(ch)} className="text-zinc-400 hover:text-red-400 transition-colors p-1.5">
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
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">
                  {isCreate ? 'Add Notification Channel' : 'Edit Notification Channel'}
                </Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5 max-h-[70vh] overflow-y-auto">
                <form id="notif-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-xl px-3 py-2.5 text-sm"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {formError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Name</label>
                    <input className={inputCls} placeholder="My Discord Channel" value={formName} onChange={e => setFormName(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Type</label>
                    <Select selectedKey={formType} onSelectionChange={k => setFormType(k as typeof formType)}>
                      <Select.Trigger className={inputCls}>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="discord">Discord</ListBox.Item>
                          <ListBox.Item id="email">Email (SMTP)</ListBox.Item>
                          <ListBox.Item id="webhook">Generic Webhook</ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>

                  {/* Type-specific fields */}
                  {(formType === 'discord' || formType === 'webhook') && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                        {formType === 'discord' ? 'Discord Webhook URL' : 'Webhook URL'}
                      </label>
                      <input className={inputCls} placeholder="https://discord.com/api/webhooks/..." value={formWebhookURL} onChange={e => setFormWebhookURL(e.target.value)} required />
                    </div>
                  )}

                  {formType === 'email' && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">SMTP Host</label>
                          <input className={inputCls} placeholder="smtp.example.com" value={formSMTPHost} onChange={e => setFormSMTPHost(e.target.value)} required />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Port</label>
                          <input type="number" className={inputCls} placeholder="587" value={formSMTPPort} onChange={e => setFormSMTPPort(e.target.value)} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Username</label>
                          <input className={inputCls} placeholder="user@example.com" value={formSMTPUser} onChange={e => setFormSMTPUser(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Password</label>
                          <input type="password" className={inputCls} placeholder={editing ? '(unchanged)' : 'Password'} value={formSMTPPass} onChange={e => setFormSMTPPass(e.target.value)} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">From Address</label>
                        <input className={inputCls} placeholder="noreply@example.com" value={formSMTPFrom} onChange={e => setFormSMTPFrom(e.target.value)} required />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">To Addresses</label>
                        <input className={inputCls} placeholder="ops@example.com, team@example.com" value={formSMTPTo} onChange={e => setFormSMTPTo(e.target.value)} required />
                        <p className="text-xs text-zinc-400">Comma-separated list of recipients</p>
                      </div>
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input type="checkbox" checked={formSMTPTLS} onChange={e => setFormSMTPTLS(e.target.checked)}
                          className="w-4 h-4 rounded accent-violet-500" />
                        <span className="text-sm text-zinc-600 dark:text-zinc-300">Use TLS (port 465)</span>
                      </label>
                    </>
                  )}

                  {/* Events */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Trigger on Events</label>
                    <div className="space-y-2">
                      {EVENT_OPTIONS.map(ev => (
                        <label key={ev.value} className="flex items-center gap-2.5 cursor-pointer">
                          <input type="checkbox" checked={formEvents.includes(ev.value)} onChange={() => toggleEvent(ev.value)}
                            className="w-4 h-4 rounded accent-violet-500" />
                          <span className="text-sm text-zinc-600 dark:text-zinc-300">{ev.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={formEnabled} onChange={e => setFormEnabled(e.target.checked)}
                      className="w-4 h-4 rounded accent-violet-500" />
                    <span className="text-sm text-zinc-600 dark:text-zinc-300">Enabled</span>
                  </label>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button onClick={modal.close} className="px-4 py-2 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 transition-colors"
                  style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                  Cancel
                </button>
                <button type="submit" form="notif-form" disabled={saving}
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
      {confirmDialog}
    </div>
  );
}

// ── Scans Tab ─────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  completed: { bg: 'rgba(34,197,94,0.1)', color: '#4ade80', border: 'rgba(34,197,94,0.2)' },
  running:   { bg: 'rgba(234,179,8,0.1)',  color: '#facc15', border: 'rgba(234,179,8,0.2)'  },
  pending:   { bg: 'rgba(148,163,184,0.1)',color: '#94a3b8', border: 'rgba(148,163,184,0.2)'},
  failed:    { bg: 'rgba(239,68,68,0.1)',  color: '#f87171', border: 'rgba(239,68,68,0.2)'  },
};

function ScansTab() {
  const [scans, setScans] = useState<AdminScan[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [imageFilter, setImageFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const limit = 50;

  const load = useCallback(async (p: number, img: string, st: string) => {
    setLoading(true);
    setError('');
    try {
      const r = await listAdminScans(p, limit, img || undefined, st || undefined);
      setScans(r.data ?? []);
      setTotal(r.total);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load scans'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(page, imageFilter, statusFilter); }, [load, page, imageFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  function handleImageChange(v: string) { setImageFilter(v); setPage(1); }
  function handleStatusChange(v: string) { setStatusFilter(v); setPage(1); }

  function toggleExpand(imageName: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(imageName)) next.delete(imageName); else next.add(imageName);
      return next;
    });
  }

  // Group scans by image name, preserving insertion order
  const groups: { imageName: string; scans: AdminScan[] }[] = [];
  const seen = new Map<string, AdminScan[]>();
  for (const s of scans) {
    if (!seen.has(s.image_name)) {
      seen.set(s.image_name, []);
      groups.push({ imageName: s.image_name, scans: seen.get(s.image_name)! });
    }
    seen.get(s.image_name)!.push(s);
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          placeholder="Filter by image…"
          value={imageFilter}
          onChange={e => handleImageChange(e.target.value)}
          className={`${inputCls} max-w-xs`}
        />
        <select
          value={statusFilter}
          onChange={e => handleStatusChange(e.target.value)}
          className={`${inputCls} w-36`}
        >
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="running">Running</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
        <p className="ml-auto text-sm text-zinc-500">{total} total</p>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-end gap-2 text-sm">
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
          className="px-3 py-1.5 rounded-lg disabled:opacity-40 transition-colors"
          style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>←</button>
        <span className="text-zinc-500">{page} / {totalPages}</span>
        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
          className="px-3 py-1.5 rounded-lg disabled:opacity-40 transition-colors"
          style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>→</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3">
          <p className="text-sm text-zinc-500">No scans found.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="w-8 px-3 py-3" />
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Image</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="text-center px-3 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(239,68,68,0.7)' }}>C</th>
                <th className="text-center px-3 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(249,115,22,0.7)' }}>H</th>
                <th className="text-center px-3 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(234,179,8,0.7)' }}>M</th>
                <th className="text-center px-3 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(59,130,246,0.7)' }}>L</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Owner</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group, gi) => {
                const isOpen = expanded.has(group.imageName);
                const latest = group.scans[0];
                const sc = STATUS_COLORS[latest.status] ?? STATUS_COLORS.failed;
                return (
                  <>
                    {/* Image group header */}
                    <tr
                      key={group.imageName}
                      className="cursor-pointer transition-colors"
                      style={{ borderTop: gi > 0 ? '1px solid var(--row-divider)' : undefined }}
                      onClick={() => toggleExpand(group.imageName)}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td className="px-3 py-3.5 w-8">
                        <span
                          className="flex items-center justify-center w-5 h-5 rounded-md transition-all duration-150"
                          style={{ color: 'var(--text-muted)', background: isOpen ? 'rgba(124,58,237,0.12)' : undefined }}
                        >
                          {isOpen
                            ? <ArrowDown01Icon size={13} className="text-violet-400" />
                            : <ArrowRight01Icon size={13} />}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200 text-sm">
                            {group.imageName}
                          </span>
                          <span
                            className="text-xs px-1.5 py-0.5 rounded-md font-medium"
                            style={{ background: 'rgba(124,58,237,0.1)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.2)' }}
                          >
                            {group.scans.length} scan{group.scans.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-xs text-zinc-400">:{latest.image_tag}</span>
                          <span className="text-xs text-zinc-500" title={fullDate(latest.created_at)}>{timeAgo(latest.created_at)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-md"
                          style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>
                          {latest.status}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-center font-mono text-xs text-red-400">{latest.critical_count || '—'}</td>
                      <td className="px-3 py-3.5 text-center font-mono text-xs text-orange-400">{latest.high_count || '—'}</td>
                      <td className="px-3 py-3.5 text-center font-mono text-xs text-yellow-400">{latest.medium_count || '—'}</td>
                      <td className="px-3 py-3.5 text-center font-mono text-xs text-blue-400">{latest.low_count || '—'}</td>
                      <td className="px-4 py-3.5 text-sm text-zinc-500 max-w-[160px] truncate" title={latest.owner_email || '—'}>
                        {latest.owner_email ? latest.owner_email : <span className="italic text-zinc-400">anonymous</span>}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-zinc-400 whitespace-nowrap">{timeAgo(latest.created_at)}</td>
                    </tr>

                    {/* Expanded child rows */}
                    {isOpen && (
                      <tr key={`${group.imageName}-children`}>
                        <td colSpan={9} className="p-0">
                          <div
                            className="mx-4 mb-3 rounded-xl overflow-hidden"
                            style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)' }}
                          >
                            <table className="w-full text-sm">
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">Tag</th>
                                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                                  <th className="text-center px-3 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(239,68,68,0.7)' }}>C</th>
                                  <th className="text-center px-3 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(249,115,22,0.7)' }}>H</th>
                                  <th className="text-center px-3 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(234,179,8,0.7)' }}>M</th>
                                  <th className="text-center px-3 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(59,130,246,0.7)' }}>L</th>
                                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">Owner</th>
                                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">Date</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.scans.map((s, si) => {
                                  const csc = STATUS_COLORS[s.status] ?? STATUS_COLORS.failed;
                                  return (
                                    <tr
                                      key={s.id}
                                      className="cursor-pointer group/row transition-colors"
                                      style={{ borderTop: si > 0 ? '1px solid var(--row-divider)' : undefined }}
                                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(124,58,237,0.06)')}
                                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                    >
                                      <td className="px-4 py-2.5">
                                        <Link
                                          href={`/scans/${s.id}`}
                                          onClick={e => e.stopPropagation()}
                                          className="flex items-center gap-2 group/link"
                                        >
                                          <span
                                            className="w-1 h-4 rounded-full shrink-0 opacity-0 group-hover/link:opacity-100 transition-opacity"
                                            style={{ background: 'linear-gradient(180deg,#a78bfa,#7c3aed)' }}
                                          />
                                          <span className="font-mono text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:text-violet-400 transition-colors">
                                            :{s.image_tag}
                                          </span>
                                        </Link>
                                      </td>
                                      <td className="px-4 py-2.5">
                                        <span className="text-xs font-medium px-2 py-0.5 rounded-md"
                                          style={{ background: csc.bg, color: csc.color, border: `1px solid ${csc.border}` }}>
                                          {s.status}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2.5 text-center font-mono text-xs text-red-400">{s.critical_count || '—'}</td>
                                      <td className="px-3 py-2.5 text-center font-mono text-xs text-orange-400">{s.high_count || '—'}</td>
                                      <td className="px-3 py-2.5 text-center font-mono text-xs text-yellow-400">{s.medium_count || '—'}</td>
                                      <td className="px-3 py-2.5 text-center font-mono text-xs text-blue-400">{s.low_count || '—'}</td>
                                      <td className="px-4 py-2.5 text-xs text-zinc-500 max-w-[160px] truncate" title={s.owner_email || '—'}>
                                        {s.owner_email ? s.owner_email : <span className="italic text-zinc-400">anonymous</span>}
                                      </td>
                                      <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap" title={fullDate(s.created_at)}>
                                        {timeAgo(s.created_at)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────── ──────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<'settings' | 'users' | 'autotags' | 'audit' | 'notifications' | 'scans'>('settings');

  const tabs: { value: typeof activeTab; label: string }[] = [
    { value: 'settings', label: 'Settings' },
    { value: 'users', label: 'Users' },
    { value: 'autotags', label: 'Auto Tags' },
    { value: 'audit', label: 'Audit Log' },
    { value: 'notifications', label: 'Notifications' },
    { value: 'scans', label: 'Scans' },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Admin</h1>
        <p className="text-sm text-zinc-500 mt-1">Manage system configuration, users, and automation rules.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-xl flex-wrap" style={{background:'var(--glass-bg)', border:'1px solid var(--glass-border)'}}>
        {tabs.map(t => (
          <button key={t.value} onClick={() => setActiveTab(t.value)}
            className="px-4 py-1.5 text-sm font-medium rounded-lg transition-all"
            style={activeTab === t.value
              ? {background:'linear-gradient(135deg,#7c3aed,#6d28d9)', color:'white'}
              : {color:'var(--text-muted)'}}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'settings' && <SettingsTab />}
      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'autotags' && <AutoTagsTab />}
      {activeTab === 'audit' && <AuditLogTab />}
      {activeTab === 'notifications' && <NotificationsTab />}
      {activeTab === 'scans' && <ScansTab />}
    </div>
  );
}
