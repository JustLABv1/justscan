'use client';

// Base shimmer block
export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} />;
}

// ── Dashboard skeletons ────────────────────────────────────────────────
export function DashboardFocusCardSkeleton() {
  return (
    <div
      className="rounded-3xl p-6"
      style={{
        background: 'var(--surface-bg)',
        border: '1px solid var(--surface-border)',
        boxShadow: 'var(--surface-shadow)',
      }}
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-4">
          <Skeleton className="h-9 w-28 rounded-full" />
          <div className="space-y-3">
            <Skeleton className="h-10 w-[min(100%,28rem)] rounded-xl" />
            <Skeleton className="h-5 w-[min(100%,22rem)] rounded-lg" />
          </div>
        </div>
        <div className="flex shrink-0 gap-3">
          <Skeleton className="h-10 w-44 rounded-full" />
          <Skeleton className="h-10 w-32 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export function DashboardBriefingMetricSkeleton() {
  return (
    <div
      className="rounded-3xl px-5 py-4"
      style={{
        background: 'var(--surface-bg)',
        border: '1px solid var(--surface-border)',
        boxShadow: 'var(--surface-shadow)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-3">
          <Skeleton className="h-3.5 w-28 rounded" />
          <Skeleton className="h-9 w-14 rounded-lg" />
          <Skeleton className="h-4 w-40 rounded" />
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="mt-2 size-2 rounded-full" />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Skeleton className="h-10 w-28 rounded-xl" />
      </div>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="relative flex flex-col rounded-xl px-4 pt-3 pb-2 gap-3"
      style={{ background: 'var(--surface-bg)', border: '1px solid var(--surface-border)', boxShadow: 'var(--surface-shadow)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-9 rounded-xl" />
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
      style={{ background: 'var(--surface-bg)', border: '1px solid var(--surface-border)', boxShadow: 'var(--surface-shadow)' }}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-xl" />
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

export function DashboardLoadingSkeleton() {
  return (
    <div className="p-6 space-y-4">
      <DashboardFocusCardSkeleton />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <DashboardBriefingMetricSkeleton />
        <DashboardBriefingMetricSkeleton />
        <DashboardBriefingMetricSkeleton />
        <DashboardBriefingMetricSkeleton />
        <DashboardBriefingMetricSkeleton />
        <DashboardBriefingMetricSkeleton />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.55fr)]">
        <ChartSkeleton />
        <div
          className="flex min-h-[240px] flex-col rounded-2xl p-5"
          style={{
            background: 'var(--surface-bg)',
            border: '1px solid var(--surface-border)',
            boxShadow: 'var(--surface-shadow)',
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <Skeleton className="h-6 w-28 rounded-lg" />
              <Skeleton className="h-4 w-44 rounded" />
            </div>
            <Skeleton className="h-4 w-16 rounded" />
          </div>
          <Skeleton className="mt-4 h-4 w-32 rounded" />
          <div className="mt-4 flex-1">
            <Skeleton className="h-full min-h-[152px] w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Scans list skeletons ───────────────────────────────────────────────
export function ImageRowSkeleton() {
  return (
    <tr>
      <td colSpan={8} className="p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-4 rounded" />
          <Skeleton className="size-4 rounded" />
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
            style={{ background: 'var(--surface-bg)', border: '1px solid var(--surface-border)' }}>
            <Skeleton className="h-3 w-14 rounded mb-2" />
            <Skeleton className="h-7 w-10 rounded" />
          </div>
        ))}
      </div>
      <div className="rounded-xl p-5"
        style={{ background: 'var(--surface-bg)', border: '1px solid var(--surface-border)' }}>
        <div className="space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className={`h-12 w-full rounded-xl ${i > 0 ? 'opacity-70' : ''}`} style={{ opacity: 1 - i * 0.12 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
