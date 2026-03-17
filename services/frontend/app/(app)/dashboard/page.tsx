'use client';
import { DashboardStats, getStats, Scan } from '@/lib/api';
import {
  Activity01Icon,
  AlertDiamondIcon,
  CheckmarkBadge01Icon,
  Clock01Icon,
  EyeIcon,
  Shield01Icon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const SEV_CONFIG = [
  { key: 'critical', label: 'Critical', color: 'text-red-400', bg: 'bg-red-500/10', bar: 'bg-red-500' },
  { key: 'high',     label: 'High',     color: 'text-orange-400', bg: 'bg-orange-500/10', bar: 'bg-orange-500' },
  { key: 'medium',   label: 'Medium',   color: 'text-yellow-400', bg: 'bg-yellow-500/10', bar: 'bg-yellow-500' },
  { key: 'low',      label: 'Low',      color: 'text-blue-400',   bg: 'bg-blue-500/10',   bar: 'bg-blue-500'   },
  { key: 'unknown',  label: 'Unknown',  color: 'text-zinc-400',   bg: 'bg-zinc-500/10',   bar: 'bg-zinc-500'   },
] as const;

function statusDot(status: string) {
  if (status === 'completed') return 'bg-emerald-500';
  if (status === 'failed') return 'bg-red-500';
  if (status === 'running') return 'bg-blue-500 animate-pulse';
  return 'bg-zinc-500';
}

function RecentScanRow({ scan }: { scan: Scan }) {
  return (
    <Link
      href={`/scans/${scan.id}`}
      className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-zinc-800/60 transition-colors group"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-2 h-2 rounded-full shrink-0 ${statusDot(scan.status)}`} />
        <div className="min-w-0">
          <p className="text-sm font-mono text-zinc-200 truncate group-hover:text-white transition-colors">
            {scan.image_name}:{scan.image_tag}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">{new Date(scan.created_at).toLocaleString()}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-3">
        {scan.critical_count > 0 && (
          <span className="text-xs font-mono font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
            C:{scan.critical_count}
          </span>
        )}
        {scan.high_count > 0 && (
          <span className="text-xs font-mono text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded">
            H:{scan.high_count}
          </span>
        )}
        {scan.medium_count > 0 && (
          <span className="text-xs font-mono text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded">
            M:{scan.medium_count}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getStats()
      .then(setStats)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-7 h-7 rounded-full border-2 border-zinc-700 border-t-violet-500 animate-spin" />
    </div>
  );

  if (error) return (
    <div className="p-8">
      <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">{error}</div>
    </div>
  );

  if (!stats) return null;

  const totalVulns = Object.values(stats.severity_totals).reduce((a, b) => a + b, 0);

  const statCards = [
    { label: 'Total Scans', value: stats.total_scans, icon: Shield01Icon, color: 'text-violet-400', bg: 'bg-violet-500/10' },
    { label: 'Completed', value: stats.status_counts['completed'] ?? 0, icon: CheckmarkBadge01Icon, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'Failed', value: stats.status_counts['failed'] ?? 0, icon: AlertDiamondIcon, color: 'text-red-400', bg: 'bg-red-500/10' },
    { label: 'Watchlist', value: stats.watchlist_count, icon: EyeIcon, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Overview of your security scan activity</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-3">
            <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>
              <Icon size={18} className={color} />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{value}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Severity totals */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Total Vulnerabilities</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Across all completed scans</p>
          </div>
          <Activity01Icon size={18} className="text-zinc-600" />
        </div>
        <div className="space-y-2.5">
          {SEV_CONFIG.map(({ key, label, color, bg, bar }) => {
            const count = stats.severity_totals[key] ?? 0;
            const pct = totalVulns > 0 ? (count / totalVulns) * 100 : 0;
            return (
              <div key={key} className="flex items-center gap-3">
                <div className={`text-xs font-medium ${color} w-16 shrink-0`}>{label}</div>
                <div className="flex-1 bg-zinc-800 rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full ${bar} transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <div className={`text-xs font-mono font-bold ${color} ${bg} px-2 py-0.5 rounded w-12 text-right`}>
                  {count}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Recent scans */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock01Icon size={16} className="text-zinc-500" />
              <h2 className="text-sm font-semibold text-white">Recent Scans</h2>
            </div>
            <Link href="/scans" className="text-xs text-zinc-500 hover:text-violet-400 transition-colors">
              View all →
            </Link>
          </div>
          {(stats.recent_scans ?? []).length === 0 ? (
            <p className="text-sm text-zinc-600 py-6 text-center">No scans yet</p>
          ) : (
            <div className="space-y-0.5">
              {(stats.recent_scans ?? []).map((s) => <RecentScanRow key={s.id} scan={s} />)}
            </div>
          )}
        </div>

        {/* Top images */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Shield01Icon size={16} className="text-zinc-500" />
            <h2 className="text-sm font-semibold text-white">Top Scanned Images</h2>
          </div>
          {(stats.top_images ?? []).length === 0 ? (
            <p className="text-sm text-zinc-600 py-6 text-center">No data yet</p>
          ) : (
            <div className="space-y-2 pt-1">
              {(stats.top_images ?? []).map((img, i) => (
                <div key={img.image_name} className="flex items-center gap-3">
                  <span className="text-xs font-mono text-zinc-600 w-5 shrink-0">{i + 1}</span>
                  <span className="flex-1 font-mono text-xs text-zinc-300 truncate">{img.image_name}</span>
                  <span className="text-xs text-zinc-500 shrink-0 bg-zinc-800 px-2 py-0.5 rounded">
                    {img.count}×
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
