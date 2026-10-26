import { StatCard } from '@/components/ui/stat-card';
import {
  Bar as EvilBar,
  EvilBarChart,
  Grid as EvilBarGrid,
  Tooltip as EvilBarTooltip,
  XAxis as EvilBarXAxis,
  YAxis as EvilBarYAxis,
} from '@/components/evilcharts/charts/bar-chart';
import { typedChartConfigFromSeries } from '@/components/ui/chart-adapter';
import { OrgPolicy, OrgRiskScore, Scan, TrendPoint } from '@/lib/api';
import { Chip } from '@/components/ui';

export type OrgScanItem = Scan & {
  compliance: { policy_id: string; policy_name: string; status: string; evaluated_at?: string }[];
  access_type?: 'owned' | 'shared';
  trigger_source?: string;
  external_ref?: string;
};

export function RulePill({ rule }: { rule: OrgPolicy['rules'][number] }) {
  const base = 'inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border';
  switch (rule.type) {
    case 'max_cvss':
      return (
        <span className={`${base} bg-destructive/10 text-destructive border-destructive/20`}>
          CVSS &lt; {rule.value}
        </span>
      );
    case 'max_count':
      return (
        <span className={`${base} bg-orange-500/10 text-orange-400 border-orange-500/20`}>
          {rule.value} {rule.severity}
        </span>
      );
    case 'max_total':
      return (
        <span className={`${base} bg-warning/10 text-warning-foreground border-warning/20`}>
          Total ≤ {rule.value}
        </span>
      );
    case 'require_fix':
      return (
        <span className={`${base} bg-info/10 text-info-foreground border-info/20`}>
          Fix req. {rule.severity}
        </span>
      );
    case 'blocked_cve':
      return (
        <span className={`${base} bg-destructive/10 text-destructive border-destructive/20`}>
          Block {rule.cve_id}
        </span>
      );
    case 'xray_policy_block':
      return (
        <span className={`${base} bg-destructive/10 text-destructive border-destructive/20`}>
          No Xray Blocking
        </span>
      );
    default:
      return (
        <span className={`${base} bg-muted/10 text-muted-foreground border-border/20`}>
          {rule.type}
        </span>
      );
  }
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Chip
      size="sm"
      variant="soft"
      color={status === 'completed' ? 'success' : status === 'failed' ? 'danger' : 'default'}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {status}
    </Chip>
  );
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">No compliance history yet.</p>
    );
  }

  const byDate = new Map(points.map((point) => [point.date, point]));
  const last30Days: Array<{
    date: string;
    pass: number;
    fail: number;
    shortLabel: string;
  }> = [];

  for (let daysAgo = 29; daysAgo >= 0; daysAgo -= 1) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - daysAgo);

    const dateKey = date.toISOString().slice(0, 10);
    const source = byDate.get(dateKey);

    last30Days.push({
      date: dateKey,
      pass: source?.pass ?? 0,
      fail: source?.fail ?? 0,
      shortLabel: date.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    });
  }

  const totalPass = last30Days.reduce((sum, point) => sum + point.pass, 0);
  const totalFail = last30Days.reduce((sum, point) => sum + point.fail, 0);
  const totalEvaluations = totalPass + totalFail;
  const passRate = totalEvaluations > 0 ? Math.round((totalPass / totalEvaluations) * 100) : 0;
  const activeDays = last30Days.filter((point) => point.pass + point.fail > 0).length;

  const config = typedChartConfigFromSeries([
    { key: 'pass', label: 'Pass', color: 'var(--success)' },
    { key: 'fail', label: 'Fail', color: 'var(--destructive)' },
  ] as const);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-success-foreground dark:text-success-foreground">
          <span className="size-1.5 rounded-full bg-success" />
          {totalPass} pass
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-destructive/25 bg-destructive/10 px-2 py-0.5 text-destructive dark:text-destructive">
          <span className="size-1.5 rounded-full bg-destructive" />
          {totalFail} fail
        </span>
        <span>{passRate}% pass rate</span>
        <span className="text-muted-foreground">•</span>
        <span>{activeDays}/30 active days</span>
      </div>

      <div
        className="h-44 w-full overflow-hidden rounded-xl p-2"
        style={{
          background: 'var(--surface-secondary)',
        }}
      >
        <EvilBarChart
          data={last30Days}
          config={config}
          stackType="stacked"
          className="h-full !aspect-auto"
          barCategoryGap={6}
        >
          <EvilBarGrid stroke="var(--border)" vertical={false} />
          <EvilBarXAxis
            dataKey="shortLabel"
            minTickGap={24}
            tickFormatter={(_, index) =>
              index % 5 === 0 || index === last30Days.length - 1 ? last30Days[index].shortLabel : ''
            }
          />
          <EvilBarYAxis allowDecimals={false} width={28} />
          <EvilBarTooltip variant="frosted-glass" roundness="lg" />
          <EvilBar dataKey="fail" />
          <EvilBar dataKey="pass" />
        </EvilBarChart>
      </div>
    </div>
  );
}

export function RiskOverviewCard({ riskScore }: { riskScore: OrgRiskScore | null }) {
  if (!riskScore) return null;
  const evaluated = riskScore.compliance_pass + riskScore.compliance_fail;
  const passRate = evaluated > 0 ? `${Math.round(riskScore.compliance_pass_rate * 100)}%` : '—';
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <StatCard label="Risk grade" value={riskScore.grade} hint="Current organization posture" />
      <StatCard label="Critical" value={riskScore.totals.critical} hint="Findings" tone="danger" />
      <StatCard label="High" value={riskScore.totals.high} hint="Findings" tone="warning" />
      <StatCard label="Medium" value={riskScore.totals.medium} hint="Findings" tone="warning" />
      <StatCard label="Low" value={riskScore.totals.low} hint="Findings" />
      <StatCard
        label="Compliance"
        value={passRate}
        hint={
          evaluated > 0
            ? `${riskScore.compliance_pass} of ${evaluated} passed`
            : 'No evaluated scans'
        }
      />
    </div>
  );
}
