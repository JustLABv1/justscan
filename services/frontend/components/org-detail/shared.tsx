import { OrgPolicy, OrgRiskScore, Scan, TrendPoint } from '@/lib/api';

export type OrgScanItem = Scan & { compliance: { policy_id: string; policy_name: string; status: string }[] };

export function RulePill({ rule }: { rule: OrgPolicy['rules'][number] }) {
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

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string; border: string }> = {
    completed: { color: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.22)' },
    failed: { color: '#f87171', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.22)' },
    running: { color: '#60a5fa', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.22)' },
    pending: { color: '#a1a1aa', bg: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.15)' },
  };
  const palette = map[status] ?? map.pending;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ color: palette.color, background: palette.bg, border: `1px solid ${palette.border}` }}
    >
      <span className={`w-1.5 h-1.5 rounded-full bg-current ${status === 'running' ? 'animate-pulse' : ''}`} />
      {status}
    </span>
  );
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return <p className="text-xs text-zinc-500 py-4 text-center">No compliance history yet.</p>;
  }

  const maxVal = Math.max(...points.map((point) => point.pass + point.fail), 1);
  const height = 64;

  return (
    <div className="flex items-end gap-0.5 h-16 w-full overflow-hidden">
      {points.map((point) => {
        const passHeight = Math.round((point.pass / maxVal) * height);
        const failHeight = Math.round((point.fail / maxVal) * height);
        return (
          <div
            key={point.date}
            className="flex flex-col items-center gap-0 flex-1 min-w-0 group relative"
            title={`${point.date}: ${point.pass} pass, ${point.fail} fail`}
          >
            <div className="w-full flex flex-col justify-end" style={{ height }}>
              {failHeight > 0 && <div className="w-full bg-red-500/70 rounded-t-sm" style={{ height: failHeight }} />}
              {passHeight > 0 && <div className="w-full bg-emerald-500/70" style={{ height: passHeight }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RiskOverviewCard({ riskScore }: { riskScore: OrgRiskScore | null }) {
  if (!riskScore) return null;

  const gradeColor = riskScore.grade === 'A'
    ? '#34d399'
    : riskScore.grade === 'B'
      ? '#60a5fa'
      : riskScore.grade === 'C'
        ? '#fbbf24'
        : riskScore.grade === 'D'
          ? '#fb923c'
          : '#f87171';
  const pct = riskScore.compliance_pass + riskScore.compliance_fail > 0
    ? Math.round(riskScore.compliance_pass_rate * 100)
    : null;

  return (
    <div className="glass-panel relative rounded-2xl p-5">
      <div
        className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
        style={{ background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.2),transparent)' }}
      />
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-white mb-4">Risk Overview</h2>
      <div className="flex items-center gap-6 flex-wrap">
        <div
          className="flex flex-col items-center justify-center w-20 h-20 rounded-2xl"
          style={{ background: `${gradeColor}18`, border: `1px solid ${gradeColor}30` }}
        >
          <span className="text-4xl font-black" style={{ color: gradeColor }}>{riskScore.grade}</span>
          <span className="text-xs text-zinc-500 mt-0.5">grade</span>
        </div>
        <div className="flex gap-4 flex-wrap">
          {([
            ['CRITICAL', riskScore.totals.critical, '#f87171'],
            ['HIGH', riskScore.totals.high, '#fb923c'],
            ['MEDIUM', riskScore.totals.medium, '#fbbf24'],
            ['LOW', riskScore.totals.low, '#60a5fa'],
          ] as [string, number, string][]).map(([label, value, color]) => (
            <div key={label} className="flex flex-col items-center">
              <span className="text-2xl font-bold" style={{ color }}>{value}</span>
              <span className="text-xs text-zinc-500 mt-0.5">{label}</span>
            </div>
          ))}
        </div>
        {pct !== null && (
          <div className="ml-auto flex flex-col items-end">
            <span className="text-xs text-zinc-500 mb-1">Compliance</span>
            <div className="w-48 h-2 rounded-full overflow-hidden" style={{ background: 'var(--row-hover)' }}>
              <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-zinc-500 mt-1">
              {pct}% pass ({riskScore.compliance_pass}/{riskScore.compliance_pass + riskScore.compliance_fail})
            </span>
          </div>
        )}
      </div>
    </div>
  );
}