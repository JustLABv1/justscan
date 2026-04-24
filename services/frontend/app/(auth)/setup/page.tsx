'use client';

import { AuthCard } from '@/components/auth-card';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { createInitialAdmin, getSetupStatus, setToken, setUser, startSetupSession } from '@/lib/api';
import { Button, Form } from '@heroui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function SetupPage() {
	const router = useRouter();
	const [loading, setLoading] = useState(true);
	const [unlocking, setUnlocking] = useState(false);
	const [creatingAdmin, setCreatingAdmin] = useState(false);
	const [error, setError] = useState('');
	const [token, setTokenValue] = useState('');
	const [setupEnabled, setSetupEnabled] = useState(false);
	const [setupCompleted, setSetupCompleted] = useState(false);
	const [setupSessionActive, setSetupSessionActive] = useState(false);
	const [username, setUsername] = useState('');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');

	useEffect(() => {
		getSetupStatus()
			.then((status) => {
				setSetupEnabled(status.setup_enabled);
				setSetupCompleted(status.setup_completed);
				setSetupSessionActive(status.setup_session_active);
			})
			.catch((err: unknown) => {
				setError(err instanceof Error ? err.message : 'Failed to load setup status');
			})
			.finally(() => setLoading(false));
	}, []);

	async function handleUnlock(event: React.FormEvent) {
		event.preventDefault();
		setError('');
		setUnlocking(true);
		try {
			await startSetupSession(token);
			setSetupSessionActive(true);
			setTokenValue('');
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : 'Failed to unlock setup');
		} finally {
			setUnlocking(false);
		}
	}

	async function handleCreateInitialAdmin(event: React.FormEvent) {
		event.preventDefault();
		setError('');
		setCreatingAdmin(true);
		try {
			const response = await createInitialAdmin(username, email, password);
			setToken(response.token);
			setUser(response.user);
			router.replace('/admin');
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : 'Failed to create the initial admin');
		} finally {
			setCreatingAdmin(false);
		}
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center h-32">
				<div className="w-6 h-6 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
			</div>
		);
	}

	return (
		<AuthCard
			title="JustScan Setup"
			subtitle="Bootstrap the first platform admin before regular sign-in opens"
			footer={(
				<>
					Back to{' '}
					<Link href="/login" className="font-medium text-violet-500 transition-colors hover:text-violet-400 dark:text-violet-400 dark:hover:text-violet-300">
						Sign In
					</Link>
				</>
			)}
		>
			{error ? <FormAlert title="Setup failed" description={error} /> : null}

			{setupCompleted ? (
				<FormAlert
					title="Setup already completed"
					description="This installation is already initialized. Sign in with the configured authentication method."
					status="accent"
				/>
			) : !setupEnabled ? (
				<FormAlert
					title="Setup token missing"
					description="The backend does not have a setup token configured yet. Set BACKEND_SETUP_TOKEN before using the bootstrap flow."
					status="warning"
				/>
			) : !setupSessionActive ? (
				<>
					<FormAlert
						title="Operator verification required"
						description="Enter the bootstrap token to unlock the setup session. This token is configured out of band and is only used during first-install setup."
						status="accent"
					/>
					<Form className="space-y-4" onSubmit={handleUnlock}>
						<FormField
							autoComplete="off"
							label="Setup Token"
							onChange={(event) => setTokenValue(event.target.value)}
							placeholder="Paste the operator bootstrap token"
							required
							type="password"
							value={token}
						/>
						<Button className="btn-primary w-full" fullWidth isPending={unlocking} type="submit">
							{({ isPending }) => (isPending ? 'Unlocking…' : 'Unlock Setup')}
						</Button>
					</Form>
				</>
			) : (
				<>
					<FormAlert
						title="Setup unlocked"
						description="This first slice creates the initial local platform admin and marks setup complete. The direct OIDC-only completion path will reuse the same setup session in the next slice."
						status="accent"
					/>
					<Form className="space-y-4" onSubmit={handleCreateInitialAdmin}>
						<FormField
							autoComplete="username"
							label="Admin Username"
							onChange={(event) => setUsername(event.target.value)}
							placeholder="platform-admin"
							required
							type="text"
							value={username}
						/>
						<FormField
							autoComplete="email"
							label="Admin Email"
							onChange={(event) => setEmail(event.target.value)}
							placeholder="admin@example.com"
							required
							type="email"
							value={email}
						/>
						<FormField
							autoComplete="new-password"
							description="Use at least 8 characters."
							label="Admin Password"
							onChange={(event) => setPassword(event.target.value)}
							placeholder="Choose a strong password"
							required
							type="password"
							value={password}
						/>
						<Button className="btn-primary w-full" fullWidth isPending={creatingAdmin} type="submit">
							{({ isPending }) => (isPending ? 'Creating Admin…' : 'Create Initial Admin')}
						</Button>
					</Form>
				</>
			)}
		</AuthCard>
	);
}