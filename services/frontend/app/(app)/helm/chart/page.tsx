'use client';
import { listHelmScanRuns } from '@/lib/api';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

function HelmChartRedirectContent() {
  const router = useRouter();
  const params = useSearchParams();
  const chartUrl = params.get('url') ?? '';
  const requestError = chartUrl ? '' : 'No chart URL specified.';
  const [error, setError] = useState('');

  useEffect(() => {
    if (requestError) {
      return;
    }

    listHelmScanRuns(1, 1, chartUrl)
      .then((response) => {
        const latestRun = response.data?.[0];
        if (!latestRun) {
          setError('No Helm runs were found for this chart URL.');
          return;
        }
        router.replace(`/helm/runs/${latestRun.id}`);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to resolve Helm run.');
      });
  }, [chartUrl, requestError, router]);

  if (requestError) {
    return (
      <div className="p-6 text-center text-zinc-400 text-sm space-y-3">
        <p>{requestError}</p>
        <Link href="/helm" className="text-violet-500 hover:underline">
          Back to Helm runs
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center text-zinc-400 text-sm space-y-3">
        <p>{error}</p>
        <Link href="/helm" className="text-violet-500 hover:underline">
          Back to Helm runs
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 flex items-center justify-center gap-3 text-zinc-400 text-sm">
      <span className="w-4 h-4 rounded-full border-2 border-zinc-400/30 border-t-zinc-400 animate-spin" />
      Resolving latest Helm run…
    </div>
  );
}

export default function HelmChartRedirectPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 flex items-center justify-center gap-3 text-zinc-400 text-sm">
          <span className="w-4 h-4 rounded-full border-2 border-zinc-400/30 border-t-zinc-400 animate-spin" />
          Resolving latest Helm run…
        </div>
      }
    >
      <HelmChartRedirectContent />
    </Suspense>
  );
}