import { OrgRiskScore, TrendPoint } from '@/lib/api';

import { RiskOverviewCard, TrendChart } from './shared';

interface OrgOverviewTabProps {
  riskScore: OrgRiskScore | null;
  trend: TrendPoint[];
}

export function OrgOverviewTab({ riskScore, trend }: OrgOverviewTabProps) {
  return (
    <div className="space-y-6">
      <RiskOverviewCard riskScore={riskScore} />

      <div className="glass-panel relative rounded-2xl p-5 space-y-3">
        <div
          className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
          style={{ background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.2),transparent)' }}
        />
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
    </div>
  );
}