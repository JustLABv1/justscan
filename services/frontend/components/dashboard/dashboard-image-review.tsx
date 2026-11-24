'use client';

import { StatusTag } from '@/components/ui/status-dot';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Container } from 'lucide-react';
import { Button, Card, ResourceList } from '@/components/ui';
import { SeverityCounts, StatusBadge } from '@/components/ui/badges';
import { StatusAlert } from '@/components/ui/form-alert';
import { useWorkScope } from '@/hooks/use-work-scope';
import { useConditionalInterval } from '@/hooks/use-conditional-interval';
import { listScanImages, type ImageOverview } from '@/lib/api';
import { isAbortError } from '@/lib/utils';
import { timeAgo } from '@/lib/time';
import { pluralize, splitImageRef } from '@/lib/labels';

/** Current image posture, deliberately separate from historical dashboard totals. */
export function DashboardImageReview({
  refreshKey,
  activeScans,
}: {
  refreshKey: number;
  activeScans: number;
}) {
  const scope = useWorkScope();
  return (
    <ImageReview
      key={scope.kind === 'org' ? scope.orgId : 'personal'}
      refreshKey={refreshKey}
      activeScans={activeScans}
    />
  );
}

function ImageReview({ refreshKey, activeScans }: { refreshKey: number; activeScans: number }) {
  const [images, setImages] = useState<ImageOverview[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useConditionalInterval(() => setRevision((value) => value + 1), activeScans > 0, 5000);
  useEffect(() => {
    const controller = new AbortController();
    listScanImages(
      1,
      6,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'risk_desc',
      undefined,
      { signal: controller.signal }
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setImages(result.data ?? []);
          setTotal(result.total);
          setError('');
        }
      })
      .catch((reason) => {
        if (!isAbortError(reason) && !controller.signal.aborted)
          setError('Image health could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey, revision]);
  return (
    <Card className="min-w-0 overflow-hidden gap-0 py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <div>
          <h2 className="text-sm font-medium">Image health</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Current image posture, highest risk first
          </p>
        </div>
        <Button asChild size="sm" variant="ghost">
          <Link href="/scans?sort=risk_desc">
            {loading || error ? 'View images' : `${total.toLocaleString()} images`}
            <ChevronRight className="size-3.5" />
          </Link>
        </Button>
      </div>
      {error ? (
        <div className="p-4 pt-0">
          <StatusAlert
            status="danger"
            title="Image health unavailable"
            description={error}
            action={
              <Button size="sm" variant="outline" onPress={() => setRevision((value) => value + 1)}>
                Retry
              </Button>
            }
          />
        </div>
      ) : null}
      {loading ? (
        <ul className="divide-y divide-border border-t border-border" aria-busy>
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="px-4 py-3">
              <div className="h-9 animate-pulse rounded bg-muted" />
            </li>
          ))}
        </ul>
      ) : error && images.length === 0 ? (
        <p className="border-t border-border py-10 text-center text-sm text-muted-foreground">
          Image health is unavailable. Retry above to reload.
        </p>
      ) : images.length === 0 ? (
        <div className="flex flex-col items-center gap-2 border-t border-border py-12 text-center">
          <Container className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No scanned images yet</p>
          <p className="text-xs text-muted-foreground">
            Run a scan to start tracking image health.
          </p>
          <Button asChild size="sm" variant="outline">
            <Link href="/scans/new">Start a scan</Link>
          </Button>
        </div>
      ) : (
        <ResourceList
          bordered={false}
          className="border-t border-border"
          aria-label="Dashboard image health"
        >
          {images.map(renderImageHealthRow)}
        </ResourceList>
      )}
      <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        {error
          ? 'Current image counts unavailable'
          : `Showing ${images.length} of ${pluralize(total, 'image')} · findings from each image’s latest health scan`}
      </div>
    </Card>
  );
}

function renderImageHealthRow(image: ImageOverview) {
  const { host, name } = splitImageRef(image.image_name);
  const needsAttention = image.health_policy_failed || image.health_critical_count > 0;
  return (
    <ResourceList.Item
      key={image.image_name}
      href={`/scans?image=${encodeURIComponent(image.image_name)}`}
      tone={needsAttention ? 'danger' : 'default'}
      media={
        <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-muted/40">
          <Container className="size-4 text-muted-foreground" />
        </span>
      }
      title={name}
      titleTooltip={image.image_name}
      description={[image.health_tag, host, timeAgo(image.latest_scan_at)]
        .filter(Boolean)
        .join(' · ')}
      meta={
        <>
          <SeverityCounts
            critical={image.health_critical_count}
            high={image.health_high_count}
            medium={image.health_medium_count}
            low={image.health_low_count}
            emptyLabel={image.health_status === 'failed' ? 'No results' : 'No findings'}
          />
          <StatusBadge status={image.health_status} externalStatus={image.health_external_status} />
          {image.health_policy_failed ? <StatusTag tone="danger">Policy failed</StatusTag> : null}
        </>
      }
    />
  );
}
