'use client';

import type { ReactNode } from 'react';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { FormField } from '@/components/ui/form-field';
import { StatCard } from '@/components/ui/stat-card';
import { createUserToken, listUserTokens, PersonalToken, revokeUserToken } from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo, timeUntil } from '@/lib/time';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Label,
  Modal,
  Table,
  useOverlayState,
} from '@heroui/react';
import {
  Clock01Icon,
  Copy01Icon,
  Delete01Icon,
  FolderLibraryIcon,
  Key01Icon,
  Settings01Icon,
} from 'hugeicons-react';
import { useEffect, useRef, useState } from 'react';

const EXPIRY_OPTIONS = [
  { label: '30 days', value: 30 * 24 * 60 * 60 },
  { label: '90 days', value: 90 * 24 * 60 * 60 },
  { label: '180 days', value: 180 * 24 * 60 * 60 },
  { label: '1 year', value: 365 * 24 * 60 * 60 },
  { label: 'No expiry', value: 0 },
];

function SectionCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="rounded-[28px] p-6 md:p-7 space-y-5">
      <Card.Header className="block p-0">
        <p
          className="text-[11px] font-semibold uppercase tracking-[0.22em]"
          style={{ color: 'var(--text-faint)' }}
        >
          {eyebrow}
        </p>
        <Card.Title className="mt-2 text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">
          {title}
        </Card.Title>
        <Card.Description className="mt-1.5 text-sm leading-6 text-zinc-500">
          {description}
        </Card.Description>
      </Card.Header>
      <Card.Content className="p-0 pt-5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        {children}
      </Card.Content>
    </Card>
  );
}

function InlineAlert({ message, tone = 'warn' }: { message: string; tone?: 'warn' | 'danger' }) {
  return (
    <Alert status={tone === 'danger' ? 'danger' : 'warning'}>
      <Alert.Indicator />

      <Alert.Content>
        <Alert.Title>{message}</Alert.Title>
      </Alert.Content>
    </Alert>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div
      className="flex items-start justify-between gap-4 rounded-2xl px-4 py-3"
      style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}
    >
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      <span
        className={`text-right text-sm text-zinc-800 dark:text-zinc-100 ${mono ? 'font-mono break-all' : ''}`.trim()}
      >
        {value}
      </span>
    </div>
  );
}

function TokensLoadingState() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_360px]">
        <div className="skeleton h-[320px] rounded-[28px]" />
        <div className="skeleton h-[320px] rounded-[28px]" />
      </div>
      <div className="skeleton h-[340px] rounded-[28px]" />
      <div className="skeleton h-44 rounded-[28px]" />
    </div>
  );
}

function TokenStatusBadge({ token }: { token: PersonalToken }) {
  const now = new Date();
  const expiresAt = new Date(token.expires_at);
  const isNoExpiry = expiresAt.getFullYear() - now.getFullYear() >= 4;

  if (token.disabled) {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-md font-medium"
        style={{
          background: 'rgba(239,68,68,0.1)',
          color: '#f87171',
          border: '1px solid rgba(239,68,68,0.2)',
        }}
      >
        Revoked
      </span>
    );
  }
  if (!isNoExpiry && expiresAt < now) {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-md font-medium"
        style={{
          background: 'rgba(245,158,11,0.1)',
          color: '#fbbf24',
          border: '1px solid rgba(245,158,11,0.2)',
        }}
      >
        Expired
      </span>
    );
  }
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-md font-medium"
      style={{
        background: 'rgba(16,185,129,0.1)',
        color: '#34d399',
        border: '1px solid rgba(16,185,129,0.2)',
      }}
    >
      Active
    </span>
  );
}

function TokenExpiry({ token }: { token: PersonalToken }) {
  const expiresAt = new Date(token.expires_at);
  const now = new Date();
  const isNoExpiry = expiresAt.getFullYear() - now.getFullYear() >= 4;
  if (isNoExpiry) return <span className="text-zinc-500 text-sm">Never</span>;
  return (
    <span className="text-sm text-zinc-500" title={fullDate(token.expires_at)}>
      {expiresAt < now ? (
        <>Expired {timeAgo(token.expires_at)}</>
      ) : (
        <>Expires {timeUntil(token.expires_at)}</>
      )}
    </span>
  );
}

interface TokenRevealDialogProps {
  state: ReturnType<typeof useOverlayState>;
  rawToken: string;
}

function TokenRevealDialog({ state, rawToken }: TokenRevealDialogProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleCopy() {
    navigator.clipboard.writeText(rawToken).then(() => {
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Modal state={state}>
      <Modal.Backdrop>
        <Modal.Container size="md" placement="center">
          <Modal.Dialog className="overflow-hidden">
            <Modal.Header>
              <div className="flex min-w-0 items-center gap-3">
                <Modal.Icon className="bg-accent/10 text-accent">
                  <Key01Icon size={18} />
                </Modal.Icon>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">
                  Token Created
                </Modal.Heading>
              </div>
              <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
            </Modal.Header>
            <Modal.Body className="px-6 py-5 space-y-4">
              <Alert status="warning">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>
                    This token will not be shown again. Copy it now and store it somewhere safe.
                  </Alert.Title>
                </Alert.Content>
              </Alert>
              <div className="rounded-xl p-3 font-mono text-xs break-all relative bg-surface-secondary">
                {rawToken}
              </div>
              <Button
                type="button"
                onPress={handleCopy}
                className="btn-primary w-full flex items-center justify-center gap-2"
                variant="primary"
              >
                <Copy01Icon size={15} />
                {copied ? 'Copied!' : 'Copy Token'}
              </Button>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

interface CreateTokenDialogProps {
  state: ReturnType<typeof useOverlayState>;
  onCreated: (rawToken: string) => void;
}

function CreateTokenDialog({ state, onCreated }: CreateTokenDialogProps) {
  const [description, setDescription] = useState('');
  const [expiresIn, setExpiresIn] = useState(EXPIRY_OPTIONS[1].value); // 90 days default
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const result = await createUserToken(description, expiresIn);
      setDescription('');
      setExpiresIn(EXPIRY_OPTIONS[1].value);
      state.close();
      onCreated(result.key);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create token');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal state={state}>
      <Modal.Backdrop isDismissable>
        <Modal.Container size="md" placement="center">
          <Modal.Dialog className="overflow-hidden">
            <Modal.Header>
              <div className="flex min-w-0 items-center gap-3">
                <Modal.Icon className="bg-default text-foreground">
                  <Settings01Icon size={18} />
                </Modal.Icon>
                <Modal.Heading className="font-semibold">New API Token</Modal.Heading>
              </div>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body>
              <form id="create-token-form" onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <Alert status="danger">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>{error}</Alert.Title>
                    </Alert.Content>
                  </Alert>
                )}
                <FormField
                  label="Token name"
                  placeholder="e.g. GitLab CI/CD, Local dev"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  minLength={2}
                  maxLength={128}
                />
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Expiration
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {EXPIRY_OPTIONS.map((opt) => (
                      <Button
                        key={opt.value}
                        size="sm"
                        onPress={() => setExpiresIn(opt.value)}
                        variant={expiresIn === opt.value ? 'primary' : 'outline'}
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </form>
            </Modal.Body>
            <Modal.Footer
              className="px-6 py-4 flex justify-end gap-2"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <Button
                type="button"
                onPress={() => state.close()}
                className="btn-secondary"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form="create-token-form"
                isDisabled={saving}
                className="btn-primary inline-flex items-center gap-2"
                variant="primary"
              >
                {saving && (
                  <div className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                Create Token
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

export default function TokensPage() {
  const [tokens, setTokens] = useState<PersonalToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [rawToken, setRawToken] = useState('');
  const createModal = useOverlayState();
  const revealModal = useOverlayState();
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  async function load() {
    setLoading(true);
    try {
      const res = await listUserTokens();
      setTokens(res.data ?? []);
    } catch {
      setTokens([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => deferEffect(load), []);

  function handleCreated(key: string) {
    setRawToken(key);
    revealModal.open();
    void load();
  }

  async function handleRevoke(token: PersonalToken) {
    const ok = await confirm({
      title: `Revoke "${token.description}"?`,
      message: 'Any scripts or services using this token will lose access immediately.',
      confirmLabel: 'Revoke',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await revokeUserToken(token.id);
      toast.success('Token revoked');
      void load();
    } catch {
      toast.error('Failed to revoke token');
    }
  }

  const now = new Date();
  const activeTokens = tokens.filter((token) => {
    if (token.disabled) return false;
    const expiresAt = new Date(token.expires_at);
    const isNoExpiry = expiresAt.getFullYear() - now.getFullYear() >= 4;
    return isNoExpiry || expiresAt >= now;
  });
  const revokedTokens = tokens.filter((token) => token.disabled).length;
  const expiringSoon = tokens.filter((token) => {
    if (token.disabled) return false;
    const expiresAt = new Date(token.expires_at);
    const isNoExpiry = expiresAt.getFullYear() - now.getFullYear() >= 4;
    if (isNoExpiry || expiresAt < now) return false;
    return expiresAt.getTime() - now.getTime() <= 30 * 24 * 60 * 60 * 1000;
  }).length;

  return (
    <div className="space-y-6">
      {confirmDialog}

      {loading ? (
        <TokensLoadingState />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total tokens"
              value={tokens.length}
              hint="All tokens ever issued for this account."
              icon={<Key01Icon size={16} />}
              iconTone="accent"
              valueClassName="text-lg font-semibold text-zinc-900 dark:text-white"
            />
            <StatCard
              label="Active now"
              value={activeTokens.length}
              hint="Usable tokens that are not revoked or expired."
              icon={<Key01Icon size={16} />}
              iconTone="success"
              valueClassName="text-lg font-semibold text-zinc-900 dark:text-white"
            />
            <StatCard
              label="Expiring soon"
              value={expiringSoon}
              hint="Tokens that expire within the next 30 days."
              icon={<Clock01Icon size={16} />}
              iconTone="warning"
              valueClassName="text-lg font-semibold text-zinc-900 dark:text-white"
            />
            <StatCard
              label="Revoked"
              value={revokedTokens}
              hint="Disabled tokens retained for audit visibility."
              icon={<Delete01Icon size={16} />}
              iconTone="danger"
              valueClassName="text-lg font-semibold text-zinc-900 dark:text-white"
            />
          </div>

          <Card>
            <Card.Header>
              <div className="flex flex-cols items-center justify-between">
                <div>
                  <Card.Title>Tokens</Card.Title>
                  <Card.Description>
                    Overview of your personal API tokens. Use them for user-scoped scripts and local
                    automation. For shared CI/CD pipelines, prefer organization tokens so the
                    pipeline is not tied to one user account.
                  </Card.Description>
                </div>

                <Button
                  variant="secondary"
                  onPress={() => {
                    createModal.open();
                  }}
                >
                  Create new Token
                </Button>
              </div>
            </Card.Header>

            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label="Personal API tokens" className="min-w-[820px]">
                  <Table.Header>
                    <Table.Column isRowHeader>Name</Table.Column>
                    <Table.Column>Created</Table.Column>
                    <Table.Column>Expiry</Table.Column>
                    <Table.Column>Status</Table.Column>
                    <Table.Column>Actions</Table.Column>
                  </Table.Header>
                  <Table.Body
                    renderEmptyState={() => (
                      <EmptyState className="flex h-full w-full flex-col items-center justify-center gap-4 text-center">
                        <FolderLibraryIcon className="size-6 text-muted" />
                        <span className="text-sm text-muted">No results found</span>
                      </EmptyState>
                    )}
                  >
                    {tokens.map((token) => (
                      <Table.Row
                        key={token.id}
                        id={token.id}
                        className="hover:bg-[var(--row-hover)]"
                      >
                        <Table.Cell>
                          <div className="min-w-0">
                            <p className="font-medium text-zinc-900 dark:text-white break-words">
                              {token.description}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500 md:hidden">
                              Created {timeAgo(token.created_at)}
                            </p>
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="text-sm text-zinc-500 hidden md:inline">
                            {timeAgo(token.created_at)}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <div className="text-sm text-zinc-500">
                            <TokenExpiry token={token} />
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <TokenStatusBadge token={token} />
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex justify-end">
                            {!token.disabled ? (
                              <Button
                                onPress={() => void handleRevoke(token)}
                                isIconOnly
                                variant="secondary"
                              >
                                <Delete01Icon size={15} />
                              </Button>
                            ) : (
                              <span />
                            )}
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </Card>

          <Card>
            <Card.Header>
              <Card.Title>Using personal tokens</Card.Title>
              <Card.Description>
                Set the token as a bearer credential in the Authorization header. For shared
                pipeline automation, create an org token instead and call the org-scoped pipeline
                scan endpoint.
              </Card.Description>
            </Card.Header>
            <Card.Content className="gap-3">
              <InlineAlert message="A newly created token is shown only once. Copy it immediately and move it into a secret manager before closing the reveal dialog." />
              <pre className="text-xs font-mono p-4 rounded-[24px] bg-surface-secondary overflow-x-auto">
                {`curl -X POST https://justscan.example.com/api/v1/scans \\
  -H "Authorization: Bearer <your-token>" \\
  -H "Content-Type: application/json" \\
  -d '{"image": "registry.example.com/my-app:latest"}'`}
              </pre>
            </Card.Content>
          </Card>
        </>
      )}

      <CreateTokenDialog state={createModal} onCreated={handleCreated} />
      <TokenRevealDialog state={revealModal} rawToken={rawToken} />
    </div>
  );
}
