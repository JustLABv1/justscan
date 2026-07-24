'use client';
import { AuthCard } from '@/components/auth-card';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { getOIDCAvailability, register } from '@/lib/api';
import { Button, Form } from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [signUpEnabled, setSignUpEnabled] = useState(true);
  const [availabilityLoaded, setAvailabilityLoaded] = useState(false);

  useEffect(() => {
    getOIDCAvailability()
      .then((availability) =>
        setSignUpEnabled(availability.sign_up_enabled && availability.local_auth_enabled)
      )
      .catch(() => setSignUpEnabled(false))
      .finally(() => setAvailabilityLoaded(true));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(username, email, password);
      router.replace('/login');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="JustScan"
      subtitle="Let's get you set up with a new account."
      footer={
        <>
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-accent transition-colors hover:opacity-80"
          >
            Sign In
          </Link>
        </>
      }
    >
      {!availabilityLoaded ? null : !signUpEnabled ? (
        <FormAlert
          description="New account registration is disabled for this installation. Contact your administrator for access."
          status="accent"
          title="Sign-up disabled"
        />
      ) : (
        <>
          {error ? <FormAlert description={error} title="Registration failed" /> : null}
          <Form className="space-y-4" onSubmit={handleSubmit}>
            <FormField
              autoComplete="username"
              label="Username"
              onChange={(e) => setUsername(e.target.value)}
              placeholder="johndoe"
              required
              type="text"
              value={username}
            />
            <FormField
              autoComplete="email"
              label="Email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />
            <FormField
              autoComplete="new-password"
              description="Use at least 8 characters so the account is valid on first submission."
              label="Password"
              minLength={8}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              required
              type="password"
              value={password}
            />
            <Button fullWidth isPending={loading} type="submit">
              {({ isPending }) => (isPending ? 'Creating Account…' : 'Create Account')}
            </Button>
          </Form>
        </>
      )}
    </AuthCard>
  );
}
