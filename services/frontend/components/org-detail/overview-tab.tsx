import { OrgRiskScore, TrendPoint } from '@/lib/api';
import { Card } from '@heroui/react';

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

  const uniqueFailingItems = Array.from(
    new Map(failingItems.map((item) => [item.key, item])).values()
  ).slice(0, 6);

  return (
    <div className="space-y-6">
      <RiskOverviewCard riskScore={riskScore} />

      <Card className="surface-card relative rounded-2xl p-5 space-y-3">
        <div
          className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
          style={{ background: 'linear-gradient(90deg,transparent,color-mix(in srgb, var(--accent) 20%, transparent),transparent)' }}
        />
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Compliance Trend</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Pass/fail evaluations over 30 days</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-emerald-500/70 inline-block" />Pass</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-red-500/70 inline-block" />Fail</span>
          </div>
        </div>
        <TrendChart points={trend} />

        <div className="pt-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            What Failed Recently
          </h3>
          {uniqueFailingItems.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500">No recent failed policy evaluations.</p>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {uniqueFailingItems.map((item) => (
                <a
                  key={item.key}
                  href={`/scans/${item.scanId}`}
                  className="group rounded-lg px-3 py-2 transition-colors hover:border-accent/40"
                  style={{
                    background: 'var(--surface-secondary)',
                    border: '1px solid var(--surface-border)',
                  }}
                >
                  <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200 group-hover:text-accent">
                    {item.policyName || 'Unnamed policy'}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-600 dark:text-zinc-500">
                    {item.imageRef}
                  </p>
                </a>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
