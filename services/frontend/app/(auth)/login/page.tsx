'use client';
import { Logo } from '@/components/logo';
import { getOIDCAvailability, login, setToken, setUser } from '@/lib/api';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [localAuthEnabled, setLocalAuthEnabled] = useState(true);
  const [availabilityLoaded, setAvailabilityLoaded] = useState(false);

  useEffect(() => {
    getOIDCAvailability()
      .then((res) => {
        setOidcEnabled(res.oidc_enabled);
        setLocalAuthEnabled(res.local_auth_enabled);
      })
      .catch(() => {
        // If the endpoint fails, fall back to showing local auth
        setLocalAuthEnabled(true);
      })
      .finally(() => setAvailabilityLoaded(true));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await login(email, password);
      setToken(res.token); setUser(res.user);
      router.replace('/scans');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally { setLoading(false); }
  }

  if (!availabilityLoaded) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-6 h-6 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Brand mark */}
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
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>JustScan</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Sign in to your account</p>
        </div>
      </div>

      {/* Card */}
      <div className="glass-panel rounded-2xl p-6 space-y-4 relative">
        {/* Top shimmer */}
        <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
          style={{ background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.3),transparent)' }} />

        {error && (
          <div className="rounded-xl px-3.5 py-2.5 text-sm"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171' }}>
            {error}
          </div>
        )}

        {localAuthEnabled && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Email or Username</label>
              <input
                className="w-full px-3.5 py-2.5 text-sm outline-none focus:ring-1 focus:ring-violet-500/50 transition-all rounded-xl glass-input"
                type="text"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Password</label>
              <input
                className="w-full px-3.5 py-2.5 text-sm outline-none focus:ring-1 focus:ring-violet-500/50 transition-all rounded-xl glass-input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-white disabled:opacity-60 flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.98]"
              style={{
                background: 'linear-gradient(135deg,#7c3aed,#6d28d9)',
                boxShadow: '0 0 24px rgba(124,58,237,0.45),inset 0 1px 0 rgba(255,255,255,0.15)',
              }}
            >
              {loading
                ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : 'Sign In'
              }
            </button>
          </form>
        )}

        {oidcEnabled && (
          <>
            {localAuthEnabled && (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ background: 'rgba(167,139,250,0.15)' }} />
                <span className="text-xs" style={{ color: 'var(--text-faint)' }}>or</span>
                <div className="flex-1 h-px" style={{ background: 'rgba(167,139,250,0.15)' }} />
              </div>
            )}
            <a
              href={`${API}/api/v1/auth/oidc/login`}
              className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.98]"
              style={{
                background: 'rgba(124,58,237,0.12)',
                border: '1px solid rgba(124,58,237,0.3)',
                color: 'var(--text-primary)',
              }}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              Login with SSO
            </a>
          </>
        )}
      </div>

      {localAuthEnabled && (
        <p className="text-center text-sm" style={{ color: 'var(--text-faint)' }}>
          No account?{' '}
          <Link href="/register" className="text-violet-500 hover:text-violet-400 dark:text-violet-400 dark:hover:text-violet-300 font-medium transition-colors">
            Register
          </Link>
        </p>
      )}
    </div>
  );
}
