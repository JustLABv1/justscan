'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { NotificationManager } from '@/components/notifications/notification-manager';
import { OrgAutomationTab } from '@/components/org-detail/automation-tab';
import { OrgCICDTab } from '@/components/org-detail/ci-cd-tab';
import { OrgOverviewTab } from '@/components/org-detail/overview-tab';
import { OrgScansTab } from '@/components/org-detail/scans-tab';
import { OrgScanItem, StatusBadge } from '@/components/org-detail/shared';
import { OrgTeamTab } from '@/components/org-detail/team-tab';
import { OrgTokensTab } from '@/components/org-detail/tokens-tab';
import { useToast } from '@/components/toast';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { heroSelectTriggerClassName, nativeFieldClassName } from '@/components/ui/form-styles';
import { PageHeader } from '@/components/ui/page-header';
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
  transferOrgOwnership,
  TrendPoint,
  updateOrg,
  updateOrgMemberRole,
  updateOrgVulnerabilityViewSettings,
  updatePolicy,
  VulnerabilityViewSettings,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { canManageOrg, canMutateOrg, canOwnOrg } from '@/lib/org-permissions';
import { timeAgo } from '@/lib/time';
import {
  Button,
  Card,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Switch,
  Tabs,
  useOverlayState,
} from '@heroui/react';
import { ArrowLeft01Icon, Delete01Icon, PlusSignIcon } from 'hugeicons-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

const inputCls = nativeFieldClassName;
const selectTriggerCls = heroSelectTriggerClassName;

const RULE_TYPE_LABELS: Record<string, string> = {
  max_cvss: 'Max CVSS Score',
  max_count: 'Max Count by Severity',
  max_total: 'Max Total',
  require_fix: 'Require Fix',
  blocked_cve: 'Blocked CVE',
  xray_policy_block: 'Block Xray Policy Matches',
};

const SEV_OPTIONS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

const DEFAULT_VULNERABILITY_VIEW_SETTINGS: VulnerabilityViewSettings = {
  sort_by: 'severity',
  sort_dir: 'asc',
  severity: '',
  min_cvss: 0,
  has_fix: false,
  xray_policy_first: false,
  policy_failed_only: false,
};

function emptyRule(): PolicyRule {
  return { type: 'max_cvss', value: 7 };
}

const ORG_TABS = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Review this organization’s risk posture and recent compliance failures.',
  },
  {
    id: 'scans',
    label: 'Scans',
    description: 'Manage assigned images, automatic routing, and vulnerability view defaults.',
  },
  {
    id: 'policies',
    label: 'Policies',
    description: 'Define the compliance rules evaluated against organization scans.',
  },
  {
    id: 'members',
    label: 'Members',
    description: 'Manage member roles, ownership, and pending invitations.',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Configure organization channels, rules, retries, and delivery history.',
  },
  {
    id: 'ci-cd',
    label: 'CI/CD',
    description: 'Connect pipelines, generate least-privilege credentials, and verify automated scans.',
  },
  {
    id: 'access',
    label: 'Access',
    description: 'Manage API tokens used by pipelines and automated tools.',
  },
] as const;

type OrgTabId = (typeof ORG_TABS)[number]['id'];

const LEGACY_ORG_TABS: Record<string, OrgTabId> = {
  automation: 'policies',
  team: 'members',
  tokens: 'access',
};

export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentUser = getUser() as { role?: string } | null;
  const isSystemAdmin = currentUser?.role === 'admin';

  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [riskScore, setRiskScore] = useState<OrgRiskScore | null>(null);
  const [activeTab, setActiveTab] = useState<OrgTabId>('overview');
  const [newPattern, setNewPattern] = useState('');
  const [vulnerabilityViewSettings, setVulnerabilityViewSettings] =
    useState<VulnerabilityViewSettings>(DEFAULT_VULNERABILITY_VIEW_SETTINGS);
  const [vulnerabilityViewSaving, setVulnerabilityViewSaving] = useState(false);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] =
    useState<Extract<OrgRole, 'admin' | 'editor' | 'viewer'>>('viewer');
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const inviteModal = useOverlayState();

  const [orgScans, setOrgScans] = useState<OrgScanItem[]>([]);

  const [editingPolicy, setEditingPolicy] = useState<OrgPolicy | null>(null);
  const [policyName, setPolicyName] = useState('');
  const [policyRules, setPolicyRules] = useState<PolicyRule[]>([emptyRule()]);
  const [policyIncludeSuppressed, setPolicyIncludeSuppressed] = useState(true);
  const [policyError, setPolicyError] = useState('');
  const [policySaving, setPolicySaving] = useState(false);
  const policyModal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();

  const [allScans, setAllScans] = useState<Scan[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);
  const assignModal = useOverlayState();
  const currentOrgRole = org?.current_user_role;
  const canManageMembers = isSystemAdmin || canManageOrg(currentOrgRole);
  const canEditRoles = isSystemAdmin || canOwnOrg(currentOrgRole);
  const canManageOrgSettings = canManageMembers;
  const canMutateOrgScans = isSystemAdmin || canMutateOrg(currentOrgRole);

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
    } catch {
      /* ignore */
    }
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

  const orgVulnerabilityViewSettings =
    org?.vulnerability_view_settings ?? DEFAULT_VULNERABILITY_VIEW_SETTINGS;

  useEffect(() => {
    return deferEffect(() => {
      void load();
      void loadOrgScans();
      void loadMembers();
      void getComplianceTrend(id)
        .then(setTrend)
        .catch(() => {});
      void getOrgRiskScore(id)
        .then(setRiskScore)
        .catch(() => {});
    });
  }, [load, loadMembers, loadOrgScans, id]);

  useEffect(() => {
    return deferEffect(() => {
      setVulnerabilityViewSettings(orgVulnerabilityViewSettings);
    });
  }, [orgVulnerabilityViewSettings]);

  useEffect(() => {
    return deferEffect(() => {
      const requestedTab = searchParams.get('tab');
      const normalizedTab = requestedTab ? LEGACY_ORG_TABS[requestedTab] || requestedTab : null;
      const match = ORG_TABS.find((tab) => tab.id === normalizedTab);
      if (match && match.id !== activeTab) {
        setActiveTab(match.id);
        return;
      }
      if (!requestedTab && activeTab !== 'overview') {
        setActiveTab('overview');
      }
    });
  }, [activeTab, searchParams]);

  function openInviteModal() {
    if (!canManageMembers) return;
    if (!org?.is_active) {
      toast.error('Organization is suspended. Member invites are disabled.');
      return;
    }
    if (!org?.allow_member_invites) {
      toast.error('Member invites are disabled for this organization.');
      return;
    }
    setInviteEmail('');
    setInviteRole('viewer');
    setInviteError('');
    inviteModal.open();
  }

  async function handleCreateInvite(e: React.FormEvent) {
    if (!canManageMembers) return;
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

  async function handleMemberRoleChange(
    member: OrgMember,
    nextRole: Extract<OrgRole, 'admin' | 'editor' | 'viewer'>
  ) {
    if (!canEditRoles) return;
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
    if (!canManageMembers) return;
    const ok = await confirm({
      title: `Remove ${member.username || member.email || 'member'}?`,
      message: 'This user will lose access to this organization immediately.',
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    await removeOrgMember(id, member.user_id).catch(() => {});
    toast.success('Member removed');
    await loadMembers();
  }

  async function handleTransferOwnership(member: OrgMember) {
    if (!canEditRoles) return;
    const label = member.username || member.email || 'this member';
    const ok = await confirm({
      title: `Transfer ownership to ${label}?`,
      message:
        'The selected member will become the organization owner and the current owner will be demoted to admin.',
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
    if (!canManageMembers) return;
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
    if (!canManageOrgSettings) return;
    setEditingPolicy(null);
    setPolicyName('');
    setPolicyRules([emptyRule()]);
    setPolicyIncludeSuppressed(true);
    setPolicyError('');
    policyModal.open();
  }

  function openEditPolicy(policy: OrgPolicy) {
    if (!canManageOrgSettings) return;
    setEditingPolicy(policy);
    setPolicyName(policy.name);
    setPolicyRules(policy.rules.length > 0 ? policy.rules : [emptyRule()]);
    setPolicyIncludeSuppressed(policy.include_suppressed ?? true);
    setPolicyError('');
    policyModal.open();
  }

  async function handleSavePolicy(e: React.FormEvent) {
    if (!canManageOrgSettings) return;
    e.preventDefault();
    setPolicyError('');
    setPolicySaving(true);
    try {
      if (editingPolicy) {
        await updatePolicy(id, editingPolicy.id, policyName, policyRules, policyIncludeSuppressed);
        toast.success('Policy updated');
      } else {
        await createPolicy(id, policyName, policyRules, policyIncludeSuppressed);
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
    if (!canManageOrgSettings) return;
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
    if (!canManageOrgSettings) return;
    setPolicyRules((prev) => [...prev, emptyRule()]);
  }

  function removeRule(idx: number) {
    if (!canManageOrgSettings) return;
    setPolicyRules((prev) => prev.filter((_, i) => i !== idx));
  }

  async function openAssignModal() {
    if (!canMutateOrgScans) return;
    setAssignLoading(true);
    assignModal.open();
    try {
      const res = await listScans(1, 50);
      const assignedIds = new Set(orgScans.map((s) => s.id));
      setAllScans((res.data ?? []).filter((s) => !assignedIds.has(s.id)));
    } catch {
      /* ignore */
    } finally {
      setAssignLoading(false);
    }
  }

  async function handleAssign(scanId: string) {
    if (!canMutateOrgScans) return;
    await assignScanToOrg(id, scanId).catch(() => {});
    toast.success('Scan assigned to organization');
    assignModal.close();
    await loadOrgScans();
  }

  async function handleRemoveScan(scanId: string) {
    if (!canMutateOrgScans) return;
    const ok = await confirm({
      title: 'Remove scan from organization?',
      message:
        'The scan will remain in the system but will no longer be part of this organization.',
      confirmLabel: 'Remove',
      variant: 'warning',
    });
    if (!ok) return;
    await removeScanFromOrg(id, scanId).catch(() => {});
    toast.success('Scan removed from organization');
    loadOrgScans();
  }

  async function addPattern() {
    if (!canManageOrgSettings) return;
    if (!newPattern.trim() || !org) return;
    const patterns = [...(org.image_patterns ?? []), newPattern.trim()];
    const updated = await updateOrg(id, { image_patterns: patterns }).catch(() => null);
    if (updated) {
      setOrg(updated);
      setNewPattern('');
    }
  }

  async function removePattern(p: string) {
    if (!canManageOrgSettings) return;
    if (!org) return;
    const patterns = (org.image_patterns ?? []).filter((x) => x !== p);
    const updated = await updateOrg(id, { image_patterns: patterns }).catch(() => null);
    if (updated) setOrg(updated);
  }

  async function saveVulnerabilityViewSettings() {
    if (!org || !canManageOrgSettings) return;
    setVulnerabilityViewSaving(true);
    try {
      const result = await updateOrgVulnerabilityViewSettings(id, vulnerabilityViewSettings);
      setVulnerabilityViewSettings(result.settings);
      setOrg((prev) => (prev ? { ...prev, vulnerability_view_settings: result.settings } : prev));
      toast.success('Vulnerability view defaults saved');
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save vulnerability view defaults'
      );
    } finally {
      setVulnerabilityViewSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="size-7 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-accent-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.18)',
            color: '#f87171',
          }}
        >
          {error}
        </div>
      </div>
    );
  }

  if (!org) return null;

  function handleTabChange(nextTab: OrgTabId) {
    setActiveTab(nextTab);
    const params = new URLSearchParams(searchParams.toString());
    if (nextTab === 'overview') {
      params.delete('tab');
    } else {
      params.set('tab', nextTab);
    }
    const query = params.toString();
    router.replace(query ? `/orgs/${id}?${query}` : `/orgs/${id}`, { scroll: false });
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={org.name}
        description={
          org.description || 'Manage organization risk, policies, members, and assigned assets.'
        }
        actions={
          <Button onClick={() => router.back()} variant="secondary">
            <ArrowLeft01Icon size={15} />
            Back to organizations
          </Button>
        }
      />

      <div className="space-y-3">
        <Tabs
          className="w-full"
          selectedKey={activeTab}
          onSelectionChange={(key) => handleTabChange(String(key) as OrgTabId)}
        >
          <Tabs.ListContainer className="overflow-x-auto">
            <Tabs.List
              aria-label="Organization sections"
              className="w-full min-w-max *:px-4 *:py-2.5 *:text-sm *:font-medium"
            >
              {ORG_TABS.map((tab) => (
                <Tabs.Tab key={tab.id} id={tab.id}>
                  {tab.label}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
          {ORG_TABS.map((tab) => (
            <Tabs.Panel key={tab.id} className="hidden" id={tab.id}>
              <span className="sr-only">{tab.label}</span>
            </Tabs.Panel>
          ))}
        </Tabs>

        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {ORG_TABS.find((tab) => tab.id === activeTab)?.label}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {ORG_TABS.find((tab) => tab.id === activeTab)?.description}
          </p>
        </div>
      </div>

      <div>
        {activeTab === 'overview' && (
          <OrgOverviewTab riskScore={riskScore} trend={trend} orgScans={orgScans} />
        )}
        {activeTab === 'policies' && (
          <OrgAutomationTab
            section="policies"
            org={org}
            inputClassName={inputCls}
            canManageOrgSettings={canManageOrgSettings}
            newPattern={newPattern}
            vulnerabilityViewSettings={vulnerabilityViewSettings}
            vulnerabilityViewSaving={vulnerabilityViewSaving}
            onPatternChange={setNewPattern}
            onAddPattern={() => void addPattern()}
            onRemovePattern={(pattern) => void removePattern(pattern)}
            onVulnerabilityViewSettingsChange={setVulnerabilityViewSettings}
            onSaveVulnerabilityViewSettings={() => void saveVulnerabilityViewSettings()}
            onCreatePolicy={openCreatePolicy}
            onEditPolicy={openEditPolicy}
            onDeletePolicy={(policyId) => void handleDeletePolicy(policyId)}
          />
        )}
        {activeTab === 'members' && (
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
            featureDisabledReason={
              !org?.is_active
                ? 'Organization is suspended. Invites are disabled.'
                : !org?.allow_member_invites
                  ? 'Member invites are disabled by organization policy.'
                  : undefined
            }
          />
        )}
        {activeTab === 'notifications' && (
          <NotificationManager
            basePath={`/api/v1/orgs/${id}/notifications`}
            heading="Organization Notifications"
            description="Manage org-owned notification channels, rule conditions, queue retries, and delivery history."
          />
        )}
        {activeTab === 'scans' && (
          <div className="space-y-6">
            <OrgScansTab
              canManageScans={canMutateOrgScans}
              onOpenAssignModal={() => void openAssignModal()}
              onRemoveScan={(scanId) => void handleRemoveScan(scanId)}
              orgScans={orgScans}
            />
            <OrgAutomationTab
              section="scan-settings"
              org={org}
              inputClassName={inputCls}
              canManageOrgSettings={canManageOrgSettings}
              newPattern={newPattern}
              vulnerabilityViewSettings={vulnerabilityViewSettings}
              vulnerabilityViewSaving={vulnerabilityViewSaving}
              onPatternChange={setNewPattern}
              onAddPattern={() => void addPattern()}
              onRemovePattern={(pattern) => void removePattern(pattern)}
              onVulnerabilityViewSettingsChange={setVulnerabilityViewSettings}
              onSaveVulnerabilityViewSettings={() => void saveVulnerabilityViewSettings()}
              onCreatePolicy={openCreatePolicy}
              onEditPolicy={openEditPolicy}
              onDeletePolicy={(policyId) => void handleDeletePolicy(policyId)}
            />
          </div>
        )}
        {activeTab === 'access' && (
          <OrgTokensTab
            orgId={id}
            canManage={isSystemAdmin || canManageOrg(currentOrgRole)}
            featureDisabledReason={
              !org?.is_active
                ? 'Organization is suspended. Token creation is disabled.'
                : !org?.allow_org_tokens
                  ? 'Organization tokens are disabled by organization policy.'
                  : undefined
            }
          />
        )}
        {activeTab === 'ci-cd' && (
          <OrgCICDTab
            org={org}
            canManageTokens={isSystemAdmin || canManageOrg(currentOrgRole)}
          />
        )}
      </div>

      {/* Policy editor modal */}
      <Modal state={policyModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="lg" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>{editingPolicy ? 'Edit Policy' : 'New Policy'}</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="py-5 max-h-[60vh] overflow-y-auto">
                <form id="policy-form" onSubmit={handleSavePolicy} className="space-y-5">
                  {policyError && (
                    <div
                      className="rounded-xl px-3 py-2.5 text-sm"
                      style={{
                        background: 'rgba(239,68,68,0.1)',
                        border: '1px solid rgba(239,68,68,0.2)',
                        color: '#f87171',
                      }}
                    >
                      {policyError}
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">
                      Policy Name <span className="text-red-400">*</span>
                    </label>
                    <Input
                      className={inputCls}
                      placeholder="e.g. No Critical CVEs"
                      value={policyName}
                      onChange={(e) => setPolicyName(e.target.value)}
                      required
                    />
                  </div>

                  <Card className="bg-surface-secondary p-3">
                    <Switch
                      isSelected={policyIncludeSuppressed}
                      onChange={setPolicyIncludeSuppressed}
                    >
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                          Count suppressed vulnerabilities in policy evaluation
                        </span>
                        <p className="text-xs text-zinc-500">
                          Turn off to ignore effectively suppressed vulnerabilities for this policy.
                        </p>
                      </Switch.Content>
                    </Switch>
                  </Card>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                        Rules
                      </label>
                      <Button type="button" onClick={addRule} size="sm" variant="secondary">
                        <PlusSignIcon size={12} />
                        Add Rule
                      </Button>
                    </div>

                    {policyRules.map((rule, idx) => (
                      <Card key={idx} className="bg-surface-secondary p-3 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <Select
                            value={rule.type}
                            onChange={(value) => {
                              const newType = value as PolicyRule['type'];
                              setPolicyRules((prev) =>
                                prev.map((r, i) => (i === idx ? { type: newType } : r))
                              );
                            }}
                            className="min-w-0 flex-1"
                          >
                            <Select.Trigger className={selectTriggerCls}>
                              <Select.Value />
                              <Select.Indicator />
                            </Select.Trigger>
                            <Select.Popover>
                              <ListBox>
                                {Object.entries(RULE_TYPE_LABELS).map(([val, label]) => (
                                  <ListBox.Item key={val} id={val}>
                                    {label}
                                  </ListBox.Item>
                                ))}
                              </ListBox>
                            </Select.Popover>
                          </Select>
                          <Button onClick={() => removeRule(idx)} variant="danger-soft" isIconOnly>
                            <Delete01Icon size={15} />
                          </Button>
                        </div>

                        {rule.type === 'max_cvss' && (
                          <div className="flex flex-col gap-1">
                            <label className="text-xs">
                              Max CVSS threshold (fail if ≥ this value)
                            </label>
                            <Input
                              type="number"
                              min={0}
                              max={10}
                              step={0.1}
                              value={rule.value ?? 7}
                              onChange={(e) =>
                                setRuleField(idx, 'value', parseFloat(e.target.value))
                              }
                              className="w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:ring-1 focus:ring-accent-500/40"
                            />
                          </div>
                        )}
                        {rule.type === 'max_count' && (
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-500">Severity</label>
                              <Select
                                value={rule.severity ?? 'CRITICAL'}
                                onChange={(value) => setRuleField(idx, 'severity', String(value))}
                              >
                                <Select.Trigger className={selectTriggerCls}>
                                  <Select.Value />
                                  <Select.Indicator />
                                </Select.Trigger>
                                <Select.Popover>
                                  <ListBox>
                                    {SEV_OPTIONS.map((s) => (
                                      <ListBox.Item key={s} id={s}>
                                        {s}
                                      </ListBox.Item>
                                    ))}
                                  </ListBox>
                                </Select.Popover>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-500">Max count</label>
                              <Input
                                type="number"
                                min={0}
                                value={rule.value ?? 0}
                                onChange={(e) =>
                                  setRuleField(idx, 'value', parseInt(e.target.value))
                                }
                                className="w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:ring-1 focus:ring-accent-500/40"
                              />
                            </div>
                          </div>
                        )}
                        {rule.type === 'max_total' && (
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-500">
                              Max total vulnerabilities
                            </label>
                            <Input
                              type="number"
                              min={0}
                              value={rule.value ?? 0}
                              onChange={(e) => setRuleField(idx, 'value', parseInt(e.target.value))}
                              className="w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:ring-1 focus:ring-accent-500/40"
                            />
                          </div>
                        )}
                        {rule.type === 'require_fix' && (
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-500">
                              Require fix for severity
                            </label>
                            <Select
                              value={rule.severity ?? 'CRITICAL'}
                              onChange={(value) => setRuleField(idx, 'severity', String(value))}
                            >
                              <Select.Trigger className={selectTriggerCls}>
                                <Select.Value />
                                <Select.Indicator />
                              </Select.Trigger>
                              <Select.Popover>
                                <ListBox>
                                  {SEV_OPTIONS.map((s) => (
                                    <ListBox.Item key={s} id={s}>
                                      {s}
                                    </ListBox.Item>
                                  ))}
                                </ListBox>
                              </Select.Popover>
                            </Select>
                          </div>
                        )}
                        {rule.type === 'blocked_cve' && (
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-500">CVE ID</label>
                            <Input
                              type="text"
                              value={rule.cve_id ?? ''}
                              onChange={(e) => setRuleField(idx, 'cve_id', e.target.value)}
                              placeholder="CVE-2024-12345"
                              className="w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:ring-1 focus:ring-accent-500/40"
                            />
                          </div>
                        )}
                        {rule.type === 'xray_policy_block' && (
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-500">Xray policy blocking</label>
                            <p className="text-xs text-zinc-500">
                              Fails when any vulnerability has an active Xray blocking policy match.
                            </p>
                          </div>
                        )}
                      </Card>
                    ))}

                    {policyRules.length === 0 && (
                      <p className="text-xs text-zinc-500 text-center py-2">
                        No rules. Add at least one rule.
                      </p>
                    )}
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer>
                <Button onClick={policyModal.close} variant="secondary">
                  Cancel
                </Button>
                <Button type="submit" form="policy-form" isDisabled={policySaving}>
                  {policySaving && (
                    <div className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  )}
                  {editingPolicy ? 'Save Changes' : 'Create Policy'}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* Assign scan modal */}
      <Modal state={assignModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="surface-modal rounded-2xl overflow-hidden">
              <Modal.Header
                className="px-6 py-4"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">
                  Assign Scan
                </Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5 max-h-[60vh] overflow-y-auto">
                {assignLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="size-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-accent-500 animate-spin" />
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
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = 'var(--row-hover)')
                        }
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <div>
                          <p className="font-mono text-sm text-zinc-700 dark:text-zinc-300 group-hover:text-accent dark:group-hover:text-accent transition-colors">
                            {scan.image_name}:{scan.image_tag}
                          </p>
                          <p className="text-xs text-zinc-500 mt-0.5">{timeAgo(scan.created_at)}</p>
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
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Invite Member</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="py-5">
                <form id="invite-member-form" onSubmit={handleCreateInvite} className="space-y-4">
                  {inviteError ? (
                    <FormAlert description={inviteError} title="Invite failed" />
                  ) : null}
                  <FormField
                    label="Email"
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="teammate@example.com"
                    required
                    type="email"
                    value={inviteEmail}
                    className="bg-surface-secondary"
                  />
                  <div className="flex flex-col gap-1">
                    <Label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                      Role
                    </Label>
                    <Select
                      value={inviteRole}
                      onChange={(value) =>
                        setInviteRole(value as Extract<OrgRole, 'admin' | 'editor' | 'viewer'>)
                      }
                    >
                      <Select.Trigger className={selectTriggerCls + ' bg-surface-secondary'}>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="viewer">Viewer</ListBox.Item>
                          <ListBox.Item id="editor">Editor</ListBox.Item>
                          <ListBox.Item id="admin">Admin</ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer>
                <Button onClick={inviteModal.close} variant="secondary">
                  Cancel
                </Button>
                <Button type="submit" form="invite-member-form" isDisabled={inviteSaving}>
                  {inviteSaving && (
                    <div className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  )}
                  Create Invite
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </div>
  );
}
