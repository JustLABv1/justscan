'use client';
import { changePassword, getUserDetails, setUser, updateUserDetails, User } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const inputCls = 'w-full px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input';

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

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Settings</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Manage your account profile and security</p>
      </div>

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
              className="px-4 py-2 text-sm rounded-xl font-semibold text-white disabled:opacity-60 flex items-center gap-2 transition-all hover:opacity-90 active:scale-95"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 16px rgba(124,58,237,0.35),inset 0 1px 0 rgba(255,255,255,0.15)' }}
            >
              {profileSaving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              Save Changes
            </button>
          </div>
        </form>
      </Section>

      <Section title="Security" description="Change your password. You'll need your current password to confirm.">
        <form onSubmit={handleChangePassword} className="space-y-4">
          {pwMsg && <Alert message={pwMsg.text} type={pwMsg.type} />}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Current Password</label>
            <input
              type="password"
              className={inputCls}
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">New Password</label>
              <input
                type="password"
                className={inputCls}
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Confirm New Password</label>
              <input
                type="password"
                className={inputCls}
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={pwSaving}
              className="px-4 py-2 text-sm rounded-xl font-semibold text-white disabled:opacity-60 flex items-center gap-2 transition-all hover:opacity-90 active:scale-95"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 16px rgba(124,58,237,0.35),inset 0 1px 0 rgba(255,255,255,0.15)' }}
            >
              {pwSaving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              Change Password
            </button>
          </div>
        </form>
      </Section>
    </div>
  );
}
