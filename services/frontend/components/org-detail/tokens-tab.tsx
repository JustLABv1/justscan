'use client';
import { StatusTag } from '@/components/ui/status-dot';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { JOB_STATUS_LABELS, labelFor } from '@/lib/labels';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { FormField } from '@/components/ui/form-field';
import {
  APIToken,
  createOrgToken,
  deleteRevokedOrgToken,
  listOrgTokens,
  OrgTokenScope,
  revokeOrgToken,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo, timeUntil } from '@/lib/time';
import {
  Alert,
  Button,
  Card,
  Label,
  Modal,
  ResourceList,
  SearchField,
  Spinner,
  useOverlayState,
} from '@/components/ui';
import {
  Cancel01Icon,
  Copy01Icon,
  Delete01Icon,
  Key01Icon,
  PlusSignIcon,
  Settings01Icon,
} from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const EXPIRY_OPTIONS = [
  { label: '30 days', value: 30 * 24 * 60 * 60 },
  { label: '90 days', value: 90 * 24 * 60 * 60 },
  { label: '180 days', value: 180 * 24 * 60 * 60 },
  { label: '1 year', value: 365 * 24 * 60 * 60 },
  { label: '5 years', value: 5 * 365 * 24 * 60 * 60 },
];

function getTokenStatus(token: APIToken): 'active' | 'expired' | 'revoked' {
  if (token.disabled) {
    return 'revoked';
  }

  const now = new Date();
  const expiresAt = new Date(token.expires_at);
  if (expiresAt < now) {
    return 'expired';
  }

  return 'active';
}

function OrgTokenStatusBadge({ token }: { token: APIToken }) {
  const status = getTokenStatus(token);
  return (
    <StatusTag
      tone={status === 'revoked' ? 'danger' : status === 'expired' ? 'warning' : 'success'}
    >
      {labelFor(JOB_STATUS_LABELS, status)}
    </StatusTag>
  );
}

function OrgTokenExpiry({ token }: { token: APIToken }) {
  const expiresAt = new Date(token.expires_at);
  const now = new Date();
  return (
    <span title={fullDate(token.expires_at)}>
      {expiresAt < now
        ? `expired ${timeAgo(token.expires_at).toLowerCase()}`
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
                <Modal.Heading className="font-semibold">Token created</Modal.Heading>
              </div>
              <Modal.CloseTrigger />
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
              <div className="rounded-xl p-3 font-mono text-xs break-all bg-surface-secondary">
                {rawToken}
              </div>
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

interface CreateOrgTokenDialogProps {
  state: ReturnType<typeof useOverlayState>;
  orgId: string;
  onCreated: (rawToken: string) => void;
}

function CreateOrgTokenDialog({ state, orgId, onCreated }: CreateOrgTokenDialogProps) {
  const [form, setForm] = useState<{
    description: string;
    expiresIn: number;
    scope: OrgTokenScope;
  }>({
    description: '',
    expiresIn: EXPIRY_OPTIONS[1].value,
    scope: 'org_admin',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const result = await createOrgToken(orgId, form.description, form.expiresIn, form.scope);
      setForm({
        description: '',
        expiresIn: EXPIRY_OPTIONS[1].value,
        scope: 'org_admin',
      });
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
                <Modal.Heading className="font-semibold">New organization token</Modal.Heading>
              </div>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body>
              <form id="create-org-token-form" onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <Alert status="danger">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>{error}</Alert.Title>
                    </Alert.Content>
                  </Alert>
                )}
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium text-foreground">Scope</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ['org_admin', 'Org admin', 'Full organization API access'],
                        ['pipeline_scan', 'Pipeline scan', 'Create and read pipeline scans only'],
                      ] as const
                    ).map(([value, label, description]) => (
                      <Button
                        key={value}
                        type="button"
                        onPress={() => setForm((current) => ({ ...current, scope: value }))}
                        variant={form.scope === value ? 'primary' : 'outline'}
                        className="h-auto items-start justify-start text-left"
                      >
                        <span className="flex flex-col items-start gap-1 whitespace-normal">
                          <span className="text-sm font-medium">{label}</span>
                          <span className="text-xs opacity-75">{description}</span>
                        </span>
                      </Button>
                    ))}
                  </div>
                </div>
                <FormField
                  label="Token name"
                  placeholder="e.g. GitLab CI/CD pipeline"
                  value={form.description}
                  onChange={(e) =>
                    setForm((current) => ({ ...current, description: e.target.value }))
                  }
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
                        type="button"
                        onPress={() => setForm((current) => ({ ...current, expiresIn: opt.value }))}
                        variant={form.expiresIn === opt.value ? 'primary' : 'outline'}
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </form>
            </Modal.Body>
            <Modal.Footer className="flex justify-end gap-2 border-t border-border px-6 py-4">
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
                form="create-org-token-form"
                isDisabled={saving}
                className="btn-primary inline-flex items-center gap-2"
                variant="primary"
              >
                {saving && (
                  <div className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                Create token
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

interface OrgTokensTabProps {
  orgId: string;
  canManage: boolean;
  featureDisabledReason?: string;
}

export function OrgTokensTab({ orgId, canManage, featureDisabledReason }: OrgTokensTabProps) {
  const [tokens, setTokens] = useState<APIToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [rawToken, setRawToken] = useState('');
  const [query, setQuery] = useState('');
  const createModal = useOverlayState();
  const revealModal = useOverlayState();
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const filteredTokens = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return tokens;
    }

    return tokens.filter((token) => {
      const status = getTokenStatus(token);
      return [token.description, status, timeAgo(token.created_at)].some((value) =>
        value.toLowerCase().includes(normalized)
      );
    });
  }, [query, tokens]);

  // Active tokens first, newest first within each group.
  const sortedTokens = useMemo(() => {
    const rank = { active: 0, expired: 1, revoked: 2 } as const;
    return [...filteredTokens].sort(
      (a, b) =>
        rank[getTokenStatus(a)] - rank[getTokenStatus(b)] ||
        Date.parse(b.created_at) - Date.parse(a.created_at)
    );
  }, [filteredTokens]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listOrgTokens(orgId);
      setTokens(data);
    } catch {
      setTokens([]);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => deferEffect(load), [load]);

  function handleCreated(key: string) {
    setRawToken(key);
    revealModal.open();
    void load();
  }

  async function handleRevoke(token: APIToken) {
    const ok = await confirm({
      title: `Revoke "${token.description}"?`,
      message: 'Any pipelines or scripts using this token will lose access immediately.',
      confirmLabel: 'Revoke',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await revokeOrgToken(orgId, token.id);
      toast.success('Token revoked');
      void load();
    } catch {
      toast.error('Failed to revoke token');
    }
  }

  async function handleDelete(token: APIToken) {
    const ok = await confirm({
      title: `Delete "${token.description}" permanently?`,
      message: 'This removes the revoked token record and its audit reference cannot be restored.',
      confirmLabel: 'Delete permanently',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteRevokedOrgToken(orgId, token.id);
      toast.success('Revoked token deleted');
      void load();
    } catch {
      toast.error('Failed to delete revoked token');
    }
  }

  return (
    <Card>
      {confirmDialog}

      <Card.Header className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <Card.Title>CLI and API tokens</Card.Title>
          <Card.Description>
            Service tokens for this organization, used by the JustScan CLI, CI/CD pipelines, and
            other automated scanning.
          </Card.Description>
          {featureDisabledReason ? (
            <p className="mt-1 text-xs text-warning-foreground">{featureDisabledReason}</p>
          ) : null}
        </div>
        {canManage ? (
          <Button onClick={() => createModal.open()} isDisabled={Boolean(featureDisabledReason)}>
            <PlusSignIcon size={14} />
            New token
          </Button>
        ) : null}
      </Card.Header>

      <Card.Content className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-8" role="status">
            <Spinner />
            <span className="sr-only">Loading tokens</span>
          </div>
        ) : tokens.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <Key01Icon size={24} className="text-muted-foreground" />
            <div>
              <p className="font-medium text-foreground">No organization tokens yet</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Create a token to authenticate CI/CD pipelines and automated tools for this
                organization.
              </p>
            </div>
            {canManage ? (
              <Button
                variant="secondary"
                onClick={() => createModal.open()}
                isDisabled={Boolean(featureDisabledReason)}
              >
                Create first token
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            {tokens.length > 6 || query ? (
              <SearchField name="org-token-search" variant="secondary">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input
                    aria-label="Filter tokens"
                    placeholder="Filter by token name or status..."
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
            ) : null}

            {sortedTokens.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No tokens match this filter.
              </p>
            ) : (
              <ResourceList aria-label="Organization API tokens">
                {sortedTokens.map((token) => {
                  const status = getTokenStatus(token);
                  return (
                    <ResourceList.Item
                      key={token.id}
                      media={<Key01Icon size={16} className="text-muted-foreground" />}
                      title={token.description}
                      description={
                        <>
                          {token.scope === 'pipeline_scan'
                            ? 'Pipeline scans'
                            : 'Organization admin'}
                          {' · '}
                          <span title={fullDate(token.created_at)}>
                            created {timeAgo(token.created_at).toLowerCase()}
                          </span>
                          {status === 'active' ? (
                            <>
                              {' · '}
                              <OrgTokenExpiry token={token} />
                            </>
                          ) : null}
                        </>
                      }
                      meta={<OrgTokenStatusBadge token={token} />}
                      actions={
                        canManage ? (
                          !token.disabled ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onPress={() => void handleRevoke(token)}
                            >
                              <Cancel01Icon size={15} />
                              Revoke
                            </Button>
                          ) : (
                            <RowActionsMenu
                              label={`Actions for ${token.description}`}
                              items={[
                                {
                                  id: 'delete',
                                  label: 'Delete permanently',
                                  icon: <Delete01Icon size={15} />,
                                  variant: 'danger',
                                  onAction: () => void handleDelete(token),
                                },
                              ]}
                            />
                          )
                        ) : null
                      }
                    />
                  );
                })}
              </ResourceList>
            )}
          </>
        )}
      </Card.Content>

      {canManage && !featureDisabledReason && (
        <CreateOrgTokenDialog state={createModal} orgId={orgId} onCreated={handleCreated} />
      )}
      <TokenRevealDialog state={revealModal} rawToken={rawToken} />
    </Card>
  );
}
