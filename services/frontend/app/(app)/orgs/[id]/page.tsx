'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { OrgAutomationTab } from '@/components/org-detail/automation-tab';
import { OrgOverviewTab } from '@/components/org-detail/overview-tab';
import { OrgScansTab } from '@/components/org-detail/scans-tab';
import { OrgScanItem, StatusBadge } from '@/components/org-detail/shared';
import { OrgTeamTab } from '@/components/org-detail/team-tab';
import { OrgTokensTab } from '@/components/org-detail/tokens-tab';
import { useToast } from '@/components/toast';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { heroSelectTriggerClassName, nativeFieldClassName } from '@/components/ui/form-styles';
import {
    assignScanToOrg,
    createOrgInvite,
    createPolicy,
    deletePolicy,
    getComplianceTrend,
    getOrg,
    getOrgRiskScore,
    getUser,
    listOrgInvites,
    listOrgMembers,
    listOrgScans,
    listScans,
    Org,
    OrgInvite,
    OrgMember,
    OrgPolicy,
    OrgRiskScore,
    OrgRole,
    PolicyRule,
    removeOrgMember,
    removeScanFromOrg,
    revokeOrgInvite,
    Scan,
    TrendPoint,
    transferOrgOwnership,
    updateOrg,
    updateOrgMemberRole,
    updatePolicy,
} from '@/lib/api';
import { timeAgo } from '@/lib/time';
import { ListBox, Modal, Select, useOverlayState } from '@heroui/react';
import {
    ArrowLeft01Icon,
    Delete01Icon,
    PlusSignIcon,
} from 'hugeicons-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

const inputCls = nativeFieldClassName;
const selectTriggerCls = heroSelectTriggerClassName;

const RULE_TYPE_LABELS: Record<string, string> = {
  max_cvss: 'Max CVSS Score',
  max_count: 'Max Count by Severity',
  max_total: 'Max Total',
  require_fix: 'Require Fix',
  blocked_cve: 'Blocked CVE',
};

const SEV_OPTIONS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

function emptyRule(): PolicyRule {
  return { type: 'max_cvss', value: 7 };
}

const ORG_TABS = [
  { id: 'overview', label: 'Overview', description: 'Risk and compliance' },
  { id: 'automation', label: 'Automation', description: 'Patterns and policies' },
  { id: 'team', label: 'Team', description: 'Members and invites' },
  { id: 'scans', label: 'Scans', description: 'Assigned assets' },
  { id: 'tokens', label: 'Tokens', description: 'API access tokens' },
] as const;

type OrgTabId = (typeof ORG_TABS)[number]['id'];

export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const currentUser = getUser() as { role?: string } | null;
  const isSystemAdmin = currentUser?.role === 'admin';

  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [riskScore, setRiskScore] = useState<OrgRiskScore | null>(null);
  const [activeTab, setActiveTab] = useState<OrgTabId>('overview');
  const [newPattern, setNewPattern] = useState('');
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Extract<OrgRole, 'admin' | 'editor' | 'viewer'>>('viewer');
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const inviteModal = useOverlayState();

  const [orgScans, setOrgScans] = useState<OrgScanItem[]>([]);

  const [editingPolicy, setEditingPolicy] = useState<OrgPolicy | null>(null);
  const [policyName, setPolicyName] = useState('');
  const [policyRules, setPolicyRules] = useState<PolicyRule[]>([emptyRule()]);
  const [policyError, setPolicyError] = useState('');
  const [policySaving, setPolicySaving] = useState(false);
  const policyModal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();

  const [allScans, setAllScans] = useState<Scan[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);
  const assignModal = useOverlayState();
  const currentOrgRole = org?.current_user_role;
  const canManageMembers = isSystemAdmin || currentOrgRole === 'owner' || currentOrgRole === 'admin';
  const canEditRoles = isSystemAdmin || currentOrgRole === 'owner';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getOrg(id);
      setOrg(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load organization');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadOrgScans = useCallback(async () => {
    try {
      const data = await listOrgScans(id);
      setOrgScans(data as OrgScanItem[]);
    } catch { /* ignore */ }
  }, [id]);

  const loadMembers = useCallback(async () => {
    setMembersLoading(true);
    try {
      const nextMembers = await listOrgMembers(id);
      setMembers(nextMembers);

      if (canManageMembers) {
        const nextInvites = await listOrgInvites(id);
        setInvites(nextInvites.filter((invite) => !invite.accepted_at && !invite.revoked_at));
      } else {
        setInvites([]);
      }
    } catch {
      setMembers([]);
      setInvites([]);
    } finally {
      setMembersLoading(false);
    }
  }, [canManageMembers, id]);

  useEffect(() => {
    load();
    loadOrgScans();
    loadMembers();
    getComplianceTrend(id).then(setTrend).catch(() => {});
    getOrgRiskScore(id).then(setRiskScore).catch(() => {});
  }, [load, loadMembers, loadOrgScans, id]);

  function openInviteModal() {
    setInviteEmail('');
    setInviteRole('viewer');
    setInviteError('');
    inviteModal.open();
  }

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError('');
    setInviteSaving(true);
    try {
      await createOrgInvite(id, inviteEmail, inviteRole);
      inviteModal.close();
      toast.success('Invite created');
      await loadMembers();
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setInviteSaving(false);
    }
  }

  async function handleMemberRoleChange(member: OrgMember, nextRole: Extract<OrgRole, 'admin' | 'editor' | 'viewer'>) {
    if (member.role === nextRole) return;
    try {
      await updateOrgMemberRole(id, member.user_id, nextRole);
      toast.success('Member role updated');
      await loadMembers();
      await load();
    } catch {
      toast.error('Failed to update member role');
    }
  }

  async function handleRemoveMember(member: OrgMember) {
    const ok = await confirm({
      title: `Remove ${member.username || member.email || 'member'}?`,
      message: 'This user will lose access to this organization immediately.',
      confirmLabel: 'Remove',
      variant: 'warning',
    });
    if (!ok) return;
    await removeOrgMember(id, member.user_id).catch(() => {});
    toast.success('Member removed');
    await loadMembers();
  }

  async function handleTransferOwnership(member: OrgMember) {
    const label = member.username || member.email || 'this member';
    const ok = await confirm({
      title: `Transfer ownership to ${label}?`,
      message: 'The selected member will become the organization owner and the current owner will be demoted to admin.',
      confirmLabel: 'Transfer',
      variant: 'warning',
    });
    if (!ok) return;
    try {
      await transferOrgOwnership(id, member.user_id);
      toast.success('Ownership transferred');
      await Promise.all([load(), loadMembers()]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to transfer ownership');
    }
  }

  async function handleRevokeInvite(invite: OrgInvite) {
    const ok = await confirm({
      title: `Revoke invite for ${invite.email}?`,
      message: 'The invite link will stop working immediately.',
      confirmLabel: 'Revoke',
      variant: 'warning',
    });
    if (!ok) return;
    await revokeOrgInvite(id, invite.id).catch(() => {});
    toast.success('Invite revoked');
    await loadMembers();
  }

  async function copyInviteLink(invite: OrgInvite) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    await navigator.clipboard.writeText(`${origin}/orgs/invites/${invite.token}`);
    toast.success('Invite link copied');
  }

  function openCreatePolicy() {
    setEditingPolicy(null);
    setPolicyName('');
    setPolicyRules([emptyRule()]);
    setPolicyError('');
    policyModal.open();
  }

  function openEditPolicy(policy: OrgPolicy) {
    setEditingPolicy(policy);
    setPolicyName(policy.name);
    setPolicyRules(policy.rules.length > 0 ? policy.rules : [emptyRule()]);
    setPolicyError('');
    policyModal.open();
  }

  async function handleSavePolicy(e: React.FormEvent) {
    e.preventDefault();
    setPolicyError('');
    setPolicySaving(true);
    try {
      if (editingPolicy) {
        await updatePolicy(id, editingPolicy.id, policyName, policyRules);
        toast.success('Policy updated');
      } else {
        await createPolicy(id, policyName, policyRules);
        toast.success('Policy created');
      }
      policyModal.close();
      await load();
    } catch (err: unknown) {
      setPolicyError(err instanceof Error ? err.message : 'Failed to save policy');
    } finally {
      setPolicySaving(false);
    }
  }

  async function handleDeletePolicy(policyId: string) {
    const ok = await confirm({
      title: 'Delete policy?',
      message: 'Existing compliance results for this policy will be permanently removed.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await deletePolicy(id, policyId).catch(() => {});
    toast.success('Policy deleted');
    load();
  }

  function setRuleField(idx: number, field: keyof PolicyRule, value: string | number) {
    setPolicyRules((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  function addRule() {
    setPolicyRules((prev) => [...prev, emptyRule()]);
  }

  function removeRule(idx: number) {
    setPolicyRules((prev) => prev.filter((_, i) => i !== idx));
  }

  async function openAssignModal() {
    setAssignLoading(true);
    assignModal.open();
    try {
      const res = await listScans(1, 50);
      const assignedIds = new Set(orgScans.map((s) => s.id));
      setAllScans((res.data ?? []).filter((s) => !assignedIds.has(s.id)));
    } catch { /* ignore */ } finally {
      setAssignLoading(false);
    }
  }

  async function handleAssign(scanId: string) {
    await assignScanToOrg(id, scanId).catch(() => {});
    toast.success('Scan assigned to organization');
    assignModal.close();
    await loadOrgScans();
  }

  async function handleRemoveScan(scanId: string) {
    const ok = await confirm({
      title: 'Remove scan from organization?',
      message: 'The scan will remain in the system but will no longer be part of this organization.',
      confirmLabel: 'Remove',
      variant: 'warning',
    });
    if (!ok) return;
    await removeScanFromOrg(id, scanId).catch(() => {});
    toast.success('Scan removed from organization');
    loadOrgScans();
  }

  async function addPattern() {
    if (!newPattern.trim() || !org) return;
    const patterns = [...(org.image_patterns ?? []), newPattern.trim()];
    const updated = await updateOrg(id, { image_patterns: patterns }).catch(() => null);
    if (updated) { setOrg(updated); setNewPattern(''); }
  }

  async function removePattern(p: string) {
    if (!org) return;
    const patterns = (org.image_patterns ?? []).filter(x => x !== p);
    const updated = await updateOrg(id, { image_patterns: patterns }).catch(() => null);
    if (updated) setOrg(updated);
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      </div>
    );
  }

  if (!org) return null;

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const nextIndex = event.key === 'ArrowRight'
      ? (index + 1) % ORG_TABS.length
      : (index - 1 + ORG_TABS.length) % ORG_TABS.length;
    setActiveTab(ORG_TABS[nextIndex].id);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <button
          onClick={() => router.back()}
          className="btn-secondary inline-flex items-center gap-1.5 mb-3"
        >
          <ArrowLeft01Icon size={15} />
          Back to organizations
        </button>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">{org.name}</h1>
        {org.description && <p className="text-sm text-zinc-500 mt-1">{org.description}</p>}
      </div>

      <div className="glass-panel rounded-2xl p-1.5" role="tablist" aria-label="Organization sections">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-1">
          {ORG_TABS.map((tab, index) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`${tab.id}-tab`}
                role="tab"
                aria-controls={`${tab.id}-panel`}
                aria-selected={active}
                className="rounded-xl px-4 py-3 text-left transition-all duration-150"
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                type="button"
                style={active
                  ? {
                      background: 'linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(109,40,217,0.08) 100%)',
                      boxShadow: 'inset 0 0 0 1px rgba(167,139,250,0.2), 0 2px 8px rgba(124,58,237,0.08)',
                    }
                  : { background: 'transparent' }}
              >
                <p className={`text-sm font-semibold ${active ? 'text-violet-600 dark:text-violet-200' : 'text-zinc-700 dark:text-zinc-200'}`}>{tab.label}</p>
                <p className="text-xs text-zinc-500 mt-1">{tab.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div id={`${activeTab}-panel`} role="tabpanel" aria-labelledby={`${activeTab}-tab`}>
        {activeTab === 'overview' && <OrgOverviewTab riskScore={riskScore} trend={trend} />}
        {activeTab === 'automation' && (
          <OrgAutomationTab
            org={org}
            inputClassName={inputCls}
            newPattern={newPattern}
            onPatternChange={setNewPattern}
            onAddPattern={() => void addPattern()}
            onRemovePattern={(pattern) => void removePattern(pattern)}
            onCreatePolicy={openCreatePolicy}
            onEditPolicy={openEditPolicy}
            onDeletePolicy={(policyId) => void handleDeletePolicy(policyId)}
          />
        )}
        {activeTab === 'team' && (
          <OrgTeamTab
            canEditRoles={canEditRoles}
            canManageMembers={canManageMembers}
            canTransferOwnership={canEditRoles}
            currentOrgRole={currentOrgRole}
            inputClassName={inputCls}
            invites={invites}
            isSystemAdmin={isSystemAdmin}
            members={members}
            membersLoading={membersLoading}
            onCopyInviteLink={(invite) => void copyInviteLink(invite)}
            onMemberRoleChange={(member, nextRole) => void handleMemberRoleChange(member, nextRole)}
            onOpenInviteModal={openInviteModal}
            onRemoveMember={(member) => void handleRemoveMember(member)}
            onRevokeInvite={(invite) => void handleRevokeInvite(invite)}
            onTransferOwnership={(member) => void handleTransferOwnership(member)}
          />
        )}
        {activeTab === 'scans' && (
          <OrgScansTab
            onOpenAssignModal={() => void openAssignModal()}
            onRemoveScan={(scanId) => void handleRemoveScan(scanId)}
            orgScans={orgScans}
          />
        )}
        {activeTab === 'tokens' && (
          <OrgTokensTab
            orgId={id}
            canManage={isSystemAdmin || currentOrgRole === 'owner' || currentOrgRole === 'admin'}
          />
        )}
      </div>

      {/* Policy editor modal */}
      <Modal state={policyModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="lg" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">
                  {editingPolicy ? 'Edit Policy' : 'New Policy'}
                </Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5 max-h-[60vh] overflow-y-auto">
                <form id="policy-form" onSubmit={handleSavePolicy} className="space-y-5">
                  {policyError && (
                    <div className="rounded-xl px-3 py-2.5 text-sm"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {policyError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Policy Name <span className="text-red-400">*</span></label>
                    <input
                      className={inputCls}
                      placeholder="e.g. No Critical CVEs"
                      value={policyName}
                      onChange={(e) => setPolicyName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Rules</label>
                      <button
                        type="button"
                        onClick={addRule}
                        className="flex items-center gap-1 text-xs text-violet-500 dark:text-violet-400 hover:text-violet-400 dark:hover:text-violet-300 transition-colors"
                      >
                        <PlusSignIcon size={12} />
                        Add Rule
                      </button>
                    </div>

                    {policyRules.map((rule, idx) => (
                      <div key={idx} className="rounded-xl p-3 space-y-3"
                        style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                        <div className="flex items-center justify-between gap-2">
                          <Select selectedKey={rule.type} onSelectionChange={k => {
                              const newType = k as PolicyRule['type'];
                              setPolicyRules((prev) =>
                                prev.map((r, i) => (i === idx ? { type: newType } : r))
                              );
                            }}>
                            <Select.Trigger className={selectTriggerCls}>
                              <Select.Value />
                              <Select.Indicator />
                            </Select.Trigger>
                            <Select.Popover>
                              <ListBox>
                                {Object.entries(RULE_TYPE_LABELS).map(([val, label]) => (
                                  <ListBox.Item key={val} id={val}>{label}</ListBox.Item>
                                ))}
                              </ListBox>
                            </Select.Popover>
                          </Select>
                          <button
                            type="button"
                            onClick={() => removeRule(idx)}
                            className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors shrink-0 p-1"
                          >
                            <Delete01Icon size={15} />
                          </button>
                        </div>

                        {rule.type === 'max_cvss' && (
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-500">Max CVSS threshold (fail if ≥ this value)</label>
                            <input
                              type="number"
                              min={0}
                              max={10}
                              step={0.1}
                              value={rule.value ?? 7}
                              onChange={(e) => setRuleField(idx, 'value', parseFloat(e.target.value))}
                              className={inputCls}
                            />
                          </div>
                        )}
                        {rule.type === 'max_count' && (
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-500">Severity</label>
                              <Select selectedKey={rule.severity ?? 'CRITICAL'} onSelectionChange={k => setRuleField(idx, 'severity', String(k))}>
                                <Select.Trigger className={selectTriggerCls}>
                                  <Select.Value />
                                  <Select.Indicator />
                                </Select.Trigger>
                                <Select.Popover>
                                  <ListBox>
                                    {SEV_OPTIONS.map((s) => <ListBox.Item key={s} id={s}>{s}</ListBox.Item>)}
                                  </ListBox>
                                </Select.Popover>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-500">Max count</label>
                              <input
                                type="number"
                                min={0}
                                value={rule.value ?? 0}
                                onChange={(e) => setRuleField(idx, 'value', parseInt(e.target.value))}
                                className={inputCls}
                              />
                            </div>
                          </div>
                        )}
                        {rule.type === 'max_total' && (
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-500">Max total vulnerabilities</label>
                            <input
                              type="number"
                              min={0}
                              value={rule.value ?? 0}
                              onChange={(e) => setRuleField(idx, 'value', parseInt(e.target.value))}
                              className={inputCls}
                            />
                          </div>
                        )}
                        {rule.type === 'require_fix' && (
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-500">Require fix for severity</label>
                            <Select selectedKey={rule.severity ?? 'CRITICAL'} onSelectionChange={k => setRuleField(idx, 'severity', String(k))}>
                              <Select.Trigger className={selectTriggerCls}>
                                <Select.Value />
                                <Select.Indicator />
                              </Select.Trigger>
                              <Select.Popover>
                                <ListBox>
                                  {SEV_OPTIONS.map((s) => <ListBox.Item key={s} id={s}>{s}</ListBox.Item>)}
                                </ListBox>
                              </Select.Popover>
                            </Select>
                          </div>
                        )}
                        {rule.type === 'blocked_cve' && (
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-500">CVE ID</label>
                            <input
                              type="text"
                              value={rule.cve_id ?? ''}
                              onChange={(e) => setRuleField(idx, 'cve_id', e.target.value)}
                              placeholder="CVE-2024-12345"
                              className={inputCls}
                            />
                          </div>
                        )}
                      </div>
                    ))}

                    {policyRules.length === 0 && (
                      <p className="text-xs text-zinc-500 text-center py-2">No rules. Add at least one rule.</p>
                    )}
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button
                  onClick={policyModal.close}
                  className="btn-secondary"
                  type="button"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="policy-form"
                  disabled={policySaving}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  {policySaving && (
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  )}
                  {editingPolicy ? 'Save Changes' : 'Create Policy'}
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* Assign scan modal */}
      <Modal state={assignModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">Assign Scan</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5 max-h-[60vh] overflow-y-auto">
                {assignLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="w-6 h-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
                  </div>
                ) : allScans.length === 0 ? (
                  <p className="text-sm text-zinc-500 text-center py-6">
                    No unassigned scans available.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {allScans.map((scan) => (
                      <button
                        key={scan.id}
                        onClick={() => handleAssign(scan.id)}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-colors text-left group"
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <div>
                          <p className="font-mono text-sm text-zinc-700 dark:text-zinc-300 group-hover:text-violet-500 dark:group-hover:text-violet-400 transition-colors">
                            {scan.image_name}:{scan.image_tag}
                          </p>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            {timeAgo(scan.created_at)}
                          </p>
                        </div>
                        <StatusBadge status={scan.status} />
                      </button>
                    ))}
                  </div>
                )}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal state={inviteModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">Invite Member</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="invite-member-form" onSubmit={handleCreateInvite} className="space-y-4">
                  {inviteError ? <FormAlert description={inviteError} title="Invite failed" /> : null}
                  <FormField label="Email" onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@example.com" required type="email" value={inviteEmail} />
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Role</label>
                    <select className={inputCls} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Extract<OrgRole, 'admin' | 'editor' | 'viewer'>)}>
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button onClick={inviteModal.close} className="btn-secondary" type="button">Cancel</button>
                <button type="submit" form="invite-member-form" disabled={inviteSaving} className="btn-primary inline-flex items-center gap-2">
                  {inviteSaving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  Create Invite
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </div>
  );
}
