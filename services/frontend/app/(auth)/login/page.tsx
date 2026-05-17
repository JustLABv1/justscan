'use client';
import { AuthCard } from '@/components/auth-card';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { getOIDCAvailability, listOIDCProviders, login, OIDCProvider, setToken, setUser } from '@/lib/api';
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
  const [localAuthEnabled, setLocalAuthEnabled] = useState(true);
  const [oidcProviders, setOidcProviders] = useState<OIDCProvider[]>([]);
  const [availabilityLoaded, setAvailabilityLoaded] = useState(false);

  useEffect(() => {
    Promise.allSettled([
      getOIDCAvailability(),
      listOIDCProviders(),
    ]).then(([availability, providers]) => {
      if (availability.status === 'fulfilled') {
        setLocalAuthEnabled(availability.value.local_auth_enabled);
      }
      if (providers.status === 'fulfilled') {
        setOidcProviders(providers.value);
      }
    }).finally(() => setAvailabilityLoaded(true));
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
        <div className="size-6 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
      </div>
    );
  }

  const hasOIDC = oidcProviders.length > 0;

  return (
    <AuthCard
      title="JustScan"
      subtitle="Great to see you again. Sign in to continue."
      footer={localAuthEnabled ? (
        <>
          No account?{' '}
          <Link href="/register" className="font-medium text-accent transition-colors hover:opacity-80">
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
            className="btn-primary w-full"
            fullWidth
            isPending={loading}
            type="submit"
          >
            {({ isPending }) => (isPending ? 'Signing In…' : 'Sign In')}
          </Button>
        </Form>
      ) : null}

      {hasOIDC ? (
        <>
          {localAuthEnabled ? (
            <div className="flex items-center gap-3">
              <div
                className="h-px flex-1"
                style={{ background: 'color-mix(in oklab,var(--accent) 20%,transparent)' }}
              />
              <span className="text-xs" style={{ color: 'var(--text-faint)' }}>or</span>
              <div
                className="h-px flex-1"
                style={{ background: 'color-mix(in oklab,var(--accent) 20%,transparent)' }}
              />
            </div>
          ) : null}
          <div className="space-y-2">
            {oidcProviders.map((provider) => (
              <a
                key={provider.name}
                href={`${API}/api/v1/auth/oidc/${encodeURIComponent(provider.name)}/login`}
                className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.98]"
                style={{
                  background: provider.button_color
                    ? `${provider.button_color}1a`
                    : 'color-mix(in oklab,var(--accent) 12%,transparent)',
                  border: `1px solid ${
                    provider.button_color
                      ? `${provider.button_color}4d`
                      : 'color-mix(in oklab,var(--accent) 30%,transparent)'
                  }`,
                  color: 'var(--text-primary)',
                }}
              >
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                {provider.display_name}
              </a>
            ))}
          </div>
        </>
      ) : null}

      {!localAuthEnabled && !hasOIDC ? (
        <FormAlert
          description="No login methods are currently configured. Please contact your administrator."
          status="accent"
          title="No sign-in methods available"
        />
      ) : null}

      {!localAuthEnabled && hasOIDC ? (
        <FormAlert
          description="Local auth is disabled for this installation. Use your configured single sign-on provider to continue."
          status="accent"
          title="SSO required"
        />
      ) : null}
    </AuthCard>
  );
}
