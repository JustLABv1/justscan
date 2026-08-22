'use client';

import { IntelligenceSummaryChip } from '@/components/vulnerability-intelligence-status';
import { SevCount, StatusBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import type { ImageOverview } from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
import { Chip, Table } from '@heroui/react';
import { ArrowRight01Icon, Delete01Icon, Shield01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

function imageHref(imageName: string) {
  return `/scans/images/${imageName.split('/').map(encodeURIComponent).join('/')}`;
}

function ImageName({ imageName }: { imageName: string }) {
  const parts = imageName.split('/');
  const host = parts[0] ?? '';
  const hasHost =
    parts.length > 1 && (host.includes('.') || host.includes(':') || host === 'localhost');
  const repository = hasHost ? parts.slice(1).join('/') : imageName;

  return (
    <div className="w-max min-w-0 max-w-[40rem]" title={imageName}>
      <p className="break-words font-mono text-sm font-medium leading-5 text-foreground">
        {repository}
      </p>
      {hasHost ? (
        <p className="mt-0.5 break-words font-mono text-xs leading-4 text-muted">{host}</p>
      ) : null}
    </div>
  );
}

export function ImageOverviewTable({
  images,
  loading,
  hasActiveFilters,
  onDeleteImage,
  queuedImageNames,
}: {
  images: ImageOverview[];
  loading: boolean;
  hasActiveFilters: boolean;
  onDeleteImage: (image: ImageOverview) => void;
  queuedImageNames?: ReadonlySet<string>;
}) {
  const router = useRouter();

  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label="Scanned images" className="min-w-[960px] table-auto">
          <Table.Header>
            <Table.Column isRowHeader className="w-px min-w-[20rem] max-w-[40rem]">
              Image
            </Table.Column>
            <Table.Column>Current health</Table.Column>
            <Table.Column>Findings</Table.Column>
            <Table.Column className="w-[7.5rem] min-w-[7.5rem] whitespace-nowrap">
              Tags &amp; runs
            </Table.Column>
            <Table.Column>Last scanned</Table.Column>
            <Table.Column>Actions</Table.Column>
          </Table.Header>
          <Table.Body>
            {loading ? (
              Array.from({ length: 6 }, (_, index) => (
                <Table.Row id={`loading-${index}`} key={`loading-${index}`}>
                  <Table.Cell colSpan={6}>
                    <div className="h-14 animate-pulse rounded-lg bg-surface-secondary" />
                  </Table.Cell>
                </Table.Row>
              ))
            ) : images.length === 0 ? (
              <Table.Row id="empty">
                <Table.Cell colSpan={6}>
                  <div className="py-8">
                    <EmptyState
                      icon={<Shield01Icon size={28} />}
                      title={hasActiveFilters ? 'No images match your filters' : 'No scans yet'}
                      description={
                        hasActiveFilters
                          ? 'Adjust or clear the filters to widen the results.'
                          : 'Run a scan to start tracking image health.'
                      }
                    />
                  </div>
                </Table.Cell>
              </Table.Row>
            ) : (
              <Table.Collection items={images}>
                {(image) => {
                  const href = imageHref(image.image_name);
                  const deletionQueued = queuedImageNames?.has(image.image_name) ?? false;
                  return (
                    <Table.Row id={image.image_name} className="group">
                      <Table.Cell className="w-px min-w-[20rem] max-w-[40rem] align-top">
                        <Link
                          href={href}
                          className="block rounded-lg -mx-2 -my-1 px-2 py-1 hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent"
                        >
                          <ImageName imageName={image.image_name} />
                          {deletionQueued ? (
                            <Chip className="mt-2" color="warning" size="sm" variant="soft">
                              Deletion queued
                            </Chip>
                          ) : null}
                        </Link>
                      </Table.Cell>
                      <Table.Cell>
                        <Link
                          href={href}
                          className="block min-w-0 rounded-lg -mx-2 -my-1 px-2 py-1 hover:bg-surface-secondary"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge
                              status={image.health_status}
                              externalStatus={image.health_external_status}
                            />
                            {image.health_policy_failed ? (
                              <Chip color="danger" size="sm" variant="soft">
                                Policy failed
                              </Chip>
                            ) : null}
                            <IntelligenceSummaryChip compact summary={image.intelligence_summary} />
                          </div>
                          <p
                            className="mt-1 truncate font-mono text-xs text-muted"
                            title={`Tag: ${image.health_tag}`}
                          >
                            Tag: {image.health_tag}
                          </p>
                        </Link>
                      </Table.Cell>
                      <Table.Cell>
                        <Link
                          href={href}
                          className="flex gap-1.5 rounded-lg -mx-2 -my-1 px-2 py-1 hover:bg-surface-secondary"
                        >
                          <SevCount count={image.health_critical_count} level="critical" />
                          <SevCount count={image.health_high_count} level="high" />
                          <SevCount count={image.health_medium_count} level="medium" />
                          <SevCount count={image.health_low_count} level="low" />
                        </Link>
                      </Table.Cell>
                      <Table.Cell className="w-[7.5rem] min-w-[7.5rem] whitespace-nowrap">
                        <Link
                          href={href}
                          className="block rounded-lg -mx-2 -my-1 px-2 py-1 hover:bg-surface-secondary"
                        >
                          <p className="whitespace-nowrap text-sm font-medium">
                            {image.tag_count} tag{image.tag_count === 1 ? '' : 's'}
                          </p>
                          <p className="mt-1 whitespace-nowrap text-xs text-muted">
                            {image.scan_count} run{image.scan_count === 1 ? '' : 's'}
                          </p>
                        </Link>
                      </Table.Cell>
                      <Table.Cell>
                        <Link
                          href={href}
                          className="block min-w-0 rounded-lg -mx-2 -my-1 px-2 py-1 hover:bg-surface-secondary"
                          title={fullDate(image.latest_scan_at)}
                        >
                          <p className="text-sm">{timeAgo(image.latest_scan_at)}</p>
                          <p
                            className="mt-1 truncate font-mono text-xs text-muted"
                            title={image.latest_tag}
                          >
                            {image.latest_tag}
                          </p>
                        </Link>
                      </Table.Cell>
                      <Table.Cell onClick={(event) => event.stopPropagation()}>
                        <div className="flex justify-end">
                          <RowActionsMenu
                            label={`Open actions menu for ${image.image_name}`}
                            items={[
                              {
                                id: 'open',
                                label: 'Open image',
                                icon: <ArrowRight01Icon size={14} aria-hidden />,
                                onAction: () => router.push(href),
                              },
                              {
                                id: 'delete',
                                label: deletionQueued ? 'Deletion queued' : 'Delete image group',
                                icon: <Delete01Icon size={14} aria-hidden />,
                                variant: 'danger',
                                disabled: deletionQueued,
                                onAction: () => onDeleteImage(image),
                              },
                            ]}
                          />
                        </div>
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
