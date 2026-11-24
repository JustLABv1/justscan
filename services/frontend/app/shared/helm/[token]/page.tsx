'use client';
import { HelmImageList, HelmProgress, helmTotals } from '@/components/public/helm-image-list';
import { PublicPage, PublicPageHeader } from '@/components/public/public-page';
import { SeveritySummary } from '@/components/public/public-scan-result';
import { ScanDetailsDisclosure } from '@/components/public/scan-details';
import { buttonVariants, Card, Skeleton } from '@/components/ui';
import { ApiError, getSharedScan, Scan } from '@/lib/api';
import { pluralize } from '@/lib/labels';
import { fullDate, timeAgo } from '@/lib/time';
import { Copy01Icon, Tick02Icon } from 'hugeicons-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

/** Chart name from a chart reference such as oci://registry/charts/app:1.2.3. */
function chartNameFromUrl(url: string) {
  const last =
    url
      .replace(/^oci:\/\//, '')
      .replace(/\/+$/, '')
      .split('/')
      .pop() ?? '';
  return last.split(':')[0];
}

function LoadingState() {
  return (
    <PublicPage title="Shared Helm chart scan">
      <div role="status" aria-live="polite" className="space-y-6">
        <span className="sr-only">Loading shared Helm chart scan</span>
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-72" />
        </div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </PublicPage>
  );
}

function HelmGroupContent() {
  const { token } = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    // Build full list of tokens: primary token + any extras from ?tokens=
    const extraTokens = searchParams.get('tokens')?.split(',').filter(Boolean) ?? [];
    const allTokens = [token, ...extraTokens];

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    Promise.all(allTokens.map((t) => getSharedScan(t).catch((e) => ({ __error: e, __token: t }))))
      .then((results) => {
        const validScans: Scan[] = [];
        for (const r of results) {
          if ('__error' in (r as Record<string, unknown>)) {
            const err = (r as { __error: unknown; __token: string }).__error;
            if (err instanceof ApiError && err.status === 401) {
              router.push(
                `/login?returnUrl=/shared/helm/${token}${searchParams.toString() ? '?' + searchParams.toString() : ''}`
              );
              return;
            }
            // Skip individual failed tokens (e.g. a revoked link); don't fail the whole group.
          } else {
            validScans.push(r as Scan);
          }
        }
        if (validScans.length === 0) {
          setError(
            'The owner may have turned off these share links, or the link may be wrong. Ask them for a new one.'
          );
        } else {
          setScans(validScans);
        }
      })
      .catch(() => setError('The shared scan could not be loaded. Try again in a moment.'))
      .finally(() => setLoading(false));
  }, [token, router]); // eslint-disable-line react-hooks/exhaustive-deps

  const firstScan = scans[0];
  const chartUrl = firstScan?.helm_chart ?? '';
  const isOCI = chartUrl.startsWith('oci://');
  const chartTitle = firstScan?.helm_chart_name || chartNameFromUrl(chartUrl) || 'Helm chart scan';
  const chartVersion = firstScan?.helm_chart_version;
  const totals = helmTotals(scans);
  const mostRecentAt = scans.length > 0 ? scans[0].created_at : null;

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  if (loading) return <LoadingState />;

  if (error) {
    return (
      <PublicPage title="Shared Helm chart scan">
        <div className="mx-auto max-w-md space-y-4 py-16 text-center">
          <h1 className="text-xl font-semibold">This shared scan isn’t available</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Link href="/" className={buttonVariants()}>
            Go home
          </Link>
        </div>
      </PublicPage>
    );
  }

  return (
    <PublicPage title={chartTitle}>
      <PublicPageHeader
        eyebrow="Shared Helm chart scan"
        title={chartVersion ? `${chartTitle} ${chartVersion}` : chartTitle}
        subtitle={
          <span title={mostRecentAt ? fullDate(mostRecentAt) : undefined}>
            {pluralize(totals.images, 'image')}
            {mostRecentAt ? ` · scanned ${timeAgo(mostRecentAt)}` : ''}
          </span>
        }
        actions={[
          {
            label: copied ? 'Link copied' : 'Copy link',
            icon: copied ? <Tick02Icon size={15} /> : <Copy01Icon size={15} />,
            onPress: handleCopyLink,
          },
        ]}
      />

      <SeveritySummary
        counts={totals.counts}
        context={`Across ${pluralize(totals.images, 'image')}:`}
        status={<HelmProgress totals={totals} />}
      />

      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold">Images</h2>
          <p className="text-sm text-muted-foreground">
            Open an image to see its full vulnerability report.
          </p>
        </div>
        <HelmImageList
          showSourceLine
          emptyLabel="No images were shared for this chart."
          items={scans.map((scan) => ({
            key: scan.id,
            scan,
            href:
              scan.share_token && (scan.status === 'completed' || scan.status === 'failed')
                ? `/shared/${scan.share_token}`
                : undefined,
          }))}
        />
      </Card>

      {chartUrl ? (
        <ScanDetailsDisclosure
          items={[
            { label: 'Chart source', value: chartUrl, mono: true, wide: true },
            { label: 'Repository type', value: isOCI ? 'OCI registry' : 'Chart repository' },
            {
              label: 'Last scanned',
              value: mostRecentAt ? fullDate(mostRecentAt) : null,
              hidden: !mostRecentAt,
            },
          ]}
        />
      ) : null}
    </PublicPage>
  );
}

export default function SharedHelmGroupPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <HelmGroupContent />
    </Suspense>
  );
}
