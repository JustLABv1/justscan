'use client';

import { SevCount, StatusBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import type { ImageOverview } from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
import { Chip, Table } from '@heroui/react';
import { ArrowRight01Icon, Shield01Icon } from 'hugeicons-react';
import Link from 'next/link';

function imageHref(imageName: string) {
  return `/scans/images/${imageName.split('/').map(encodeURIComponent).join('/')}`;
}

function ImageName({ imageName }: { imageName: string }) {
  const parts = imageName.split('/');
  const host = parts[0] ?? '';
  const hasHost = parts.length > 1 && (host.includes('.') || host.includes(':') || host === 'localhost');
  const repository = hasHost ? parts.slice(1).join('/') : imageName;

  return (
    <div className="min-w-0">
      <p className="break-all font-mono text-sm font-medium text-foreground">{repository}</p>
      {hasHost ? <p className="mt-0.5 break-all font-mono text-xs text-muted">{host}</p> : null}
    </div>
  );
}

export function ImageOverviewTable({
  images,
  loading,
  hasActiveFilters,
}: {
  images: ImageOverview[];
  loading: boolean;
  hasActiveFilters: boolean;
}) {
  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="Scanned images" className="min-w-[900px]">
          <Table.Header>
            <Table.Column isRowHeader>Image</Table.Column>
            <Table.Column>Current health</Table.Column>
            <Table.Column>Findings</Table.Column>
            <Table.Column>Tags &amp; runs</Table.Column>
            <Table.Column>Last scanned</Table.Column>
            <Table.Column>Actions</Table.Column>
          </Table.Header>
          <Table.Body>
            {loading ? (
              Array.from({ length: 6 }, (_, index) => (
                <Table.Row id={`loading-${index}`} key={`loading-${index}`}>
                  <Table.Cell colSpan={6}><div className="h-14 animate-pulse rounded-lg bg-surface-secondary" /></Table.Cell>
                </Table.Row>
              ))
            ) : images.length === 0 ? (
              <Table.Row id="empty">
                <Table.Cell colSpan={6}>
                  <div className="py-8">
                    <EmptyState
                      icon={<Shield01Icon size={28} />}
                      title={hasActiveFilters ? 'No images match your filters' : 'No scans yet'}
                      description={hasActiveFilters ? 'Adjust or clear the filters to widen the results.' : 'Run a scan to start tracking image health.'}
                    />
                  </div>
                </Table.Cell>
              </Table.Row>
            ) : (
              <Table.Collection items={images}>
                {(image) => {
                  const href = imageHref(image.image_name);
                  return (
                    <Table.Row id={image.image_name} className="group">
                      <Table.Cell>
                        <Link href={href} className="block rounded-lg -mx-2 -my-1 px-2 py-1 hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent">
                          <ImageName imageName={image.image_name} />
                        </Link>
                      </Table.Cell>
                      <Table.Cell>
                        <Link href={href} className="block rounded-lg -mx-2 -my-1 px-2 py-1 hover:bg-surface-secondary">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={image.health_status} externalStatus={image.health_external_status} />
                            {image.health_policy_failed ? <Chip color="danger" size="sm" variant="soft">Policy failed</Chip> : null}
                          </div>
                          <p className="mt-1 font-mono text-xs text-muted">Tag: {image.health_tag}</p>
                        </Link>
                      </Table.Cell>
                      <Table.Cell>
                        <Link href={href} className="flex gap-1.5 rounded-lg -mx-2 -my-1 px-2 py-1 hover:bg-surface-secondary">
                          <SevCount count={image.health_critical_count} level="critical" />
                          <SevCount count={image.health_high_count} level="high" />
                          <SevCount count={image.health_medium_count} level="medium" />
                          <SevCount count={image.health_low_count} level="low" />
                        </Link>
                      </Table.Cell>
                      <Table.Cell>
                        <Link href={href} className="block rounded-lg -mx-2 -my-1 px-2 py-1 hover:bg-surface-secondary">
                          <p className="text-sm font-medium">{image.tag_count} tag{image.tag_count === 1 ? '' : 's'}</p>
                          <p className="mt-1 text-xs text-muted">{image.scan_count} run{image.scan_count === 1 ? '' : 's'}</p>
                        </Link>
                      </Table.Cell>
                      <Table.Cell>
                        <Link href={href} className="block rounded-lg -mx-2 -my-1 px-2 py-1 hover:bg-surface-secondary" title={fullDate(image.latest_scan_at)}>
                          <p className="text-sm">{timeAgo(image.latest_scan_at)}</p>
                          <p className="mt-1 font-mono text-xs text-muted">{image.latest_tag}</p>
                        </Link>
                      </Table.Cell>
                      <Table.Cell>
                        <Link aria-label={`Open ${image.image_name}`} href={href} className="inline-flex rounded-lg p-2 text-muted transition-colors hover:bg-surface-secondary hover:text-accent">
                          <ArrowRight01Icon size={17} />
                        </Link>
                      </Table.Cell>
                    </Table.Row>
                  );
                }}
              </Table.Collection>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
