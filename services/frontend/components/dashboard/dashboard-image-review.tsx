'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Container } from 'lucide-react';
import { Button, Card, Chip, Table } from '@/components/ui';
import { StatusBadge } from '@/components/ui/badges';
import { StatusAlert } from '@/components/ui/form-alert';
import { useWorkScope } from '@/hooks/use-work-scope';
import { useConditionalInterval } from '@/hooks/use-conditional-interval';
import { listScanImages, type ImageOverview } from '@/lib/api';
import { isAbortError } from '@/lib/utils';
import { fullDate, timeAgo } from '@/lib/time';

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
      <Table>
        <Table.ScrollContainer className="rounded-none border-x-0 border-b-0">
          <Table.Content
            aria-label="Dashboard image health"
            className="min-w-[680px] table-fixed [&_td]:px-4 [&_td]:py-3 [&_th]:px-4"
          >
            <Table.Header>
              <Table.Column isRowHeader className="w-auto">
                Image
              </Table.Column>
              <Table.Column className="w-[200px]">Findings</Table.Column>
              <Table.Column className="w-[150px]">State</Table.Column>
              <Table.Column className="w-[110px]">Last scan</Table.Column>
            </Table.Header>
            <Table.Body>
              {loading ? (
                Array.from({ length: 5 }, (_, i) => (
                  <Table.Row key={i} id={`loading-${i}`}>
                    <Table.Cell colSpan={4}>
                      <div className="h-9 animate-pulse rounded bg-muted" />
                    </Table.Cell>
                  </Table.Row>
                ))
              ) : error && images.length === 0 ? (
                <Table.Row id="unavailable">
                  <Table.Cell colSpan={4}>
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      Image health is unavailable. Retry above to reload.
                    </p>
                  </Table.Cell>
                </Table.Row>
              ) : images.length === 0 ? (
                <Table.Row id="empty">
                  <Table.Cell colSpan={4}>
                    <div className="flex flex-col items-center gap-2 py-12 text-center">
                      <Container className="size-6 text-muted-foreground" />
                      <p className="text-sm font-medium">No scanned images yet</p>
                      <p className="text-xs text-muted-foreground">
                        Run a scan to start tracking image health.
                      </p>
                      <Button asChild size="sm" variant="outline">
                        <Link href="/scans/new">Start a scan</Link>
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ) : (
                images.map(renderImageHealthRow)
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        {error
          ? 'Current image counts unavailable'
          : `Showing ${images.length} of ${total} images · Rated findings from each image’s health scan.`}
      </div>
    </Card>
  );
}

function renderImageHealthRow(image: ImageOverview) {
  const counts = [
    image.health_critical_count,
    image.health_high_count,
    image.health_medium_count,
    image.health_low_count,
  ];
  const total = counts.reduce((sum, count) => sum + count, 0);
  const colors = [
    'var(--destructive)',
    'var(--color-orange-500)',
    'var(--warning)',
    'var(--color-blue-500)',
  ];
  const label = `${counts[0]} critical, ${counts[1]} high, ${counts[2]} medium, ${counts[3]} low`;
  return (
    <Table.Row key={image.image_name} id={image.image_name} textValue={image.image_name}>
      <Table.Cell>
        <Link
          href={`/scans?image=${encodeURIComponent(image.image_name)}`}
          className="flex min-w-0 items-center gap-2 rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
            <Container className="size-4 text-muted-foreground" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium" title={image.image_name}>
              {image.image_name}
            </span>
            <span className="block truncate font-mono text-xs text-muted-foreground">
              {image.health_tag} · {image.tag_count} tags
            </span>
          </span>
        </Link>
      </Table.Cell>
      <Table.Cell>
        <p className="text-xs tabular-nums" title={label}>
          <span
            className={
              counts[0] + counts[1] > 0 ? 'font-medium text-destructive' : 'text-foreground'
            }
          >
            {counts[0] + counts[1]} critical + high
          </span>
          <span className="ml-2 text-muted-foreground">{total} rated</span>
        </p>
        <div
          role="img"
          aria-label={label}
          className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted"
        >
          {counts.map((count, i) =>
            count > 0 ? (
              <span
                key={i}
                style={{ width: `${(count / total) * 100}%`, backgroundColor: colors[i] }}
              />
            ) : null
          )}
        </div>
      </Table.Cell>
      <Table.Cell>
        <div className="flex flex-wrap gap-1">
          <StatusBadge status={image.health_status} externalStatus={image.health_external_status} />
          {image.health_policy_failed ? (
            <Chip size="sm" color="danger" variant="soft">
              Policy failed
            </Chip>
          ) : null}
        </div>
      </Table.Cell>
      <Table.Cell>
        <span className="text-xs text-muted-foreground" title={fullDate(image.latest_scan_at)}>
          {timeAgo(image.latest_scan_at)}
        </span>
      </Table.Cell>
    </Table.Row>
  );
}
