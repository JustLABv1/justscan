'use client';

import { FormAlert } from '@/components/ui/form-alert';
import { PageHeader } from '@/components/ui/page-header';
import { acceptOrgInviteByToken } from '@/lib/api';
import { Button, Card, buttonVariants } from '@heroui/react';
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
    <div className="space-y-5 px-4 py-6 md:px-6 xl:py-7">
      <PageHeader
        title="Organization invite"
        description="Accept this invite to join the organization in your signed-in account."
        breadcrumbs={[{ label: 'Organizations', href: '/orgs' }, { label: 'Invite' }]}
      />

      {error ? <FormAlert title="Invite acceptance failed" description={error} /> : null}

      <Card>
        <Card.Content className="space-y-4 p-6">
        {accepted ? (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              You joined {accepted.orgName || 'the organization'} as {accepted.role}.
            </p>
            <div className="flex gap-3">
              <Button onPress={() => router.push(`/orgs/${accepted.orgId}`)}>
                Open organization
              </Button>
              <Link href="/orgs" className={buttonVariants({ variant: 'secondary' })}>Back to organizations</Link>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              This action will attach the invite to the currently signed-in user. You can also review pending invites from the Organizations page.
            </p>
            <div className="flex gap-3">
              <Button isPending={loading} onPress={() => { void handleAccept(); }}>
                Accept invite
              </Button>
              <Link href="/orgs" className={buttonVariants({ variant: 'secondary' })}>Cancel</Link>
            </div>
          </>
        )}
        </Card.Content>
      </Card>
    </div>
  );
}
