'use client';
import { FormField } from '@/components/ui/form-field';
import { nativeFieldClassName } from '@/components/ui/form-styles';
import { changePassword, getAuthSnapshot, getUserDetails, setUser, updateUserDetails, User } from '@/lib/api';
import { fullDate } from '@/lib/time';
import { ApiIcon, Clock01Icon, Key01Icon, Shield01Icon, UserAccountIcon } from 'hugeicons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const inputCls = nativeFieldClassName;

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="glass-panel rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">{title}</h2>
        <p className="text-sm text-zinc-500 mt-0.5">{description}</p>
      </div>
      <div style={{ borderTop: '1px solid var(--border-subtle)' }} className="pt-4">
        {children}
      </div>
    </div>
  );
}

function Alert({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div className="rounded-xl px-3 py-2.5 text-sm" style={
      type === 'success'
        ? { background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399' }
        : { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }
    }>
      {message}
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUserState] = useState<User | null>(null);
  const [authSnapshot, setAuthSnapshot] = useState(() => getAuthSnapshot());

  // Profile form
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Password form
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    getUserDetails()
      .then(({ user: u }) => {
        setUserState(u);
        setUsername(u.username ?? '');
        setEmail(u.email ?? '');
        setAuthSnapshot(getAuthSnapshot());
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileMsg(null);
    setProfileSaving(true);
    try {
      await updateUserDetails(username, email);
      if (user) {
        const updated = { ...user, username, email };
        setUserState(updated);
        setUser(updated);
      }
      setProfileMsg({ text: 'Profile updated successfully.', type: 'success' });
    } catch (err: unknown) {
      setProfileMsg({ text: err instanceof Error ? err.message : 'Failed to update profile', type: 'error' });
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (newPw !== confirmPw) {
      setPwMsg({ text: 'New passwords do not match.', type: 'error' });
      return;
    }
    if (newPw.length < 8) {
      setPwMsg({ text: 'Password must be at least 8 characters.', type: 'error' });
      return;
    }
    setPwSaving(true);
    try {
      await changePassword(currentPw, newPw, confirmPw);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      setPwMsg({ text: 'Password changed successfully.', type: 'success' });
    } catch (err: unknown) {
      setPwMsg({ text: err instanceof Error ? err.message : 'Failed to change password', type: 'error' });
    } finally {
      setPwSaving(false);
    }
  }

  if (!user) return (
    <div className="flex justify-center items-center h-64">
      <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
    </div>
  );

  const isOIDCUser = user.auth_type === 'oidc';

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Settings</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Manage your account profile and security</p>
      </div>

      <Section title="Access" description="See the current session and account access state for this browser.">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl p-4" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
            <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
              <Shield01Icon size={16} />
              <span className="text-sm font-medium">Account role</span>
            </div>
            <p className="mt-3 text-lg font-semibold text-zinc-900 dark:text-white capitalize">{user.role}</p>
            <p className="mt-1 text-xs text-zinc-500">{user.disabled ? 'This account is currently disabled.' : 'This account is active and can sign in.'}</p>
          </div>
          <div className="rounded-2xl p-4" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
            <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
              <Clock01Icon size={16} />
              <span className="text-sm font-medium">Session expiry</span>
            </div>
            <p className="mt-3 text-lg font-semibold text-zinc-900 dark:text-white">
              {authSnapshot.expires_at ? fullDate(authSnapshot.expires_at) : 'Unknown'}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {authSnapshot.expires_in_seconds != null ? `${Math.floor(authSnapshot.expires_in_seconds / 60)} minutes remaining` : 'Token expiry is not available from the current session.'}
            </p>
          </div>
          <div className="rounded-2xl p-4" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
            <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
              <Key01Icon size={16} />
              <span className="text-sm font-medium">Browser token</span>
            </div>
            <p className="mt-3 text-lg font-semibold text-zinc-900 dark:text-white">{authSnapshot.token_present ? 'Present' : 'Missing'}</p>
            <p className="mt-1 text-xs text-zinc-500">If this is missing, protected requests from this browser will fail until you sign in again.</p>
          </div>
          <div className="rounded-2xl p-4" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
            <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
              <Shield01Icon size={16} />
              <span className="text-sm font-medium">Sign-in method</span>
            </div>
            <p className="mt-3 text-lg font-semibold text-zinc-900 dark:text-white">{isOIDCUser ? 'OIDC / SSO' : 'Local password'}</p>
            <p className="mt-1 text-xs text-zinc-500">
              {user.last_login_at
                ? `Last ${user.last_login_method === 'oidc' ? 'OIDC' : 'local'} sign-in: ${fullDate(user.last_login_at)}`
                : 'No successful sign-in timestamp has been recorded for this account yet.'}
            </p>
          </div>
          <div className="rounded-2xl p-4" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
            <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
              <UserAccountIcon size={16} />
              <span className="text-sm font-medium">Account identity</span>
            </div>
            <p className="mt-3 text-sm font-mono text-zinc-900 dark:text-white break-all">{user.id}</p>
            <p className="mt-1 text-xs text-zinc-500">Use this when matching audit logs, ownership, or support requests.</p>
          </div>
        </div>
      </Section>

      <Section title="Profile" description="Update your display name and email address.">
        <form onSubmit={handleSaveProfile} className="space-y-4">
          {profileMsg && <Alert message={profileMsg.text} type={profileMsg.type} />}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Username</label>
              <input
                className={inputCls}
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                minLength={2}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Email</label>
              <input
                type="email"
                className={inputCls}
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Role:</span>
              <span className="text-xs font-medium px-2 py-0.5 rounded-md capitalize"
                style={{ background: 'rgba(124,58,237,0.1)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.2)' }}>
                {user.role}
              </span>
            </div>
            <button
              type="submit"
              disabled={profileSaving}
              className="btn-primary inline-flex items-center gap-2"
            >
              {profileSaving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              Save Changes
            </button>
          </div>
        </form>
      </Section>

      <Section
        title="Security"
        description={isOIDCUser ? 'Password changes are disabled for accounts signed in through your identity provider.' : "Change your password. You'll need your current password to confirm."}
      >
        {isOIDCUser ? (
          <div className="rounded-2xl px-4 py-4 space-y-2" style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.18)' }}>
            <p className="text-sm font-medium text-zinc-900 dark:text-white">Password managed by your OIDC provider</p>
            <p className="text-sm text-zinc-500">This account was authenticated through single sign-on. Change your password in the connected identity provider instead of JustScan.</p>
            {user.last_login_at ? <p className="text-xs text-zinc-500">Last OIDC sign-in recorded at {fullDate(user.last_login_at)}.</p> : null}
          </div>
        ) : (
          <form onSubmit={handleChangePassword} className="space-y-4">
            {pwMsg && <Alert message={pwMsg.text} type={pwMsg.type} />}
            <FormField
              autoComplete="current-password"
              label="Current Password"
              name="current-password"
              onChange={e => setCurrentPw(e.target.value)}
              required
              type="password"
              value={currentPw}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                autoComplete="new-password"
                label="New Password"
                minLength={8}
                name="new-password"
                onChange={e => setNewPw(e.target.value)}
                required
                type="password"
                value={newPw}
              />
              <FormField
                autoComplete="new-password"
                label="Confirm New Password"
                minLength={8}
                name="confirm-new-password"
                onChange={e => setConfirmPw(e.target.value)}
                required
                type="password"
                value={confirmPw}
              />
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={pwSaving}
                className="btn-primary inline-flex items-center gap-2"
              >
                {pwSaving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Change Password
              </button>
            </div>
          </form>
        )}
      </Section>

      <Section title="API Tokens" description="Create and manage personal access tokens for use in CI/CD pipelines, scripts, and external tools.">
        <Link
          href="/settings/tokens"
          className="btn-secondary inline-flex items-center gap-2"
        >
          <ApiIcon size={15} />
          Manage API Tokens
        </Link>
      </Section>
    </div>
  );
}
