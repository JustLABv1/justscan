'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import {
    assignScanToOrg,
    createPolicy,
    deletePolicy,
    getComplianceTrend,
    getOrg,
    getOrgRiskScore,
    listOrgScans,
    listScans,
    Org,
    OrgPolicy,
    OrgRiskScore,
    PolicyRule,
    removeScanFromOrg,
    Scan,
    TrendPoint,
    updateOrg,
    updatePolicy,
} from '@/lib/api';
import { Modal, useOverlayState } from '@heroui/react';
import {
    ArrowLeft01Icon,
    Delete01Icon,
    PencilEdit01Icon,
    PlusSignIcon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

const inputCls = 'w-full px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input';

const RULE_TYPE_LABELS: Record<string, string> = {
  max_cvss: 'Max CVSS Score',
  max_count: 'Max Count by Severity',
  max_total: 'Max Total',
  require_fix: 'Require Fix',
  blocked_cve: 'Blocked CVE',
};

const SEV_OPTIONS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

function RulePill({ rule }: { rule: PolicyRule }) {
  const base = 'inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border';
  switch (rule.type) {
    case 'max_cvss':
      return <span className={`${base} bg-red-500/10 text-red-400 border-red-500/20`}>CVSS &lt; {rule.value}</span>;
    case 'max_count':
      return <span className={`${base} bg-orange-500/10 text-orange-400 border-orange-500/20`}>{rule.value} {rule.severity}</span>;
    case 'max_total':
      return <span className={`${base} bg-yellow-500/10 text-yellow-400 border-yellow-500/20`}>Total ≤ {rule.value}</span>;
    case 'require_fix':
      return <span className={`${base} bg-blue-500/10 text-blue-400 border-blue-500/20`}>Fix req. {rule.severity}</span>;
    case 'blocked_cve':
      return <span className={`${base} bg-red-500/10 text-red-400 border-red-500/20`}>Block {rule.cve_id}</span>;
    default:
      return <span className={`${base} bg-zinc-500/10 text-zinc-400 border-zinc-500/20`}>{rule.type}</span>;
  }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string; border: string }> = {
    completed: { color: '#34d399', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.22)'  },
    failed:    { color: '#f87171', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.22)'   },
    running:   { color: '#60a5fa', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.22)'  },
    pending:   { color: '#a1a1aa', bg: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.15)' },
  };
  const s = map[status] ?? map.pending;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}>
      <span className={`w-1.5 h-1.5 rounded-full bg-current ${status === 'running' ? 'animate-pulse' : ''}`} />
      {status}
    </span>
  );
}

function emptyRule(): PolicyRule {
  return { type: 'max_cvss', value: 7 };
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) return (
    <p className="text-xs text-zinc-500 py-4 text-center">No compliance history yet.</p>
  );

  const maxVal = Math.max(...points.map(p => p.pass + p.fail), 1);
  const H = 64;

  return (
    <div className="flex items-end gap-0.5 h-16 w-full overflow-hidden">
      {points.map(p => {
        const passH = Math.round((p.pass / maxVal) * H);
        const failH = Math.round((p.fail / maxVal) * H);
        return (
          <div key={p.date} className="flex flex-col items-center gap-0 flex-1 min-w-0 group relative" title={`${p.date}: ${p.pass} pass, ${p.fail} fail`}>
            <div className="w-full flex flex-col justify-end" style={{ height: H }}>
              {failH > 0 && <div className="w-full bg-red-500/70 rounded-t-sm" style={{ height: failH }} />}
              {passH > 0 && <div className="w-full bg-emerald-500/70" style={{ height: passH }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [riskScore, setRiskScore] = useState<OrgRiskScore | null>(null);
  const [newPattern, setNewPattern] = useState('');

  type OrgScanItem = Scan & { compliance: { policy_id: string; policy_name: string; status: string }[] };
  const [orgScans, setOrgScans] = useState<OrgScanItem[]>([]);

  const [editingPolicy, setEditingPolicy] = useState<OrgPolicy | null>(null);
  const [policyName, setPolicyName] = useState('');
  const [policyRules, setPolicyRules] = useState<PolicyRule[]>([emptyRule()]);
  const [policyError, setPolicyError] = useState('');
  const [policySaving, setPolicySaving] = useState(false);
  const policyModal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const [allScans, setAllScans] = useState<Scan[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);
  const assignModal = useOverlayState();

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

  useEffect(() => {
    load();
    loadOrgScans();
    getComplianceTrend(id).then(setTrend).catch(() => {});
    getOrgRiskScore(id).then(setRiskScore).catch(() => {});
  }, [load, loadOrgScans, id]);

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
      } else {
        await createPolicy(id, policyName, policyRules);
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

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors mb-3"
        >
          <ArrowLeft01Icon size={15} />
          Back to organizations
        </button>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">{org.name}</h1>
        {org.description && <p className="text-sm text-zinc-500 mt-1">{org.description}</p>}
      </div>

      {/* Risk Score */}
      {riskScore && (() => {
        const gradeColor = riskScore.grade === 'A' ? '#34d399' : riskScore.grade === 'B' ? '#60a5fa' : riskScore.grade === 'C' ? '#fbbf24' : riskScore.grade === 'D' ? '#fb923c' : '#f87171';
        const pct = riskScore.compliance_pass + riskScore.compliance_fail > 0
          ? Math.round(riskScore.compliance_pass_rate * 100)
          : null;
        return (
          <div className="glass-panel relative rounded-2xl p-5">
            <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
              style={{ background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.2),transparent)' }} />
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white mb-4">Risk Overview</h2>
            <div className="flex items-center gap-6 flex-wrap">
              {/* Grade */}
              <div className="flex flex-col items-center justify-center w-20 h-20 rounded-2xl"
                style={{ background: gradeColor + '18', border: `1px solid ${gradeColor}30` }}>
                <span className="text-4xl font-black" style={{ color: gradeColor }}>{riskScore.grade}</span>
                <span className="text-xs text-zinc-500 mt-0.5">grade</span>
              </div>
              {/* Severity counts */}
              <div className="flex gap-4 flex-wrap">
                {([['CRITICAL', riskScore.totals.critical, '#f87171'], ['HIGH', riskScore.totals.high, '#fb923c'], ['MEDIUM', riskScore.totals.medium, '#fbbf24'], ['LOW', riskScore.totals.low, '#60a5fa']] as [string, number, string][]).map(([label, val, color]) => (
                  <div key={label} className="flex flex-col items-center">
                    <span className="text-2xl font-bold" style={{ color }}>{val}</span>
                    <span className="text-xs text-zinc-500 mt-0.5">{label}</span>
                  </div>
                ))}
              </div>
              {/* Compliance */}
              {pct !== null && (
                <div className="ml-auto flex flex-col items-end">
                  <span className="text-xs text-zinc-500 mb-1">Compliance</span>
                  <div className="w-48 h-2 rounded-full overflow-hidden" style={{ background: 'var(--row-hover)' }}>
                    <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-zinc-500 mt-1">{pct}% pass ({riskScore.compliance_pass}/{riskScore.compliance_pass + riskScore.compliance_fail})</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Compliance Trend */}
      <div className="glass-panel relative rounded-2xl p-5 space-y-3">
        <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
          style={{ background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.2),transparent)' }} />
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Compliance Trend</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Pass/fail evaluations over 30 days</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/70 inline-block" />Pass</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500/70 inline-block" />Fail</span>
          </div>
        </div>
        <TrendChart points={trend} />
      </div>

      {/* Auto-assign Patterns */}
      <div className="glass-panel relative rounded-2xl p-5 space-y-3">
        <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
          style={{ background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.15),transparent)' }} />
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Auto-assign Patterns</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Scans matching these patterns are automatically assigned to this org.
            Use glob syntax: <code className="text-violet-500 dark:text-violet-400">nginx:*</code>, <code className="text-violet-500 dark:text-violet-400">docker.io/myapp:*</code>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(org.image_patterns ?? []).map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-lg text-zinc-700 dark:text-zinc-200"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
              {p}
              <button onClick={() => removePattern(p)} className="text-zinc-400 hover:text-red-400 transition-colors ml-0.5">×</button>
            </span>
          ))}
          {(org.image_patterns ?? []).length === 0 && (
            <p className="text-xs text-zinc-500">No patterns configured.</p>
          )}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newPattern}
            onChange={e => setNewPattern(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addPattern()}
            placeholder="nginx:* or docker.io/myapp:*"
            className={inputCls + ' font-mono'}
          />
          <button
            onClick={addPattern}
            disabled={!newPattern.trim()}
            className="px-4 py-2 text-sm rounded-xl font-semibold text-white disabled:opacity-40 transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 16px rgba(124,58,237,0.35),inset 0 1px 0 rgba(255,255,255,0.15)' }}
          >
            Add
          </button>
        </div>
      </div>

      {/* Policies */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Policies</h2>
          <button
            onClick={openCreatePolicy}
            className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-xl transition-all hover:opacity-90 active:scale-95"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 20px rgba(124,58,237,0.4),inset 0 1px 0 rgba(255,255,255,0.15)' }}
          >
            <PlusSignIcon size={14} />
            Add Policy
          </button>
        </div>

        {(org.policies ?? []).length === 0 ? (
          <div className="glass-panel rounded-2xl p-6 text-center text-sm text-zinc-500">
            No policies yet. Add one to start evaluating compliance.
          </div>
        ) : (
          <div className="space-y-2">
            {(org.policies ?? []).map((policy) => (
              <div key={policy.id} className="glass-panel rounded-2xl p-4 flex items-start justify-between gap-4">
                <div className="space-y-2 min-w-0">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{policy.name}</p>
                  {policy.rules.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {policy.rules.map((r, i) => (
                        <RulePill key={i} rule={r} />
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openEditPolicy(policy)}
                    className="text-zinc-400 dark:text-zinc-500 hover:text-violet-500 dark:hover:text-violet-400 transition-colors p-1"
                    title="Edit policy"
                  >
                    <PencilEdit01Icon size={15} />
                  </button>
                  <button
                    onClick={() => handleDeletePolicy(policy.id)}
                    className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors p-1"
                    title="Delete policy"
                  >
                    <Delete01Icon size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assigned Scans */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Assigned Scans</h2>
          <button
            onClick={openAssignModal}
            className="flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
            style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
          >
            <PlusSignIcon size={14} />
            Assign Scan
          </button>
        </div>

        {orgScans.length === 0 ? (
          <div className="glass-panel rounded-2xl p-6 text-center text-sm text-zinc-500">
            No scans assigned. Assign a scan to evaluate it against this organization&apos;s policies.
          </div>
        ) : (
          <div className="glass-panel rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Image</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Compliance</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {orgScans.map((scan, i) => (
                  <tr key={scan.id}
                    style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/scans/${scan.id}`}
                        className="font-mono text-sm text-zinc-700 dark:text-zinc-300 hover:text-violet-500 dark:hover:text-violet-400 transition-colors"
                      >
                        {scan.image_name}:{scan.image_tag}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={scan.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {(scan.compliance ?? []).map((cr) => (
                          <span
                            key={cr.policy_id}
                            className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${
                              cr.status === 'pass'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : 'bg-red-500/10 text-red-400 border-red-500/20'
                            }`}
                          >
                            {cr.status === 'pass' ? '✓' : '✗'} {cr.policy_name}
                          </span>
                        ))}
                        {(scan.compliance ?? []).length === 0 && (
                          <span className="text-xs text-zinc-500">Not evaluated</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleRemoveScan(scan.id)}
                        className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors"
                        title="Remove scan from org"
                      >
                        <Delete01Icon size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                          <select
                            value={rule.type}
                            onChange={(e) => {
                              const newType = e.target.value as PolicyRule['type'];
                              setPolicyRules((prev) =>
                                prev.map((r, i) => (i === idx ? { type: newType } : r))
                              );
                            }}
                            className={inputCls}
                          >
                            {Object.entries(RULE_TYPE_LABELS).map(([val, label]) => (
                              <option key={val} value={val}>{label}</option>
                            ))}
                          </select>
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
                              <select
                                value={rule.severity ?? 'CRITICAL'}
                                onChange={(e) => setRuleField(idx, 'severity', e.target.value)}
                                className={inputCls}
                              >
                                {SEV_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                              </select>
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
                            <select
                              value={rule.severity ?? 'CRITICAL'}
                              onChange={(e) => setRuleField(idx, 'severity', e.target.value)}
                              className={inputCls}
                            >
                              {SEV_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
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
                  className="px-4 py-2 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
                  style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="policy-form"
                  disabled={policySaving}
                  className="px-4 py-2 text-sm rounded-xl font-semibold text-white disabled:opacity-60 flex items-center gap-2 transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 16px rgba(124,58,237,0.35),inset 0 1px 0 rgba(255,255,255,0.15)' }}
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
                            {new Date(scan.created_at).toLocaleDateString()}
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
      {confirmDialog}
    </div>
  );
}
