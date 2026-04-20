'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { OwnershipBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { nativeFieldClassName } from '@/components/ui/form-styles';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrgDirectory } from '@/hooks/use-org-name-map';
import { useWorkScope } from '@/hooks/use-work-scope';
import { createTag, deleteTag, getTokenType, getUser, getWorkScope, listTags, listTagShares, ResourceShare, shareTag, Tag, unshareTag, updateTag } from '@/lib/api';
import { Modal, useOverlayState } from '@heroui/react';
import { Delete01Icon, PencilEdit01Icon, PlusSignIcon, Shield01Icon, Tag01Icon } from 'hugeicons-react';
import { useCallback, useEffect, useState } from 'react';

const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6'];
const inputCls = nativeFieldClassName;

export default function TagsPage() {
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const { orgs, orgNamesById } = useOrgDirectory();
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState<Tag | null>(null);
  const [shareTarget, setShareTarget] = useState<Tag | null>(null);
  const [shares, setShares] = useState<ResourceShare[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareOrgId, setShareOrgId] = useState('');
  const [shareSaving, setShareSaving] = useState(false);
  const modal = useOverlayState();
  const shareModal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();
  const isPlatformAdmin = getTokenType() === 'admin';
  const currentUserId = getUser()?.id as string | undefined;
  const manageableOrgIds = new Set(orgs.filter((org) => org.current_user_role === 'owner' || org.current_user_role === 'admin').map((org) => org.id));

  const load = useCallback(async () => {
    setLoading(true);
    try { setTags(await listTags()); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, scopeKey]);

  function openCreate() { setEditing(null); setName(''); setColor(COLORS[0]); setFormError(''); modal.open(); }
  function openEdit(tag: Tag) { setEditing(tag); setName(tag.name); setColor(tag.color); setFormError(''); modal.open(); }

  function canManageTag(tag: Tag) {
    if (tag.owner_type === 'system') return isPlatformAdmin;
    if (isPlatformAdmin) return true;
    if (tag.owner_type === 'org' && tag.owner_org_id) {
      return manageableOrgIds.has(tag.owner_org_id);
    }
    return !tag.owner_user_id || tag.owner_user_id === currentUserId;
  }

  async function loadShares(tagId: string) {
    setSharesLoading(true);
    setShareError('');
    try {
      setShares(await listTagShares(tagId));
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to load access grants');
    } finally {
      setSharesLoading(false);
    }
  }

  function openShareModal(tag: Tag) {
    setShareTarget(tag);
    setShares([]);
    setShareOrgId('');
    setShareError('');
    shareModal.open();
    void loadShares(tag.id);
  }

  async function handleGrantShare() {
    if (!shareTarget || !shareOrgId) return;
    setShareSaving(true);
    setShareError('');
    try {
      await shareTag(shareTarget.id, shareOrgId);
      toast.success('Tag access granted');
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
      await unshareTag(shareTarget.id, orgId);
      toast.success('Tag access revoked');
      await loadShares(shareTarget.id);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to revoke access');
    } finally {
      setShareSaving(false);
    }
  }

  const availableShareTargets = shareTarget
    ? orgs.filter((org) => (isPlatformAdmin || manageableOrgIds.has(org.id)) && org.id !== shareTarget.owner_org_id && !shares.some((share) => share.org_id === org.id))
    : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setFormError(''); setSaving(true);
    try {
      const currentScope = getWorkScope();
      if (editing) { await updateTag(editing.id, name, color); toast.success('Tag updated'); }
      else {
        await createTag(name, color, currentScope.kind === 'org' ? currentScope.orgId : undefined);
        toast.success(`Tag "${name}" created`);
      }
      modal.close(); await load();
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: 'Delete tag?',
      message: 'The tag will be removed from all scans.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteTag(id).catch(() => {});
    toast.success('Tag deleted');
    load();
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Tags</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Organize your scans with color-coded labels</p>
        </div>
        <button
          onClick={openCreate}
          className="btn-primary inline-flex items-center gap-2"
        >
          <PlusSignIcon size={15} /> New Tag
        </button>
      </div>

      {error ? <FormAlert description={error} title="Tag loading failed" /> : null}

      {loading ? (
        <div className="glass-panel rounded-2xl overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5"
              style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}>
              <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
              <Skeleton className="h-4 w-28 rounded" />
              <div className="flex-1" />
              <Skeleton className="h-4 w-16 rounded" />
              <Skeleton className="h-7 w-7 rounded-lg" />
              <Skeleton className="h-7 w-7 rounded-lg" />
            </div>
          ))}
        </div>
      ) : tags.length === 0 ? (
        <EmptyState
          icon={<Tag01Icon size={28} />}
          title="No tags yet"
          description="Create color-coded tags to group and filter your scans. Tags can be assigned to any scan."
          action={{ label: '+ New Tag', onClick: openCreate }}
        />
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          {tags.map((tag, i) => (
            <div
              key={tag.id}
              className="flex items-center gap-4 px-4 py-3.5 transition-colors"
              style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <div
                className="w-4 h-4 rounded-full shrink-0"
                style={{ background: tag.color, boxShadow: `0 0 8px ${tag.color}88`, outline: `2px solid ${tag.color}40`, outlineOffset: 2 }}
              />
              <span
                className="text-xs font-medium px-2.5 py-0.5 rounded-full shrink-0"
                style={{ background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }}
              >
                {tag.name}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate">{tag.name}</p>
                <div className="mt-1">
                  <OwnershipBadge ownerType={tag.owner_type} ownerOrgId={tag.owner_org_id} orgNamesById={orgNamesById} />
                </div>
              </div>
              <span className="font-mono text-xs text-zinc-500">{tag.color}</span>
              {canManageTag(tag) ? (
                <RowActionsMenu
                  label={`Open actions menu for tag ${tag.name}`}
                  items={[
                    { id: 'share', label: 'Manage access', icon: <Shield01Icon size={15} />, onAction: () => openShareModal(tag) },
                    { id: 'edit', label: 'Edit tag', icon: <PencilEdit01Icon size={15} />, onAction: () => openEdit(tag) },
                    { id: 'delete', label: 'Delete tag', icon: <Delete01Icon size={15} />, variant: 'danger', onAction: () => { void handleDelete(tag.id); } },
                  ]}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="sm" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">{editing ? 'Edit Tag' : 'New Tag'}</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="tag-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError ? <FormAlert description={formError} title="Tag save failed" /> : null}
                  <FormField label="Name" onChange={(e) => setName(e.target.value)} placeholder="production" required value={name} />
                  <div className="space-y-2.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Color</label>
                    <div className="flex flex-wrap gap-2">
                      {COLORS.map((c) => (
                        <button key={c} type="button" onClick={() => setColor(c)}
                          className="w-7 h-7 rounded-full transition-all"
                          style={{
                            background: c,
                            boxShadow: color === c ? `0 0 10px ${c}99` : 'none',
                            outline: color === c ? `2px solid ${c}` : `2px solid transparent`,
                            outlineOffset: 2,
                            transform: color === c ? 'scale(1.15)' : 'scale(1)',
                          }} />
                      ))}
                      <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                        className="w-7 h-7 rounded-full cursor-pointer border-0 p-0 bg-transparent" title="Custom color" />
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}88` }} />
                      <span className="text-xs font-mono text-zinc-500">{color}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium ml-1"
                        style={{ background: color + '22', color, border: `1px solid ${color}44` }}>
                        {name || 'preview'}
                      </span>
                    </div>
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button onClick={modal.close} className="btn-secondary" type="button">Cancel</button>
                <button type="submit" form="tag-form" disabled={saving}
                  className="btn-primary inline-flex items-center gap-2">
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {editing ? 'Save' : 'Create'}
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal state={shareModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">Manage Tag Access</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5 space-y-4">
                {shareError ? <FormAlert description={shareError} title="Access update failed" /> : null}
                {shareTarget ? (
                  <div className="rounded-xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                    <div className="flex items-center gap-3">
                      <span className="w-4 h-4 rounded-full shrink-0" style={{ background: shareTarget.color, boxShadow: `0 0 8px ${shareTarget.color}88` }} />
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{shareTarget.name}</p>
                    </div>
                    <div className="mt-2">
                      <OwnershipBadge ownerType={shareTarget.owner_type} ownerOrgId={shareTarget.owner_org_id} orgNamesById={orgNamesById} />
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Current access</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">Organizations listed here can apply this tag to scans they manage.</p>
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
                    <p className="text-xs text-zinc-500 mt-0.5">Share this tag with another organization you manage.</p>
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
