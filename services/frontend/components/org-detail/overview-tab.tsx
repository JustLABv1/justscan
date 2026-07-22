import { OrgRiskScore, TrendPoint } from '@/lib/api';
import { Card, Chip, Link } from '@heroui/react';

import { OrgScanItem, RiskOverviewCard, TrendChart } from './shared';

interface OrgOverviewTabProps {
  riskScore: OrgRiskScore | null;
  trend: TrendPoint[];
  orgScans: OrgScanItem[];
}

function SummaryMetric({ label, value, detail, color = 'default' }: { label: string; value: string | number; detail: string; color?: 'default' | 'danger' | 'warning' | 'success' }) {
  return (
    <Card>
      <Card.Content className="gap-1">
        <p className="text-xs font-medium text-muted">{label}</p>
        <div className="flex items-baseline gap-2">
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
          <Chip color={color} size="sm" variant="soft">{detail}</Chip>
        </div>
      </Card.Content>
    </Card>
  );
}

export function OrgOverviewTab({ riskScore, trend, orgScans }: OrgOverviewTabProps) {
  const failingItems = orgScans
    .slice()
    .sort((a, b) => {
      const aTime = a.completed_at ? new Date(a.completed_at).getTime() : 0;
      const bTime = b.completed_at ? new Date(b.completed_at).getTime() : 0;
      return bTime - aTime;
    })
    .flatMap((scan) =>
      (scan.compliance ?? [])
        .filter((result) => result.status === 'fail')
        .map((result) => ({
          key: `${scan.id}-${result.policy_id}`,
          scanId: scan.id,
          imageRef: `${scan.image_name}:${scan.image_tag}`,
          policyName: result.policy_name,
        }))
    );
  const failingPolicies = Array.from(
    failingItems.reduce((policies, item) => {
      const key = item.policyName || 'Unnamed policy';
      const existing = policies.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        policies.set(key, { ...item, count: 1 });
      }
      return policies;
    }, new Map<string, (typeof failingItems)[number] & { count: number }>()).values()
  ).slice(0, 4);
  const critical = riskScore?.totals.critical ?? orgScans.reduce((total, scan) => total + scan.critical_count, 0);
  const high = riskScore?.totals.high ?? orgScans.reduce((total, scan) => total + scan.high_count, 0);
  const passRate = riskScore?.compliance_pass_rate ?? 0;

  return (
    <div className="space-y-6">
      <RiskOverviewCard riskScore={riskScore} />

      <section aria-labelledby="attention-heading" className="space-y-3">
        <div>
          <h2 id="attention-heading" className="text-base font-semibold">Needs attention</h2>
          <p className="text-sm text-muted">The signals that should guide the next remediation decision.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <SummaryMetric label="Critical findings" value={critical} detail={critical === 1 ? '1 finding' : `${critical} findings`} color={critical > 0 ? 'danger' : 'success'} />
          <SummaryMetric label="High findings" value={high} detail={high === 1 ? '1 finding' : `${high} findings`} color={high > 0 ? 'warning' : 'success'} />
          <SummaryMetric label="Policy pass rate" value={`${Math.round(passRate)}%`} detail={failingItems.length > 0 ? `${failingItems.length} recent failures` : 'No recent failures'} color={failingItems.length > 0 ? 'warning' : 'success'} />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.85fr)]">
        <Card>
          <Card.Header>
            <div>
              <Card.Title>Compliance trend</Card.Title>
              <Card.Description>Pass and fail evaluations across the last 30 days.</Card.Description>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted">
              <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-success" />Pass</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-danger" />Fail</span>
            </div>
          </Card.Header>
          <Card.Content><TrendChart points={trend} /></Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <div>
              <Card.Title>Failing policies</Card.Title>
              <Card.Description>Policies with the most recent failed evaluations.</Card.Description>
            </div>
          </Card.Header>
          <Card.Content className="gap-2">
            {failingPolicies.length === 0 ? (
              <div className="rounded-xl border border-dashed border-divider p-5 text-sm text-muted">No recent failed policy evaluations.</div>
            ) : failingPolicies.map((item) => (
              <Link key={item.policyName} href={`/scans/${item.scanId}`} className="group block rounded-xl border border-divider p-3 no-underline transition-colors hover:bg-surface-secondary">
                <div className="flex items-start justify-between gap-3">
                  <p className="truncate text-sm font-medium text-foreground group-hover:text-accent">{item.policyName || 'Unnamed policy'}</p>
                  <Chip color="danger" size="sm" variant="soft">{item.count} {item.count === 1 ? 'failure' : 'failures'}</Chip>
                </div>
                <p className="mt-1 truncate font-mono text-xs text-muted">Latest: {item.imageRef}</p>
              </Link>
            ))}
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}
