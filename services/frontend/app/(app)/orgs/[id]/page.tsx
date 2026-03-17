'use client';
import {
  assignScanToOrg,
  createPolicy,
  deletePolicy,
  getComplianceTrend,
  getOrg,
  listScans,
  listOrgScans,
  Org,
  OrgPolicy,
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

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors';
const selectCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-violet-500 transition-colors';

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
  const map: Record<string, string> = {
    completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    failed: 'bg-red-500/15 text-red-400 border-red-500/20',
    running: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    pending: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
  };
  const cls = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'running' ? 'bg-blue-400 animate-pulse' : 'bg-current'}`} />
      {status}
    </span>
  );
}

function emptyRule(): PolicyRule {
  return { type: 'max_cvss', value: 7 };
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) return (
    <p className="text-xs text-zinc-600 py-4 text-center">No compliance history yet.</p>
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

  // Trend chart
  const [trend, setTrend] = useState<TrendPoint[]>([]);

  // Image pattern input
  const [newPattern, setNewPattern] = useState('');

  // Assigned scans
  type OrgScanItem = Scan & { compliance: { policy_id: string; policy_name: string; status: string }[] };
  const [orgScans, setOrgScans] = useState<OrgScanItem[]>([]);

  // Policy editor state
  const [editingPolicy, setEditingPolicy] = useState<OrgPolicy | null>(null);
  const [policyName, setPolicyName] = useState('');
  const [policyRules, setPolicyRules] = useState<PolicyRule[]>([emptyRule()]);
  const [policyError, setPolicyError] = useState('');
  const [policySaving, setPolicySaving] = useState(false);
  const policyModal = useOverlayState();

  // Assign scan modal
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
    if (!confirm('Delete this policy? Existing compliance results will be removed.')) return;
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
      // Filter out already-assigned scans
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
    if (!confirm('Remove this scan from the organization?')) return;
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
        <div className="w-7 h-7 rounded-full border-2 border-zinc-700 border-t-violet-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">{error}</div>
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
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-3"
        >
          <ArrowLeft01Icon size={15} />
          Back to organizations
        </button>
        <h1 className="text-xl font-bold text-white">{org.name}</h1>
        {org.description && <p className="text-sm text-zinc-500 mt-1">{org.description}</p>}
      </div>

      {/* Compliance Trend */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Compliance Trend</h2>
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
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Auto-assign Patterns</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Scans matching these patterns are automatically assigned to this org.
            Use glob syntax: <code className="text-violet-400">nginx:*</code>, <code className="text-violet-400">docker.io/myapp:*</code>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(org.image_patterns ?? []).map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-mono px-2.5 py-1 rounded-lg">
              {p}
              <button onClick={() => removePattern(p)} className="text-zinc-500 hover:text-red-400 transition-colors ml-0.5">×</button>
            </span>
          ))}
          {(org.image_patterns ?? []).length === 0 && (
            <p className="text-xs text-zinc-600">No patterns configured.</p>
          )}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newPattern}
            onChange={e => setNewPattern(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addPattern()}
            placeholder="nginx:* or docker.io/myapp:*"
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-violet-500 transition-colors font-mono"
          />
          <button
            onClick={addPattern}
            disabled={!newPattern.trim()}
            className="px-3 py-2 text-sm rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium disabled:opacity-40 transition-colors"
          >
            Add
          </button>
        </div>
      </div>

      {/* Policies */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Policies</h2>
          <button
            onClick={openCreatePolicy}
            className="flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors"
          >
            <PlusSignIcon size={14} />
            Add Policy
          </button>
        </div>

        {(org.policies ?? []).length === 0 ? (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 text-center text-sm text-zinc-600">
            No policies yet. Add one to start evaluating compliance.
          </div>
        ) : (
          <div className="space-y-2">
            {(org.policies ?? []).map((policy) => (
              <div key={policy.id} className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 flex items-start justify-between gap-4">
                <div className="space-y-2 min-w-0">
                  <p className="text-sm font-medium text-zinc-200">{policy.name}</p>
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
                    className="text-zinc-500 hover:text-violet-400 transition-colors"
                    title="Edit policy"
                  >
                    <PencilEdit01Icon size={15} />
                  </button>
                  <button
                    onClick={() => handleDeletePolicy(policy.id)}
                    className="text-zinc-600 hover:text-red-400 transition-colors"
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
          <h2 className="text-base font-semibold text-white">Assigned Scans</h2>
          <button
            onClick={openAssignModal}
            className="flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <PlusSignIcon size={14} />
            Assign Scan
          </button>
        </div>

        {orgScans.length === 0 ? (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 text-center text-sm text-zinc-600">
            No scans assigned. Assign a scan to evaluate it against this organization's policies.
          </div>
        ) : (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Image</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Compliance</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {orgScans.map((scan) => (
                  <tr key={scan.id} className="hover:bg-zinc-800/40 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        href={`/scans/${scan.id}`}
                        className="font-mono text-sm text-zinc-200 hover:text-violet-400 transition-colors"
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
                          <span className="text-xs text-zinc-600">Not evaluated</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleRemoveScan(scan.id)}
                        className="text-zinc-600 hover:text-red-400 transition-colors"
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
            <Modal.Dialog className="bg-zinc-900 border border-zinc-800 rounded-2xl">
              <Modal.Header className="border-b border-zinc-800 px-6 py-4">
                <Modal.Heading className="text-white font-semibold">
                  {editingPolicy ? 'Edit Policy' : 'New Policy'}
                </Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5 max-h-[60vh] overflow-y-auto">
                <form id="policy-form" onSubmit={handleSavePolicy} className="space-y-5">
                  {policyError && (
                    <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-sm text-red-400">
                      {policyError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-300">Policy Name <span className="text-red-400">*</span></label>
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
                      <label className="text-sm font-medium text-zinc-300">Rules</label>
                      <button
                        type="button"
                        onClick={addRule}
                        className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                      >
                        <PlusSignIcon size={12} />
                        Add Rule
                      </button>
                    </div>

                    {policyRules.map((rule, idx) => (
                      <div key={idx} className="bg-zinc-800 rounded-lg p-3 space-y-3 border border-zinc-700">
                        <div className="flex items-center justify-between gap-2">
                          <select
                            value={rule.type}
                            onChange={(e) => {
                              const newType = e.target.value as PolicyRule['type'];
                              setPolicyRules((prev) =>
                                prev.map((r, i) => (i === idx ? { type: newType } : r))
                              );
                            }}
                            className={selectCls}
                          >
                            {Object.entries(RULE_TYPE_LABELS).map(([val, label]) => (
                              <option key={val} value={val}>{label}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => removeRule(idx)}
                            className="text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                          >
                            <Delete01Icon size={15} />
                          </button>
                        </div>

                        {/* Conditional inputs */}
                        {rule.type === 'max_cvss' && (
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-400">Max CVSS threshold (fail if ≥ this value)</label>
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
                              <label className="text-xs text-zinc-400">Severity</label>
                              <select
                                value={rule.severity ?? 'CRITICAL'}
                                onChange={(e) => setRuleField(idx, 'severity', e.target.value)}
                                className={selectCls}
                              >
                                {SEV_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-zinc-400">Max count</label>
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
                            <label className="text-xs text-zinc-400">Max total vulnerabilities</label>
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
                            <label className="text-xs text-zinc-400">Require fix for severity</label>
                            <select
                              value={rule.severity ?? 'CRITICAL'}
                              onChange={(e) => setRuleField(idx, 'severity', e.target.value)}
                              className={selectCls}
                            >
                              {SEV_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                        )}
                        {rule.type === 'blocked_cve' && (
                          <div className="space-y-1">
                            <label className="text-xs text-zinc-400">CVE ID</label>
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
                      <p className="text-xs text-zinc-600 text-center py-2">No rules. Add at least one rule.</p>
                    )}
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer className="border-t border-zinc-800 px-6 py-4 flex gap-3 justify-end">
                <button
                  onClick={policyModal.close}
                  className="px-4 py-2 text-sm rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="policy-form"
                  disabled={policySaving}
                  className="px-4 py-2 text-sm rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium disabled:opacity-60 transition-colors flex items-center gap-2"
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
            <Modal.Dialog className="bg-zinc-900 border border-zinc-800 rounded-2xl">
              <Modal.Header className="border-b border-zinc-800 px-6 py-4">
                <Modal.Heading className="text-white font-semibold">Assign Scan</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5 max-h-[60vh] overflow-y-auto">
                {assignLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="w-6 h-6 rounded-full border-2 border-zinc-700 border-t-violet-500 animate-spin" />
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
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-zinc-800 transition-colors text-left group"
                      >
                        <div>
                          <p className="font-mono text-sm text-zinc-200 group-hover:text-violet-400 transition-colors">
                            {scan.image_name}:{scan.image_tag}
                          </p>
                          <p className="text-xs text-zinc-600 mt-0.5">
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
    </div>
  );
}
