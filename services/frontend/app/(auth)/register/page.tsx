'use client';
import { AuthCard } from '@/components/auth-card';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { register } from '@/lib/api';
import { Button, Form } from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
      subtitle="Create a new account"
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="text-violet-500 hover:text-violet-400 dark:text-violet-400 dark:hover:text-violet-300 font-medium transition-colors">
            Sign In
          </Link>
        </>
      }
    >
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
        <Button
          className="btn-primary w-full"
          fullWidth
          isPending={loading}
          type="submit"
        >
          {({ isPending }) => (isPending ? 'Creating Account…' : 'Create Account')}
        </Button>
      </Form>
    </AuthCard>
  );
}
