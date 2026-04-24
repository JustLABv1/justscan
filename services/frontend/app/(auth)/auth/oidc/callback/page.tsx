'use client';
import { Logo } from '@/components/logo';
import { setToken, setUser } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

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
    fetch(`${API}/api/v1/user/`, {
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
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl"
            style={{
              background: 'linear-gradient(135deg,#7c3aed,#6d28d9)',
              boxShadow: '0 0 32px rgba(124,58,237,0.5),inset 0 1px 0 rgba(255,255,255,0.2)',
            }}
          >
            <Logo size={26} className="text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>JustScan</h1>
        </div>

        <div className="glass-panel rounded-2xl p-6 space-y-4 relative">
          <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
            style={{ background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.3),transparent)' }} />
          <div className="rounded-xl px-3.5 py-2.5 text-sm"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171' }}>
            {error}
          </div>
          <a
            href="/login"
            className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-white flex items-center justify-center transition-all hover:opacity-90"
            style={{
              background: 'linear-gradient(135deg,#7c3aed,#6d28d9)',
              boxShadow: '0 0 24px rgba(124,58,237,0.45)',
            }}
          >
            Back to Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <div
        className="inline-flex items-center justify-center w-14 h-14 rounded-2xl"
        style={{
          background: 'linear-gradient(135deg,#7c3aed,#6d28d9)',
          boxShadow: '0 0 32px rgba(124,58,237,0.5)',
        }}
      >
        <Logo size={26} className="text-white" />
      </div>
      <div className="w-6 h-6 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Completing sign-in…</p>
    </div>
  );
}
