'use client';
import { AuthCard } from '@/components/auth-card';
import { buttonVariants, Skeleton } from '@/components/ui';
import { FormAlert } from '@/components/ui/form-alert';
import { getApiBase } from '@/lib/api/base';
import { setToken, setUser } from '@/lib/api';
import { consumeAuthReturnUrl } from '@/lib/auth-return-url';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

class SignInError extends Error {}

function describeStatus(status: number): string {
  if (status === 401 || status === 403) return 'Your sign-in expired. Try again.';
  if (status >= 500)
    return 'JustScan could not finish signing you in right now. Try again in a moment.';
  return 'We could not complete sign-in. Try again.';
}

export default function OIDCCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState('');

  useEffect(() => {
    // The token is delivered in the URL fragment (#token=...) to prevent
    // it from being sent to the server in request logs.
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
    const token = params.get('token');

    // Remove fragment from browser history immediately so the token is not
    // visible in the URL bar or navigation history.
    history.replaceState(null, '', window.location.pathname + window.location.search);

    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('Your identity provider did not return a session. Try signing in again.');
      return;
    }

    // Fetch the current user details using the new token.
    fetch(`${getApiBase()}/api/v1/user/`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
      .then((res) => {
        if (!res.ok) throw new SignInError(describeStatus(res.status));
        return res.json();
      })
      .then((data) => {
        setToken(token);
        setUser(data.user ?? data);
        router.replace(consumeAuthReturnUrl() ?? '/scans');
      })
      .catch((err: unknown) => {
        setError(
          err instanceof SignInError
            ? err.message
            : 'We could not reach JustScan to finish signing in. Check your connection and try again.'
        );
      });
  }, [router]);

  if (error) {
    return (
      <AuthCard title="Sign-in didn’t finish" subtitle="Nothing was changed. You can start again.">
        <FormAlert description={error} />
        <Link href="/login" className={buttonVariants({ fullWidth: true, size: 'lg' })}>
          Back to sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Signing you in" subtitle="Completing sign-in with your identity provider…">
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">Completing sign-in</span>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </div>
    </AuthCard>
  );
}
