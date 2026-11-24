import { OrgRiskScore, TrendPoint } from '@/lib/api';
import { Card, ResourceList } from '@/components/ui';
import { pluralize } from '@/lib/labels';
import { StatStrip, StatStripItem } from '@/components/ui/stat-strip';
import { StatusTag } from '@/components/ui/status-dot';

import { OrgScanItem, RiskOverviewCard, TrendChart } from './shared';

interface OrgOverviewTabProps {
  riskScore: OrgRiskScore | null;
  trend: TrendPoint[];
  orgScans: OrgScanItem[];
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
    failingItems
      .reduce((policies, item) => {
        const key = item.policyName || 'Unnamed policy';
        const existing = policies.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          policies.set(key, { ...item, count: 1 });
        }
        return policies;
      }, new Map<string, (typeof failingItems)[number] & { count: number }>())
      .values()
  ).slice(0, 4);
  const critical = orgScans.reduce((total, scan) => total + scan.critical_count, 0);
  const high = orgScans.reduce((total, scan) => total + scan.high_count, 0);

  return (
    <div className="space-y-4">
      {riskScore ? (
        <RiskOverviewCard riskScore={riskScore} />
      ) : (
        // Without a risk score, fall back to the counts from the scans we have.
        <StatStrip className="lg:grid-cols-2">
          <StatStripItem
            label="Critical findings"
            value={critical}
            tone={critical > 0 ? 'danger' : 'success'}
          />
          <StatStripItem
            label="High findings"
            value={high}
            tone={high > 0 ? 'warning' : 'success'}
          />
        </StatStrip>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.85fr)]">
        <Card>
          <Card.Header>
            <div>
              <Card.Title>Compliance trend</Card.Title>
              <Card.Description>
                Pass and fail evaluations across the last 30 days.
              </Card.Description>
            </div>
          </Card.Header>
          <Card.Content>
            <TrendChart points={trend} />
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <div>
              <Card.Title>Failing policies</Card.Title>
              <Card.Description>Policies with the most recent failed evaluations.</Card.Description>
            </div>
          </Card.Header>
          <Card.Content>
            {failingPolicies.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                No recent failed policy evaluations.
              </p>
            ) : (
              <ResourceList>
                {failingPolicies.map((item) => (
                  <ResourceList.Item
                    key={item.policyName}
                    href={`/scans/details/${item.scanId}`}
                    title={item.policyName || 'Unnamed policy'}
                    description={`Latest: ${item.imageRef}`}
                    meta={<StatusTag tone="danger">{pluralize(item.count, 'failure')}</StatusTag>}
                  />
                ))}
              </ResourceList>
            )}
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}
