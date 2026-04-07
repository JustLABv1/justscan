import Link from 'next/link';

export function RouteLoadingState({
  title = 'Loading view',
  message = 'Fetching the latest data for this page.',
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="glass-panel rounded-3xl p-8 space-y-5">
        <div className="space-y-2">
          <div className="skeleton h-8 w-48 rounded-xl" />
          <div className="skeleton h-4 w-72 rounded-lg" />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-2xl p-5" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
              <div className="skeleton h-4 w-24 rounded" />
              <div className="skeleton h-8 w-20 rounded mt-3" />
              <div className="skeleton h-3 w-28 rounded mt-4" />
            </div>
          ))}
        </div>
        <div className="rounded-2xl p-5 space-y-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
          <div className="skeleton h-4 w-40 rounded" />
          <div className="skeleton h-3 w-full rounded" />
          <div className="skeleton h-3 w-5/6 rounded" />
          <p className="text-sm text-zinc-500">{message}</p>
        </div>
      </div>
    </div>
  );
}

export function RouteErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="glass-panel rounded-3xl p-8 space-y-4">
        <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
          Page error
        </span>
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">{title}</h1>
          <p className="mt-2 text-sm text-zinc-500">{message}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)' }}
          >
            Retry
          </button>
          <Link href="/dashboard" className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-300" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}