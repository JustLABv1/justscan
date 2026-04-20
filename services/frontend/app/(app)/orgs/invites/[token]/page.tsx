'use client';

import { FormAlert } from '@/components/ui/form-alert';
import { acceptOrgInviteByToken } from '@/lib/api';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';

export default function AcceptOrgInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState<{ orgId: string; orgName?: string; role: string } | null>(null);

  async function handleAccept() {
    setLoading(true);
    setError('');
    try {
      const result = await acceptOrgInviteByToken(token);
      setAccepted({ orgId: result.org_id, orgName: result.org_name, role: result.role });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to accept organization invite');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Organization Invite</h1>
        <p className="text-sm text-zinc-500 mt-1">Accept this invite to join the organization in your signed-in account.</p>
      </div>

      {error ? <FormAlert title="Invite acceptance failed" description={error} /> : null}

      <div className="glass-panel rounded-2xl p-6 space-y-4">
        {accepted ? (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              You joined {accepted.orgName || 'the organization'} as {accepted.role}.
            </p>
            <div className="flex gap-3">
              <button className="btn-primary" onClick={() => router.push(`/orgs/${accepted.orgId}`)} type="button">
                Open organization
              </button>
              <Link href="/orgs" className="btn-secondary">Back to organizations</Link>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              This action will attach the invite to the currently signed-in user. You can also review pending invites from the Organizations page.
            </p>
            <div className="flex gap-3">
              <button className="btn-primary inline-flex items-center gap-2" disabled={loading} onClick={() => { void handleAccept(); }} type="button">
                {loading && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Accept invite
              </button>
              <Link href="/orgs" className="btn-secondary">Cancel</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}