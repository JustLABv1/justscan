'use client';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { FormField } from '@/components/ui/form-field';
import { FormAlert, StatusAlert } from '@/components/ui/form-alert';
import { StatusTag } from '@/components/ui/status-dot';
import { JOB_STATUS_LABELS, labelFor } from '@/lib/labels';
import { createUserToken, listUserTokens, PersonalToken, revokeUserToken } from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo, timeUntil } from '@/lib/time';
import {
  Alert,
  Button,
  Card,
  Label,
  Modal,
  ResourceList,
  Skeleton,
  useOverlayState,
} from '@/components/ui';
import { Copy01Icon, Delete01Icon, Key01Icon, PlusSignIcon, Settings01Icon } from 'hugeicons-react';
import { useEffect, useRef, useState } from 'react';

const EXPIRY_OPTIONS = [
  { label: '30 days', value: 30 * 24 * 60 * 60 },
  { label: '90 days', value: 90 * 24 * 60 * 60 },
  { label: '180 days', value: 180 * 24 * 60 * 60 },
  { label: '1 year', value: 365 * 24 * 60 * 60 },
  { label: 'No expiry', value: 0 },
];

/** "created yesterday" rather than "created Yesterday"; dates keep their capitals. */
function lowerRelative(text: string) {
  return /^(Just now|Yesterday)$/.test(text) ? text.toLowerCase() : text;
}

function isNoExpiryToken(token: PersonalToken, now = new Date()) {
  return new Date(token.expires_at).getFullYear() - now.getFullYear() >= 4;
}

function TokensLoadingState() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading tokens">
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-44 rounded-xl" />
    </div>
  );
}

function tokenStatus(token: PersonalToken, now = new Date()): 'active' | 'expired' | 'revoked' {
  if (token.disabled) return 'revoked';
  if (!isNoExpiryToken(token, now) && new Date(token.expires_at) < now) return 'expired';
  return 'active';
}

function TokenStatusBadge({ token }: { token: PersonalToken }) {
  const status = tokenStatus(token);
  return (
    <StatusTag
      tone={status === 'revoked' ? 'danger' : status === 'expired' ? 'warning' : 'success'}
    >
      {labelFor(JOB_STATUS_LABELS, status)}
    </StatusTag>
  );
}

function TokenExpiry({ token }: { token: PersonalToken }) {
  if (isNoExpiryToken(token)) return <span>never expires</span>;
  const expired = new Date(token.expires_at) < new Date();
  return (
    <span title={fullDate(token.expires_at)}>
      {expired
        ? `expired ${lowerRelative(timeAgo(token.expires_at))}`
        : `expires ${timeUntil(token.expires_at)}`}
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
      <Modal.Backdrop isDismissable={false}>
        <Modal.Container size="md" placement="center">
          <Modal.Dialog className="overflow-hidden">
            <Modal.Header>
              <div className="flex min-w-0 items-center gap-3">
                <Modal.Icon className="bg-primary/10 text-primary">
                  <Key01Icon size={18} />
                </Modal.Icon>
                <Modal.Heading className="font-semibold text-foreground">
                  Token created
                </Modal.Heading>
              </div>
              <Modal.CloseTrigger className="text-muted-foreground hover:text-foreground" />
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
              <div className="break-all rounded-xl bg-muted p-3 font-mono text-xs">{rawToken}</div>
              <Button
                type="button"
                onPress={handleCopy}
                className="btn-primary w-full flex items-center justify-center gap-2"
                variant="primary"
              >
                <Copy01Icon size={15} />
                {copied ? 'Copied' : 'Copy token'}
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
      <Modal.Backdrop isDismissable={false}>
        <Modal.Container size="md" placement="center">
          <Modal.Dialog className="overflow-hidden">
            <Modal.Header>
              <div className="flex min-w-0 items-center gap-3">
                <Modal.Icon className="bg-default text-foreground">
                  <Settings01Icon size={18} />
                </Modal.Icon>
                <Modal.Heading className="font-semibold">New API token</Modal.Heading>
              </div>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body>
              <form id="create-token-form" onSubmit={handleSubmit} className="space-y-4">
                {error ? (
                  <FormAlert title="Token could not be created" description={error} />
                ) : null}
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
                  <Label className="text-sm font-medium text-foreground">Expiration</Label>
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
            <Modal.Footer>
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
                isPending={saving}
                className="btn-primary inline-flex items-center gap-2"
                variant="primary"
              >
                Create token
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
  const [loadError, setLoadError] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [rawToken, setRawToken] = useState('');
  const createModal = useOverlayState();
  const revealModal = useOverlayState();
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  async function load() {
    setLoading(true);
    setLoadError('');
    try {
      const res = await listUserTokens();
      setTokens(res.data ?? []);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load tokens');
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
    if (revokingId) return;
    setRevokingId(token.id);
    try {
      await revokeUserToken(token.id);
      toast.success('Token revoked');
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke token');
    } finally {
      setRevokingId(null);
    }
  }

  const now = new Date();
  const activeTokens = tokens.filter((token) => tokenStatus(token, now) === 'active');
  const statusRank = { active: 0, expired: 1, revoked: 2 } as const;
  const sortedTokens = [...tokens].sort(
    (a, b) =>
      statusRank[tokenStatus(a, now)] - statusRank[tokenStatus(b, now)] ||
      Date.parse(b.created_at) - Date.parse(a.created_at)
  );
  const revokedTokens = tokens.filter((token) => token.disabled).length;
  const expiringSoon = tokens.filter((token) => {
    if (token.disabled) return false;
    const expiresAt = new Date(token.expires_at);
    const isNoExpiry = expiresAt.getFullYear() - now.getFullYear() >= 4;
    if (isNoExpiry || expiresAt < now) return false;
    return expiresAt.getTime() - now.getTime() <= 30 * 24 * 60 * 60 * 1000;
  }).length;

  return (
    <div className="space-y-4">
      {confirmDialog}

      {loading ? (
        <TokensLoadingState />
      ) : loadError ? (
        <StatusAlert
          status="danger"
          title="Tokens could not be loaded"
          description={loadError}
          action={
            <Button size="sm" variant="secondary" isPending={loading} onPress={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : (
        <>
          <Card>
            <Card.Header className="flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <Card.Title>Tokens</Card.Title>
                <Card.Description>
                  Personal API tokens and JustScan CLI sessions. Revoke a CLI session here if a
                  device is lost. For shared CI/CD pipelines, prefer organization tokens.
                </Card.Description>
                {tokens.length > 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {[
                      `${activeTokens.length.toLocaleString()} active`,
                      expiringSoon > 0
                        ? `${expiringSoon.toLocaleString()} expiring within 30 days`
                        : null,
                      revokedTokens > 0 ? `${revokedTokens.toLocaleString()} revoked` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                ) : null}
              </div>
              <Button variant="secondary" onPress={() => createModal.open()}>
                <PlusSignIcon size={14} />
                New token
              </Button>
            </Card.Header>
            <Card.Content>
              {tokens.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <Key01Icon size={24} className="text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    You have no personal tokens or CLI sessions yet.
                  </p>
                </div>
              ) : (
                <ResourceList aria-label="Personal API tokens">
                  {sortedTokens.map((token) => (
                    <ResourceList.Item
                      key={token.id}
                      media={<Key01Icon size={16} className="text-muted-foreground" />}
                      title={token.description}
                      description={
                        <>
                          {token.type === 'cli_session' ? 'CLI session' : 'Personal token'}
                          {' · '}
                          <span title={fullDate(token.created_at)}>
                            created {lowerRelative(timeAgo(token.created_at))}
                          </span>
                          {!token.disabled ? (
                            <>
                              {' · '}
                              <TokenExpiry token={token} />
                            </>
                          ) : null}
                        </>
                      }
                      meta={<TokenStatusBadge token={token} />}
                      actions={
                        !token.disabled ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            aria-label={`Revoke ${token.description}`}
                            onPress={() => void handleRevoke(token)}
                            isPending={revokingId === token.id}
                            isDisabled={revokingId !== null}
                          >
                            <Delete01Icon size={15} />
                            Revoke
                          </Button>
                        ) : null
                      }
                    />
                  ))}
                </ResourceList>
              )}
            </Card.Content>
          </Card>

          <Card>
            <Card.Header>
              <Card.Title>Using personal tokens</Card.Title>
              <Card.Description>
                Set the token as a bearer credential in the Authorization header. For shared
                pipeline automation, create an organization token instead and call the org-scoped
                pipeline scan endpoint.
              </Card.Description>
            </Card.Header>
            <Card.Content className="space-y-3">
              <StatusAlert
                status="warning"
                description="A new token is shown only once. Copy it straight into a secret manager before closing the dialog."
              />
              <pre className="overflow-x-auto rounded-xl bg-muted p-4 font-mono text-xs">
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
