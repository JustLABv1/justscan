'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { nativeFieldClassName } from '@/components/ui/form-styles';
import { APIToken, createOrgToken, listOrgTokens, revokeOrgToken } from '@/lib/api';
import { fullDate, timeAgo, timeUntil } from '@/lib/time';
import { Modal, useOverlayState } from '@heroui/react';
import { Copy01Icon, Delete01Icon, Key01Icon, PlusSignIcon } from 'hugeicons-react';
import { useCallback, useEffect, useRef, useState } from 'react';

const EXPIRY_OPTIONS = [
  { label: '30 days', value: 30 * 24 * 60 * 60 },
  { label: '90 days', value: 90 * 24 * 60 * 60 },
  { label: '180 days', value: 180 * 24 * 60 * 60 },
  { label: '1 year', value: 365 * 24 * 60 * 60 },
  { label: 'No expiry', value: 0 },
];

function OrgTokenStatusBadge({ token }: { token: APIToken }) {
  const now = new Date();
  const expiresAt = new Date(token.expires_at);
  const isNoExpiry = expiresAt.getFullYear() - now.getFullYear() >= 4;

  if (token.disabled) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-md font-medium"
        style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
        Revoked
      </span>
    );
  }
  if (!isNoExpiry && expiresAt < now) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-md font-medium"
        style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.2)' }}>
        Expired
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-md font-medium"
      style={{ background: 'rgba(16,185,129,0.1)', color: '#34d399', border: '1px solid rgba(16,185,129,0.2)' }}>
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
      {expiresAt < now ? <>Expired {timeAgo(token.expires_at)}</> : <>Expires {timeUntil(token.expires_at)}</>}
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
          <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
            <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <Modal.Heading className="text-zinc-900 dark:text-white font-semibold flex items-center gap-2">
                <Key01Icon size={17} />
                Token Created
              </Modal.Heading>
              <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
            </Modal.Header>
            <Modal.Body className="px-6 py-5 space-y-4">
              <div className="rounded-xl px-4 py-3 text-sm"
                style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#fbbf24' }}>
                This token will not be shown again. Copy it now and store it somewhere safe.
              </div>
              <div className="rounded-xl p-3 font-mono text-xs break-all"
                style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                {rawToken}
              </div>
              <button type="button" onClick={handleCopy} className="btn-primary w-full flex items-center justify-center gap-2">
                <Copy01Icon size={15} />
                {copied ? 'Copied!' : 'Copy Token'}
              </button>
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
  const [description, setDescription] = useState('');
  const [expiresIn, setExpiresIn] = useState(EXPIRY_OPTIONS[1].value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const result = await createOrgToken(orgId, description, expiresIn);
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
        <Modal.Container size="sm" placement="center">
          <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
            <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">New Org Token</Modal.Heading>
              <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
            </Modal.Header>
            <Modal.Body className="px-6 py-5">
              <form id="create-org-token-form" onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="rounded-xl px-3 py-2.5 text-sm"
                    style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                    {error}
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                    Token name <span className="text-red-400">*</span>
                  </label>
                  <input
                    className={nativeFieldClassName}
                    placeholder="e.g. GitLab CI/CD pipeline"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    required
                    minLength={2}
                    maxLength={128}
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Expiration</label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {EXPIRY_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setExpiresIn(opt.value)}
                        className="rounded-lg px-2 py-2 text-xs font-medium transition-all"
                        style={expiresIn === opt.value
                          ? { background: 'linear-gradient(135deg, rgba(124,58,237,0.2) 0%, rgba(109,40,217,0.12) 100%)', border: '1px solid rgba(167,139,250,0.4)', color: '#a78bfa' }
                          : { background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }
                        }
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </form>
            </Modal.Body>
            <Modal.Footer className="px-6 py-4 flex justify-end gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <button type="button" onClick={() => state.close()} className="btn-secondary">Cancel</button>
              <button type="submit" form="create-org-token-form" disabled={saving} className="btn-primary inline-flex items-center gap-2">
                {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Create Token
              </button>
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
}

export function OrgTokensTab({ orgId, canManage }: OrgTokensTabProps) {
  const [tokens, setTokens] = useState<APIToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [rawToken, setRawToken] = useState('');
  const createModal = useOverlayState();
  const revealModal = useOverlayState();
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

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

  useEffect(() => { void load(); }, [load]);

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
    <div className="space-y-6">
      {confirmDialog}

      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Org API Tokens</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Service-account tokens scoped to this organization. Use them for CI/CD pipelines and automated scanning.
          </p>
        </div>
        {canManage && (
          <button type="button" onClick={() => createModal.open()} className="btn-primary shrink-0 inline-flex items-center gap-2">
            <PlusSignIcon size={14} />
            New Token
          </button>
        )}
      </div>

      <div className="glass-panel rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
          </div>
        ) : tokens.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center gap-3">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.15)' }}>
              <Key01Icon size={22} color="#a78bfa" />
            </div>
            <div>
              <p className="font-semibold text-zinc-900 dark:text-white">No org tokens yet</p>
              <p className="text-sm text-zinc-500 mt-1 max-w-xs">
                Create a token to authenticate CI/CD pipelines and automated tools for this organization.
              </p>
            </div>
            {canManage && (
              <button type="button" onClick={() => createModal.open()} className="btn-primary inline-flex items-center gap-2">
                <PlusSignIcon size={14} />
                Create first token
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Expiry</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                {canManage && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {tokens.map((token, idx) => (
                <tr
                  key={token.id}
                  style={idx < tokens.length - 1 ? { borderBottom: '1px solid var(--border-subtle)' } : undefined}
                  className="transition-colors hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30"
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-zinc-900 dark:text-white">{token.description}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-zinc-500">{timeAgo(token.created_at)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <OrgTokenExpiry token={token} />
                  </td>
                  <td className="px-4 py-3">
                    <OrgTokenStatusBadge token={token} />
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      {!token.disabled && (
                        <button
                          type="button"
                          onClick={() => void handleRevoke(token)}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Revoke token"
                        >
                          <Delete01Icon size={15} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canManage && (
        <CreateOrgTokenDialog state={createModal} orgId={orgId} onCreated={handleCreated} />
      )}
      <TokenRevealDialog state={revealModal} rawToken={rawToken} />
    </div>
  );
}
