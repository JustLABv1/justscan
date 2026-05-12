'use client';

import { FormField } from '@/components/ui/form-field';
import { changePassword, getUserDetails, setUser, updateUserDetails, User } from '@/lib/api';
import { Avatar, Button, Card } from '@heroui/react';
import { PencilEdit02Icon } from 'hugeicons-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

function splitName(value: string) {
  const cleaned = value.trim();
  if (!cleaned) return { firstName: '', lastName: '' };
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function InlineAlert({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div
      className="rounded-xl px-3 py-2 text-sm"
      style={
        type === 'success'
          ? {
              background: 'rgba(16,185,129,0.08)',
              border: '1px solid rgba(16,185,129,0.2)',
              color: '#34d399',
            }
          : {
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.2)',
              color: '#f87171',
            }
      }
    >
      {message}
    </div>
  );
}

function FieldDisplay({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">{value || '-'}</p>
    </div>
  );
}

function SectionHeader({
  title,
  editing,
  onEdit,
  onCancel,
  disabled = false,
}: {
  title: string;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      {editing ? (
        <Button variant="tertiary" className="h-8 rounded-full px-3 text-xs" onPress={onCancel}>
          Cancel
        </Button>
      ) : (
        <Button
          variant="tertiary"
          isDisabled={disabled}
          className="h-8 rounded-full px-3 text-xs"
          onPress={onEdit}
        >
          <PencilEdit02Icon size={13} />
          Edit
        </Button>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUserState] = useState<User | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [securityEditing, setSecurityEditing] = useState(false);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(
    null
  );

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    getUserDetails()
      .then(({ user: nextUser }) => {
        setUserState(nextUser);
        setUsername(nextUser.username ?? '');
        setEmail(nextUser.email ?? '');
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  const nameParts = useMemo(
    () => splitName(username || user?.username || ''),
    [user?.username, username]
  );
  const roleLabel = user?.role
    ? `${user.role[0].toUpperCase()}${user.role.slice(1)}`
    : 'Team Member';
  const isOIDCUser = user?.auth_type === 'oidc';

  async function handleSaveProfile(event: React.FormEvent) {
    event.preventDefault();
    setProfileMsg(null);
    setProfileSaving(true);
    try {
      await updateUserDetails(username, email);
      if (user) {
        const updated = { ...user, username, email };
        setUserState(updated);
        setUser(updated);
      }
      setProfileEditing(false);
      setProfileMsg({ text: 'Profile updated successfully.', type: 'success' });
    } catch (error: unknown) {
      setProfileMsg({
        text: error instanceof Error ? error.message : 'Failed to update profile',
        type: 'error',
      });
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleChangePassword(event: React.FormEvent) {
    event.preventDefault();
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
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setSecurityEditing(false);
      setPwMsg({ text: 'Password changed successfully.', type: 'success' });
    } catch (error: unknown) {
      setPwMsg({
        text: error instanceof Error ? error.message : 'Failed to change password',
        type: 'error',
      });
    } finally {
      setPwSaving(false);
    }
  }

  if (!user) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-28 rounded-2xl" />
        <div className="skeleton h-64 rounded-2xl" />
        <div className="skeleton h-48 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <Card.Content className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Avatar size="lg" className="h-14 w-14">
                <Avatar.Fallback>
                  {(user?.username ?? user?.email ?? 'U')[0]?.toUpperCase() ?? 'U'}
                </Avatar.Fallback>
              </Avatar>
              <div>
                <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {username || email || 'Account user'}
                </p>
                <p className="text-sm text-zinc-500">{roleLabel}</p>
                <p className="text-xs text-zinc-500">Personal workspace</p>
              </div>
            </div>
            <Button
              type="button"
              variant="tertiary"
              className="h-9 rounded-full px-3 text-xs"
              onPress={() => setProfileEditing(true)}
            >
              <PencilEdit02Icon size={13} />
              Edit
            </Button>
          </div>
        </Card.Content>
      </Card>

      <Card>
        <Card.Content className="space-y-4 p-4 sm:p-5">
          <SectionHeader
            title="Personal Information"
            editing={profileEditing}
            onEdit={() => setProfileEditing(true)}
            onCancel={() => {
              setProfileEditing(false);
              setUsername(user.username ?? '');
              setEmail(user.email ?? '');
            }}
          />

          {profileMsg ? <InlineAlert message={profileMsg.text} type={profileMsg.type} /> : null}

          {profileEditing ? (
            <form className="space-y-4" onSubmit={handleSaveProfile}>
              <div className="grid gap-3 md:grid-cols-2">
                <FormField
                  label="Username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
                <FormField
                  label="Email address"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" variant="primary" isDisabled={profileSaving}>
                  Save Changes
                </Button>
              </div>
            </form>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FieldDisplay label="First Name" value={nameParts.firstName} />
              <FieldDisplay label="Last Name" value={nameParts.lastName} />
              <FieldDisplay label="Email address" value={email} />
              <FieldDisplay label="Bio" value={roleLabel} />
            </div>
          )}
        </Card.Content>
      </Card>

      <Card className="rounded-2xl border border-zinc-200 shadow-none dark:border-zinc-800">
        <Card.Content className="space-y-4 p-4 sm:p-5">
          <SectionHeader
            title="Security"
            editing={securityEditing}
            onEdit={() => setSecurityEditing(true)}
            onCancel={() => {
              setSecurityEditing(false);
              setCurrentPw('');
              setNewPw('');
              setConfirmPw('');
            }}
            disabled={isOIDCUser}
          />

          {pwMsg ? <InlineAlert message={pwMsg.text} type={pwMsg.type} /> : null}

          {isOIDCUser ? (
            <p className="text-sm text-zinc-500">
              This account uses single sign-on (OIDC). Password updates are managed in your identity
              provider.
            </p>
          ) : securityEditing ? (
            <form className="space-y-4" onSubmit={handleChangePassword}>
              <FormField
                label="Current Password"
                type="password"
                autoComplete="current-password"
                value={currentPw}
                onChange={(event) => setCurrentPw(event.target.value)}
                required
              />
              <div className="grid gap-3 md:grid-cols-2">
                <FormField
                  label="New Password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={newPw}
                  onChange={(event) => setNewPw(event.target.value)}
                  required
                />
                <FormField
                  label="Confirm New Password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={confirmPw}
                  onChange={(event) => setConfirmPw(event.target.value)}
                  required
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" variant="primary" isDisabled={pwSaving}>
                  Change Password
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-zinc-500">
              Update your password when needed to keep account access secure.
            </p>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}
