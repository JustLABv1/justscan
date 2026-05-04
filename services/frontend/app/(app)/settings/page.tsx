'use client';

import type { CSSProperties, ReactNode } from 'react';

import { FormField } from '@/components/ui/form-field';
import { nativeFieldClassName } from '@/components/ui/form-styles';
import { changePassword, getAuthSnapshot, getUserDetails, setUser, updateUserDetails, User } from '@/lib/api';
import { fullDate } from '@/lib/time';
import { ApiIcon, Clock01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const inputCls = nativeFieldClassName;

const panelStyle: CSSProperties = {
  background: 'var(--glass-bg)',
  border: '1px solid var(--glass-border)',
  boxShadow: 'var(--glass-shadow)',
};

const heroShellStyle: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(124,58,237,0.12) 0%, rgba(59,130,246,0.08) 38%, rgba(255,255,255,0.04) 100%), var(--glass-bg)',
  border: '1px solid rgba(124,58,237,0.16)',
  boxShadow: '0 30px 80px rgba(124,58,237,0.10), var(--glass-shadow)',
};

function SectionCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[28px] p-6 md:p-7 space-y-5" style={panelStyle}>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--text-faint)' }}>
          {eyebrow}
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">{title}</h2>
        <p className="mt-1.5 text-sm leading-6 text-zinc-500">{description}</p>
      </div>
      <div className="pt-5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        {children}
      </div>
    </section>
  );
}

function InlineAlert({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div className="rounded-2xl px-4 py-3 text-sm" style={
      type === 'success'
        ? { background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399' }
        : { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }
    }>
      {message}
    </div>
  );
}

function HeroPill({ icon, label, tone = 'default' }: { icon: ReactNode; label: string; tone?: 'default' | 'good' | 'warn' }) {
  const toneStyle = tone === 'good'
    ? { background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.22)', color: '#34d399' }
    : tone === 'warn'
      ? { background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.22)', color: '#fbbf24' }
      : { background: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.22)', color: 'var(--text-primary)' };

  return (
    <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium" style={toneStyle}>
      {icon}
      {label}
    </span>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      <span className={`text-right text-sm text-zinc-800 dark:text-zinc-100 ${mono ? 'font-mono break-all' : ''}`.trim()}>{value}</span>
    </div>
  );
}

function SettingsLoadingState() {
  return (
    <div className="space-y-6">
      <div className="rounded-[30px] p-8 space-y-6" style={heroShellStyle}>
        <div className="space-y-3">
          <div className="skeleton h-3 w-24 rounded-full" />
          <div className="skeleton h-10 w-56 rounded-2xl" />
          <div className="skeleton h-4 w-full max-w-2xl rounded" />
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton h-28 rounded-3xl" />
          ))}
        </div>
      </div>
      <div className="skeleton h-20 rounded-3xl" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <div className="skeleton h-[420px] rounded-[28px]" />
        <div className="skeleton h-[420px] rounded-[28px]" />
      </div>
      <div className="skeleton h-44 rounded-[28px]" />
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

  if (!user) return <SettingsLoadingState />;

  const isOIDCUser = user.auth_type === 'oidc';
  const displayName = user.username || user.email || 'Account';
  const sessionExpiryLabel = authSnapshot.expires_at ? fullDate(authSnapshot.expires_at) : 'Unknown';
  const sessionWindowLabel = authSnapshot.expires_in_seconds != null
    ? authSnapshot.expires_in_seconds < 3600
      ? 'Less than 1 hour remaining'
      : `${Math.floor(authSnapshot.expires_in_seconds / 3600)}h session window`
    : 'Session window unavailable';
  const browserTokenLabel = authSnapshot.token_present ? 'Browser token present' : 'Browser token missing';
  const authMethodLabel = isOIDCUser ? 'OIDC / SSO' : 'Local password';
  const lastSignInLabel = user.last_login_at
    ? fullDate(user.last_login_at)
    : 'No sign-in recorded yet';

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.12fr)_minmax(340px,0.88fr)]">
        <SectionCard
          eyebrow="About you"
          title="Profile workspace"
          description="Update the account details other people recognize and keep the fixed identity information close by when you need it."
        >
          <div className="grid gap-6">
            <form onSubmit={handleSaveProfile} className="space-y-5">
              {profileMsg ? <InlineAlert message={profileMsg.text} type={profileMsg.type} /> : null}
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  label="Username"
                  description="Displayed across your account and activity surfaces."
                  name="username"
                  onChange={e => setUsername(e.target.value)}
                  required
                  value={username}
                />
                <FormField
                  label="Email"
                  description="Used for sign-in and account notifications."
                  name="email"
                  onChange={e => setEmail(e.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-white">Profile changes stay local to this account</p>
                  <p className="mt-1 text-xs text-zinc-500">Update display information without affecting sign-in ownership or access rules.</p>
                </div>
                <button
                  type="submit"
                  disabled={profileSaving}
                  className="btn-primary inline-flex items-center gap-2 shrink-0"
                >
                  {profileSaving ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
                  Save Changes
                </button>
              </div>
            </form>

            <div className="space-y-3 rounded-[24px] p-5" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Identity context</p>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                  These details are useful when you are matching audit trails, support requests, and ownership across the product.
                </p>
              </div>

              <DetailRow label="Account id" value={user.id} mono />
              <DetailRow label="Role" value={<span className="capitalize">{user.role}</span>} />
              <DetailRow label="Current email" value={user.email || 'No email address on file'} mono />
            </div>
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Protect your account"
          title="Security workspace"
          description={isOIDCUser ? 'Your identity provider controls password changes. Use this panel to confirm trust state and provider-managed access details.' : 'Change your password and confirm the current trust state of this browser session.'}
        >
          <div className="space-y-5">
            <div className="rounded-[24px] p-5" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white">Current access posture</p>
                  <p className="mt-1 text-xs text-zinc-500">Signed in via {authMethodLabel}. {authSnapshot.token_present ? 'Protected requests will authenticate from this browser.' : 'Protected requests may fail until you sign in again.'}</p>
                </div>
                <HeroPill icon={<Clock01Icon size={14} />} label={sessionWindowLabel} tone={authSnapshot.token_present ? 'good' : 'warn'} />
              </div>
            </div>

            {isOIDCUser ? (
              <div className="space-y-4 rounded-[24px] p-5" style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.10) 0%, rgba(59,130,246,0.08) 100%)', border: '1px solid rgba(124,58,237,0.18)' }}>
                <div>
                  <p className="text-base font-semibold text-zinc-900 dark:text-white">Password managed by your identity provider</p>
                  <p className="mt-1.5 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                    This account signs in through single sign-on. Change your password and authentication policies in the connected identity provider instead of inside JustScan.
                  </p>
                </div>
                <div className="space-y-3">
                  <DetailRow label="Sign-in method" value="OIDC / SSO" />
                  <DetailRow label="Last provider sign-in" value={lastSignInLabel} />
                  <DetailRow label="Browser token" value={browserTokenLabel} />
                </div>
              </div>
            ) : (
              <form onSubmit={handleChangePassword} className="space-y-5">
                {pwMsg ? <InlineAlert message={pwMsg.text} type={pwMsg.type} /> : null}
                <FormField
                  autoComplete="current-password"
                  label="Current Password"
                  description="Use your current password to confirm account ownership before applying a new one."
                  name="current-password"
                  onChange={e => setCurrentPw(e.target.value)}
                  required
                  type="password"
                  value={currentPw}
                />
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    autoComplete="new-password"
                    description="Use at least 8 characters."
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
                    description="Repeat the new password exactly."
                    label="Confirm New Password"
                    minLength={8}
                    name="confirm-new-password"
                    onChange={e => setConfirmPw(e.target.value)}
                    required
                    type="password"
                    value={confirmPw}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                  <p className="text-xs leading-5 text-zinc-500 max-w-md">
                    Password updates apply to local JustScan authentication only. If you use SSO, this panel will switch to provider-managed guidance automatically.
                  </p>
                  <button
                    type="submit"
                    disabled={pwSaving}
                    className="btn-primary inline-flex items-center gap-2 shrink-0"
                  >
                    {pwSaving ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
                    Change Password
                  </button>
                </div>
              </form>
            )}
          </div>
        </SectionCard>
      </div>

      <section className="rounded-[28px] p-6 md:p-7" style={panelStyle}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_auto] lg:items-center">
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--text-faint)' }}>
              Developer access
            </p>
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">API tokens stay close, but out of the way.</h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-zinc-500">
                Create and manage personal access tokens for CI/CD pipelines, scripts, and external tools without letting developer access overshadow the core account experience.
              </p>
            </div>
          </div>

          <div className="rounded-[24px] p-5 min-w-[280px]" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">Manage API tokens on a dedicated screen</p>
            <p className="mt-1.5 text-sm leading-6 text-zinc-500">Open the token management page when you need to create, reveal, or revoke credentials for automation.</p>
            <Link
              href="/settings/tokens"
              className="btn-secondary mt-4 inline-flex items-center gap-2"
            >
              <ApiIcon size={15} />
              Open Token Management
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
