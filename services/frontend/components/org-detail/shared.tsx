import { StatStrip, StatStripItem } from '@/components/ui/stat-strip';
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
import { StatusTag } from '@/components/ui/status-dot';
import { humanize } from '@/lib/labels';

export type OrgScanItem = Scan & {
  compliance: { policy_id: string; policy_name: string; status: string; evaluated_at?: string }[];
  access_type?: 'owned' | 'shared';
  trigger_source?: string;
  external_ref?: string;
};

const RULE_SEVERITY_LABELS: Record<string, string> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  UNKNOWN: 'unknown-severity',
};

function ruleSeverity(severity?: string) {
  const key = String(severity ?? '').toUpperCase();
  return RULE_SEVERITY_LABELS[key] ?? (key ? key.toLowerCase() : 'any');
}

/** A policy rule as one readable sentence, e.g. "No more than 0 critical findings". */
export function describePolicyRule(rule: OrgPolicy['rules'][number]): string {
  switch (rule.type) {
    case 'max_cvss':
      return `CVSS below ${rule.value ?? '—'}`;
    case 'max_count':
      return `At most ${rule.value ?? 0} ${ruleSeverity(rule.severity)} findings`;
    case 'max_total':
      return `At most ${rule.value ?? 0} findings in total`;
    case 'require_fix':
      return `Fixes required for ${ruleSeverity(rule.severity)} findings`;
    case 'blocked_cve':
      return rule.cve_id ? `Blocks ${rule.cve_id}` : 'Blocks a specific CVE';
    case 'xray_policy_block':
      return 'No Xray policy blocks';
    default:
      return humanize(rule.type);
  }
}

const RULE_TONES: Record<string, string> = {
  max_cvss: 'danger',
  max_count: 'warning',
  max_total: 'warning',
  require_fix: 'accent',
  blocked_cve: 'danger',
  xray_policy_block: 'danger',
};

export function RulePill({ rule }: { rule: OrgPolicy['rules'][number] }) {
  return (
    <Chip size="sm" variant="soft" color={RULE_TONES[rule.type] ?? 'default'}>
      {describePolicyRule(rule)}
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusTag tone="success">{totalPass} passed</StatusTag>
        <StatusTag tone="danger">{totalFail} failed</StatusTag>
        <StatusTag>{passRate}% pass rate</StatusTag>
        <StatusTag>{activeDays} of 30 days with evaluations</StatusTag>
      </div>

      <div className="h-44 w-full overflow-hidden rounded-xl bg-muted/40 p-2">
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
    <StatStrip className="lg:grid-cols-6">
      <StatStripItem label="Risk grade" value={riskScore.grade} hint="Organization posture" />
      <StatStripItem
        label="Critical"
        value={riskScore.totals.critical}
        hint="Findings"
        tone={riskScore.totals.critical > 0 ? 'danger' : undefined}
      />
      <StatStripItem
        label="High"
        value={riskScore.totals.high}
        hint="Findings"
        tone={riskScore.totals.high > 0 ? 'warning' : undefined}
      />
      <StatStripItem
        label="Medium"
        value={riskScore.totals.medium}
        hint="Findings"
        tone={riskScore.totals.medium > 0 ? 'warning' : undefined}
      />
      <StatStripItem label="Low" value={riskScore.totals.low} hint="Findings" />
      <StatStripItem
        label="Compliance"
        value={passRate}
        hint={
          evaluated > 0
            ? `${riskScore.compliance_pass} of ${evaluated} passed`
            : 'No evaluated scans'
        }
        tone={riskScore.compliance_fail > 0 ? 'danger' : undefined}
      />
    </StatStrip>
  );
}
