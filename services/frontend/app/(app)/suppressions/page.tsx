'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { OwnershipBadge, SuppressionSourceBadge } from '@/components/ui/badges';
import { FormAlert } from '@/components/ui/form-alert';
import { nativeFieldClassName } from '@/components/ui/form-styles';
import { useOrgDirectory } from '@/hooks/use-org-name-map';
import { deleteSuppressionById, getTokenType, listAllSuppressions, listSuppressionShares, ResourceShare, shareSuppression, Suppression, unshareSuppression } from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
import { ListBox, Modal, Select, useOverlayState } from '@heroui/react';
import { Delete01Icon, SecurityLockIcon, Shield01Icon } from 'hugeicons-react';
import { useCallback, useEffect, useRef, useState } from 'react';

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  accepted:       { color: '#60a5fa', background: 'rgba(59,130,246,0.1)',   border: '1px solid rgba(59,130,246,0.22)'   },
  wont_fix:       { color: '#a78bfa', background: 'rgba(124,58,237,0.1)',   border: '1px solid rgba(124,58,237,0.22)'   },
  false_positive: { color: '#34d399', background: 'rgba(16,185,129,0.1)',   border: '1px solid rgba(16,185,129,0.22)'   },
  xray_ignore:    { color: '#f59e0b', background: 'rgba(245,158,11,0.1)',   border: '1px solid rgba(245,158,11,0.22)'   },
};

const STATUS_LABEL: Record<string, string> = {
  accepted: 'Accepted Risk',
  wont_fix: "Won't Fix",
  false_positive: 'False Positive',
  xray_ignore: 'Xray Ignore',
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? {};
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={s}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

const LIMIT = 50;
const inputCls = nativeFieldClassName;

export default function SuppressionsPage() {
  const { orgs, orgNamesById } = useOrgDirectory();
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [shareTarget, setShareTarget] = useState<Suppression | null>(null);
  const [shares, setShares] = useState<ResourceShare[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareOrgId, setShareOrgId] = useState('');
  const [shareSaving, setShareSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();
  const shareModal = useOverlayState();
  const isPlatformAdmin = getTokenType() === 'admin';
  const manageableOrgIds = new Set(orgs.filter((org) => org.current_user_role === 'owner' || org.current_user_role === 'admin').map((org) => org.id));

  const load = useCallback(async (p: number, status: string, q: string) => {
    setLoading(true);
    try {
      const res = await listAllSuppressions(p, LIMIT, status || undefined, q || undefined);
      setSuppressions(res.data ?? []);
      setTotal(res.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load suppressions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(page, statusFilter, searchQuery); }, [load, page, statusFilter, searchQuery]);

    function canManageAccess(suppression: Suppression) {
      if (suppression.read_only || suppression.source === 'xray' || suppression.owner_type === 'system') return false;
      if (isPlatformAdmin) return true;
      if (suppression.owner_type === 'org' && suppression.owner_org_id) {
        return manageableOrgIds.has(suppression.owner_org_id);
      }
      return true;
    }

    async function loadShares(suppressionId: string) {
      setSharesLoading(true);
      setShareError('');
      try {
        setShares(await listSuppressionShares(suppressionId));
      } catch (err: unknown) {
        setShareError(err instanceof Error ? err.message : 'Failed to load access grants');
      } finally {
        setSharesLoading(false);
      }
    }

    function openShareModal(suppression: Suppression) {
      setShareTarget(suppression);
      setShares([]);
      setShareOrgId('');
      setShareError('');
      shareModal.open();
      void loadShares(suppression.id);
    }

    async function handleGrantShare() {
      if (!shareTarget || !shareOrgId) return;
      setShareSaving(true);
      setShareError('');
      try {
        await shareSuppression(shareTarget.id, shareOrgId);
        toast.success('Suppression access granted');
        setShareOrgId('');
        await loadShares(shareTarget.id);
      } catch (err: unknown) {
        setShareError(err instanceof Error ? err.message : 'Failed to grant access');
      } finally {
        setShareSaving(false);
      }
    }

    async function handleRevokeShare(orgId: string) {
      if (!shareTarget) return;
      setShareSaving(true);
      setShareError('');
      try {
        await unshareSuppression(shareTarget.id, orgId);
        toast.success('Suppression access revoked');
        await loadShares(shareTarget.id);
      } catch (err: unknown) {
        setShareError(err instanceof Error ? err.message : 'Failed to revoke access');
      } finally {
        setShareSaving(false);
      }
    }

  async function handleDelete(s: Suppression) {
    if (s.read_only || s.source === 'xray') return;
    const ok = await confirm({
      title: `Remove suppression for ${s.vuln_id}?`,
      message: 'The vulnerability will no longer be suppressed for this image.',
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteSuppressionById(s.id).catch(() => {});
    toast.success(`Suppression for ${s.vuln_id} removed`);
    load(page, statusFilter, searchQuery);
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const availableShareTargets = shareTarget
    ? orgs.filter((org) => (isPlatformAdmin || manageableOrgIds.has(org.id)) && org.id !== shareTarget.owner_org_id && !shares.some((share) => share.org_id === org.id))
    : [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
            <SecurityLockIcon size={22} className="text-violet-500" />
            Suppressions
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {total > 0 ? `${total} active suppression${total !== 1 ? 's' : ''}` : 'Manage vulnerability suppressions across all images'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            className="px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input w-48"
            placeholder="Search CVE ID…"
            value={searchQuery}
            onChange={e => {
              const v = e.target.value;
              setSearchQuery(v);
              if (debounceRef.current) clearTimeout(debounceRef.current);
              debounceRef.current = setTimeout(() => { setPage(1); load(1, statusFilter, v); }, 300);
            }}
          />
          <Select selectedKey={statusFilter || '__all__'} onSelectionChange={k => { const v = String(k === '__all__' ? '' : k); setStatusFilter(v); setPage(1); load(1, v, searchQuery); }}
            className="w-44"
          >
            <Select.Trigger className="px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input">
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="__all__">All Statuses</ListBox.Item>
                <ListBox.Item id="accepted">Accepted Risk</ListBox.Item>
                <ListBox.Item id="wont_fix">Won&apos;t Fix</ListBox.Item>
                <ListBox.Item id="false_positive">False Positive</ListBox.Item>
                <ListBox.Item id="xray_ignore">Xray Ignore</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
      </div>

      {error && (
        <FormAlert description={error} title="Suppressions loading failed" />
      )}

      <div className="glass-panel rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">CVE ID</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Image Digest</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Source</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Justification</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">By</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Expires</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="py-16 text-center">
                  <div className="flex justify-center">
                    <div className="w-6 h-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
                  </div>
                </td>
              </tr>
            ) : suppressions.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <SecurityLockIcon size={32} className="text-zinc-400 dark:text-zinc-600" />
                    <p className="text-sm text-zinc-500">{searchQuery || statusFilter ? 'No suppressions match your filters.' : 'No suppressions found.'}</p>
                    {!searchQuery && !statusFilter && <p className="text-xs text-zinc-400">Suppressions allow you to acknowledge known vulnerabilities in a scan.</p>}
                  </div>
                </td>
              </tr>
            ) : suppressions.map((s, i) => (
              <tr
                key={s.id}
                style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td className="px-4 py-3">
                  <a
                    href={`https://nvd.nist.gov/vuln/detail/${s.vuln_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-violet-500 dark:text-violet-400 hover:underline"
                    onClick={e => e.stopPropagation()}
                  >
                    {s.vuln_id}
                  </a>
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-zinc-500" title={s.image_digest}>
                    {s.image_digest.length > 28 ? s.image_digest.slice(0, 28) + '…' : s.image_digest}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={s.status} />
                </td>
                <td className="px-4 py-3">
                  <SuppressionSourceBadge source={s.source} />
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500 max-w-xs">
                  <span className="line-clamp-2">{s.justification || '—'}</span>
                  {(s.xray_policy_name || s.xray_watch_name) && (
                    <p className="mt-1 text-[11px] text-zinc-400">
                      {[s.xray_policy_name, s.xray_watch_name].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-1">
                    <p className="text-xs text-zinc-500">{s.username || '—'}</p>
                    <OwnershipBadge ownerType={s.owner_type} ownerOrgId={s.owner_org_id} orgNamesById={orgNamesById} />
                  </div>
                </td>
                <td className="px-4 py-3 text-xs">
                  {s.expires_at ? (
                    <span className={new Date(s.expires_at) < new Date() ? 'text-red-400' : 'text-zinc-500'} title={fullDate(s.expires_at)}>
                      {new Date(s.expires_at).toLocaleDateString()}
                    </span>
                  ) : (
                    <span className="text-zinc-400">Never</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500" title={fullDate(s.created_at)}>
                  {timeAgo(s.created_at)}
                </td>
                <td className="px-4 py-3">
                  {s.read_only || s.source === 'xray' ? (
                    <span className="text-[11px] text-zinc-400">Read only</span>
                  ) : (
                    <div className="flex items-center justify-end gap-1">
                      {canManageAccess(s) && (
                        <button
                          onClick={() => openShareModal(s)}
                          className="text-zinc-400 dark:text-zinc-600 hover:text-violet-500 dark:hover:text-violet-400 transition-colors p-1"
                          title="Manage access"
                          type="button"
                        >
                          <Shield01Icon size={15} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(s)}
                        className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors p-1"
                        title="Remove suppression"
                        type="button"
                      >
                        <Delete01Icon size={15} />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-500">{total} total</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="btn-secondary"
              type="button"
            >← Prev</button>
            <span className="text-sm text-zinc-500 px-2">{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="btn-secondary"
              type="button"
            >Next →</button>
          </div>
        </div>
      )}

      <Modal state={shareModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">Manage Suppression Access</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5 space-y-4">
                {shareError ? <FormAlert description={shareError} title="Access update failed" /> : null}
                {shareTarget ? (
                  <div className="rounded-xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{shareTarget.vuln_id}</p>
                    <p className="mt-1 font-mono text-xs text-zinc-500" title={shareTarget.image_digest}>
                      {shareTarget.image_digest.length > 48 ? `${shareTarget.image_digest.slice(0, 48)}…` : shareTarget.image_digest}
                    </p>
                    <div className="mt-2">
                      <OwnershipBadge ownerType={shareTarget.owner_type} ownerOrgId={shareTarget.owner_org_id} orgNamesById={orgNamesById} />
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Current access</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">Organizations listed here can use this suppression.</p>
                  </div>
                  {sharesLoading ? (
                    <div className="flex justify-center py-6">
                      <div className="w-5 h-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
                    </div>
                  ) : shares.length === 0 ? (
                    <p className="text-sm text-zinc-500">No organization grants yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {shares.map((share) => (
                        <div key={share.org_id} className="flex items-start justify-between gap-3 rounded-xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{share.org_name}</p>
                            <p className="text-xs text-zinc-500 mt-0.5">{share.is_owner ? 'Owner workspace' : 'Shared access'}</p>
                          </div>
                          {share.is_owner ? (
                            <span className="text-xs font-medium text-zinc-500">Locked</span>
                          ) : (
                            <button type="button" onClick={() => { void handleRevokeShare(share.org_id); }} disabled={shareSaving} className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors disabled:opacity-50">
                              <Delete01Icon size={15} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Grant access</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">Share this suppression with another organization you manage.</p>
                  </div>
                  {availableShareTargets.length === 0 ? (
                    <p className="text-sm text-zinc-500">No additional organizations are available for sharing.</p>
                  ) : (
                    <div className="flex gap-2">
                      <select className={inputCls + ' flex-1'} value={shareOrgId} onChange={(event) => setShareOrgId(event.target.value)}>
                        <option value="">Select an organization</option>
                        {availableShareTargets.map((org) => (
                          <option key={org.id} value={org.id}>{org.name}</option>
                        ))}
                      </select>
                      <button type="button" onClick={() => { void handleGrantShare(); }} disabled={!shareOrgId || shareSaving} className="btn-primary disabled:opacity-60">
                        Grant
                      </button>
                    </div>
                  )}
                </div>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button onClick={shareModal.close} className="btn-secondary" type="button">Close</button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {confirmDialog}
    </div>
  );
}
