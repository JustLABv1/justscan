'use client';
import { login, setToken, setUser } from '@/lib/api';
import { Shield01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: 12,
  color: '#f4f4f5',
};
const inputCls = 'w-full px-3.5 py-2.5 text-sm placeholder-zinc-600 outline-none focus:ring-1 focus:ring-violet-500/50 transition-all rounded-xl';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
          <Shield01Icon size={26} color="white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">JustScan</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Sign in to your account</p>
        </div>
      </div>

      {/* Card */}
      <div
        className="rounded-2xl p-6 space-y-4"
        style={{
          background: 'linear-gradient(145deg,rgba(255,255,255,0.05) 0%,rgba(255,255,255,0.015) 100%)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.09)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.07)',
        }}
      >
        {/* Top shimmer */}
        <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
          style={{ background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.3),transparent)' }} />

        {error && (
          <div className="rounded-xl px-3.5 py-2.5 text-sm"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-300">Email or Username</label>
            <input
              className={inputCls}
              style={inputStyle}
              type="text"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-300">Password</label>
            <input
              className={inputCls}
              style={inputStyle}
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
      </div>

      <p className="text-center text-sm text-zinc-600">
        No account?{' '}
        <Link href="/register" className="text-violet-400 hover:text-violet-300 font-medium transition-colors">
          Register
        </Link>
      </p>
    </div>
  );
}
