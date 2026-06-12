'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { FormField } from '@/components/ui/form-field';
import { APIToken, createOrgToken, listOrgTokens, OrgTokenScope, revokeOrgToken } from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo, timeUntil } from '@/lib/time';
import {
  Alert,
  Button,
  Card,
  Label,
  Modal,
  SearchField,
  Table,
  useOverlayState,
  type SortDescriptor,
} from '@heroui/react';
import {
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
  { label: 'No expiry', value: 0 },
];

function getTokenStatus(token: APIToken): 'active' | 'expired' | 'revoked' {
  if (token.disabled) {
    return 'revoked';
  }

  const now = new Date();
  const expiresAt = new Date(token.expires_at);
  const isNoExpiry = expiresAt.getFullYear() - now.getFullYear() >= 4;
  if (!isNoExpiry && expiresAt < now) {
    return 'expired';
  }

  return 'active';
}

function OrgTokenStatusBadge({ token }: { token: APIToken }) {
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

function OrgTokenExpiry({ token }: { token: APIToken }) {
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
                <Modal.Heading className="font-semibold">Token Created</Modal.Heading>
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
                {copied ? 'Copied!' : 'Copy Token'}
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
      <Modal.Backdrop isDismissable>
        <Modal.Container size="md" placement="center">
          <Modal.Dialog className="overflow-hidden">
            <Modal.Header>
              <div className="flex min-w-0 items-center gap-3">
                <Modal.Icon className="bg-default text-foreground">
                  <Settings01Icon size={18} />
                </Modal.Icon>
                <Modal.Heading className="font-semibold">New Org Token</Modal.Heading>
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
                  <Label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Scope
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      ['org_admin', 'Org admin', 'Full organization API access'],
                      ['pipeline_scan', 'Pipeline scan', 'Create and read pipeline scans only'],
                    ] as const).map(([value, label, description]) => (
                      <Button
                        key={value}
                        type="button"
                        onPress={() => setForm((current) => ({ ...current, scope: value }))}
                        variant={form.scope === value ? 'primary' : 'outline'}
                        className="h-auto min-h-20 items-start justify-start p-3 text-left"
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
                  <Label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Expiration
                  </Label>
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
                form="create-org-token-form"
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
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: 'created',
    direction: 'descending',
  });
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

  const sortedTokens = useMemo(() => {
    const direction = sortDescriptor.direction === 'descending' ? -1 : 1;
    const column = String(sortDescriptor.column ?? 'created');

    return [...filteredTokens].sort((a, b) => {
      if (column === 'created') {
        return (Date.parse(a.created_at) - Date.parse(b.created_at)) * direction;
      }

      if (column === 'expiry') {
        return (Date.parse(a.expires_at) - Date.parse(b.expires_at)) * direction;
      }

      if (column === 'status') {
        return getTokenStatus(a).localeCompare(getTokenStatus(b)) * direction;
      }

      return a.description.localeCompare(b.description) * direction;
    });
  }, [filteredTokens, sortDescriptor]);

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

  return (
    <Card>
      {confirmDialog}

      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Org API Tokens</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Service-account tokens scoped to this organization. Use them for CI/CD pipelines and
            automated scanning via the org pipeline endpoint.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => createModal.open()} isDisabled={Boolean(featureDisabledReason)}>
            <PlusSignIcon size={14} />
            New Token
          </Button>
        )}
      </div>
      {featureDisabledReason && <p className="text-xs text-warning">{featureDisabledReason}</p>}

      <div className="surface-card rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="size-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-accent-500 animate-spin" />
          </div>
        ) : tokens.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center gap-3">
            <div
              className="size-12 rounded-2xl flex items-center justify-center"
              style={{
                background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 15%, transparent)',
              }}
            >
              <Key01Icon size={22} color="color-mix(in srgb, var(--accent) 78%, white)" />
            </div>
            <div>
              <p className="font-semibold text-zinc-900 dark:text-white">No org tokens yet</p>
              <p className="text-sm text-zinc-500 mt-1 max-w-xs">
                Create a token to authenticate CI/CD pipelines and automated tools for this
                organization.
              </p>
            </div>
            {canManage && (
              <Button onClick={() => createModal.open()} isDisabled={Boolean(featureDisabledReason)}>
                <PlusSignIcon size={14} />
                Create first token
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3 p-3">
            <SearchField name="org-token-search" variant="secondary">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input
                  placeholder="Filter by token name or status..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>

            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content
                  aria-label="Organization API tokens"
                  className="min-w-[760px]"
                  sortDescriptor={sortDescriptor}
                  onSortChange={setSortDescriptor}
                >
                  <Table.Header>
                    <Table.Column id="name" allowsSorting isRowHeader>
                      Name
                    </Table.Column>
                    <Table.Column id="created" allowsSorting>
                      Created
                    </Table.Column>
                    <Table.Column id="expiry" allowsSorting>
                      Expiry
                    </Table.Column>
                    <Table.Column id="status" allowsSorting>
                      Status
                    </Table.Column>
                    <Table.Column id="scope">Scope</Table.Column>
                    {canManage ? <Table.Column className="text-right">Actions</Table.Column> : null}
                  </Table.Header>
                  <Table.Body>
                    {sortedTokens.length === 0 ? (
                      <Table.Row id="empty">
                        <Table.Cell colSpan={canManage ? 6 : 5}>
                          <div className="px-4 py-8 text-center text-sm text-zinc-500">
                            No tokens match this filter.
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    ) : (
                      sortedTokens.map((token) => (
                        <Table.Row key={token.id} id={token.id}>
                          <Table.Cell>
                            <span className="font-medium text-zinc-900 dark:text-white">
                              {token.description}
                            </span>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="text-zinc-500">{timeAgo(token.created_at)}</span>
                          </Table.Cell>
                          <Table.Cell>
                            <OrgTokenExpiry token={token} />
                          </Table.Cell>
                          <Table.Cell>
                            <OrgTokenStatusBadge token={token} />
                          </Table.Cell>
                          <Table.Cell>
                            <span className="text-sm text-zinc-500">
                              {token.scope === 'pipeline_scan' ? 'Pipeline scan' : 'Org admin'}
                            </span>
                          </Table.Cell>
                          {canManage ? (
                            <Table.Cell>
                              <div className="flex justify-end">
                                {!token.disabled && (
                                  <Button
                                    variant="danger-soft"
                                    isIconOnly
                                    onClick={() => void handleRevoke(token)}
                                  >
                                    <Delete01Icon size={15} />
                                  </Button>
                                )}
                              </div>
                            </Table.Cell>
                          ) : null}
                        </Table.Row>
                      ))
                    )}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </div>
        )}
      </div>

      {canManage && !featureDisabledReason && (
        <CreateOrgTokenDialog state={createModal} orgId={orgId} onCreated={handleCreated} />
      )}
      <TokenRevealDialog state={revealModal} rawToken={rawToken} />
    </Card>
  );
}
