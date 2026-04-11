'use client';
import { AuthCard } from '@/components/auth-card';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { getOIDCAvailability, login, setToken, setUser } from '@/lib/api';
import { Button, Form } from '@heroui/react';
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
    <AuthCard
      title="JustScan"
      subtitle="Sign in to your account"
      footer={localAuthEnabled ? (
        <>
          No account?{' '}
          <Link href="/register" className="text-violet-500 hover:text-violet-400 dark:text-violet-400 dark:hover:text-violet-300 font-medium transition-colors">
            Register
          </Link>
        </>
      ) : undefined}
    >
      {error ? <FormAlert description={error} title="Sign-in failed" /> : null}

      {localAuthEnabled ? (
        <Form className="space-y-4" onSubmit={handleSubmit}>
          <FormField
            autoComplete="username"
            label="Email or Username"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            type="text"
            value={email}
          />
          <FormField
            autoComplete="current-password"
            label="Password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            type="password"
            value={password}
          />
          <Button
            className="w-full rounded-xl text-sm font-semibold text-white"
            isPending={loading}
            style={{
              background: 'linear-gradient(135deg,#7c3aed,#6d28d9)',
              boxShadow: '0 0 24px rgba(124,58,237,0.45),inset 0 1px 0 rgba(255,255,255,0.15)',
            }}
            type="submit"
          >
            {({ isPending }) => (isPending ? 'Signing In…' : 'Sign In')}
          </Button>
        </Form>
      ) : null}

      {oidcEnabled ? (
        <>
          {localAuthEnabled ? (
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px" style={{ background: 'rgba(167,139,250,0.15)' }} />
              <span className="text-xs" style={{ color: 'var(--text-faint)' }}>or</span>
              <div className="flex-1 h-px" style={{ background: 'rgba(167,139,250,0.15)' }} />
            </div>
          ) : null}
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
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Login with SSO
          </a>
        </>
      ) : null}

      {!localAuthEnabled && oidcEnabled ? (
        <FormAlert
          description="Local auth is disabled for this installation. Use your configured single sign-on provider to continue."
          status="accent"
          title="SSO required"
        />
      ) : null}
    </AuthCard>
  );
}
