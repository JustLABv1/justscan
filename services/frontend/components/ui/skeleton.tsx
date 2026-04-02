'use client';

// Base shimmer block
export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} />;
}

// ── Dashboard skeletons ────────────────────────────────────────────────
export function StatCardSkeleton() {
  return (
    <div className="relative flex flex-col rounded-xl px-4 pt-3 pb-2 gap-3"
      style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-shadow)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <Skeleton className="w-9 h-9 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="h-6 w-12 rounded" />
            <Skeleton className="h-3 w-20 rounded" />
          </div>
        </div>
      </div>
      <Skeleton className="h-12 w-full rounded" />
    </div>
  );
}

export function RecentScanRowSkeleton() {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <Skeleton className="h-5 w-12 rounded-md" />
        <div className="space-y-1 min-w-0">
          <Skeleton className="h-3 w-40 rounded" />
          <Skeleton className="h-2.5 w-20 rounded" />
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 ml-2">
        <Skeleton className="h-5 w-10 rounded-md" />
      </div>
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="rounded-2xl p-5"
      style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-shadow)' }}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <Skeleton className="w-9 h-9 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-36 rounded" />
            <Skeleton className="h-3 w-52 rounded" />
          </div>
        </div>
        <div className="flex gap-1">
          <Skeleton className="h-7 w-10 rounded-lg" />
          <Skeleton className="h-7 w-10 rounded-lg" />
          <Skeleton className="h-7 w-10 rounded-lg" />
        </div>
      </div>
      <Skeleton className="h-36 w-full rounded-lg" />
    </div>
  );
}

// ── Scans list skeletons ───────────────────────────────────────────────
export function ImageRowSkeleton() {
  return (
    <tr>
      <td colSpan={8} className="px-4 py-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-4 rounded" />
          <div className="flex items-center gap-2.5 flex-1">
            <Skeleton className="h-4 w-48 rounded" />
            <Skeleton className="h-5 w-14 rounded-md" />
          </div>
          <Skeleton className="h-4 w-16 rounded" />
          <Skeleton className="h-4 w-8 rounded ml-4" />
          <Skeleton className="h-4 w-8 rounded" />
          <Skeleton className="h-4 w-8 rounded" />
          <Skeleton className="h-4 w-8 rounded" />
        </div>
      </td>
    </tr>
  );
}

// ── Table skeleton (generic) ───────────────────────────────────────────
export function TableRowSkeleton({ cols = 5 }: { cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3.5">
          <Skeleton className={`h-4 rounded ${i === 0 ? 'w-40' : i === cols - 1 ? 'w-16' : 'w-24'}`} />
        </td>
      ))}
    </tr>
  );
}

// ── Scan detail skeleton ───────────────────────────────────────────────
export function ScanDetailSkeleton() {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-24 rounded" />
        <Skeleton className="h-7 w-72 rounded" />
        <Skeleton className="h-3.5 w-48 rounded" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl p-4"
            style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
            <Skeleton className="h-3 w-14 rounded mb-2" />
            <Skeleton className="h-7 w-10 rounded" />
          </div>
        ))}
      </div>
      <div className="rounded-xl p-5"
        style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
        <div className="space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className={`h-12 w-full rounded-xl ${i > 0 ? 'opacity-70' : ''}`} style={{ opacity: 1 - i * 0.12 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
