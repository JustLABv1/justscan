'use client';
import { Logo } from '@/components/logo';
import { getApiBase } from '@/lib/api/base';
import { setToken, setUser } from '@/lib/api';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

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
    if (typeof window !== 'undefined') {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('No authentication token received. Please try again.');
      return;
    }

    // Fetch the current user details using the new token.
    const apiBase = getApiBase();
    fetch(`${apiBase}/api/v1/user/`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Failed to load user (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        setToken(token);
        setUser(data.user ?? data);
        router.replace('/scans');
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
      });
  }, [router]);

  if (error) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-3">
          <Logo size={60} className="mx-auto" />
          <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>JustScan</h1>
        </div>

        <div className="surface-panel rounded-2xl p-6 space-y-4 relative">
          <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
            style={{ background: 'linear-gradient(90deg,transparent,color-mix(in srgb, var(--accent) 30%, transparent),transparent)' }} />
          <div className="rounded-xl px-3.5 py-2.5 text-sm"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171' }}>
            {error}
          </div>
          <Link
            href="/login"
            className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-white flex items-center justify-center transition-all hover:opacity-90"
            style={{
              background: 'linear-gradient(135deg,var(--accent),color-mix(in srgb, var(--accent) 82%, black))',
              boxShadow: '0 0 24px color-mix(in srgb, var(--accent) 45%, transparent)',
            }}
          >
            Back to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <Logo size={60} />
      <div className="size-6 border-2 border-accent-500/30 border-t-accent-500 rounded-full animate-spin" />
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Completing sign-in…</p>
    </div>
  );
}
