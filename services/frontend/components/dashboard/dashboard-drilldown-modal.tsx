'use client';

import { RecentActivityRange, RecentActivityRangePicker } from '@/components/scans/recent-activity';
import { StatusBadge } from '@/components/ui/badges';
import { RecentScanRowSkeleton } from '@/components/ui/skeleton';
import { Scan, WatchlistItem } from '@/lib/api';
import { timeAgo } from '@/lib/time';
import { getWatchlistPosture } from '@/lib/watchlist-posture';
import { Button, Card, Chip, Link as HeroLink, Modal, useOverlayState } from '@heroui/react';
import { CheckmarkCircle02Icon, Clock01Icon, Shield01Icon } from 'hugeicons-react';

export type DashboardDrilldownKey = 'total' | 'completed' | 'watchlist';

const drilldownHeaderMeta = {
  total: { Icon: Shield01Icon, className: 'bg-default text-foreground' },
  completed: { Icon: CheckmarkCircle02Icon, className: 'bg-success/10 text-success' },
  watchlist: { Icon: Clock01Icon, className: 'bg-warning/10 text-warning' },
} satisfies Record<DashboardDrilldownKey, { Icon: typeof Shield01Icon; className: string }>;

function WatchlistModalRow({ item }: { item: WatchlistItem }) {
  const posture = getWatchlistPosture(item);
  const chipColor =
    posture.tone === 'danger'
      ? 'danger'
      : posture.tone === 'warning'
        ? 'warning'
        : posture.tone === 'success'
          ? 'success'
          : posture.tone === 'accent'
            ? 'accent'
            : 'default';

  return (
    <Card variant="secondary">
      <Card.Content className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="truncate font-mono text-sm text-foreground">
              {item.image_name}:{item.image_tag}
            </p>
            <Chip color={chipColor} size="sm" variant="soft" className="shrink-0">
              {posture.label}
            </Chip>
          </div>
          <p className="mt-1 text-[11px] text-muted">
            {item.enabled ? `Scheduled ${item.schedule}` : 'Paused'} · {item.timezone}
          </p>
          {item.last_scan_id ? (
            <p className="mt-1 text-[11px] text-muted">
              Last scan {timeAgo(item.last_scanned_at ?? item.last_scan?.completed_at)}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
            Quick actions
          </p>
          <div className="flex items-center gap-2">
            <HeroLink href="/watchlist" className="no-underline">
              <Button size="sm" variant="secondary" className="h-8 px-3 text-xs font-medium">
                Open in watchlist
              </Button>
            </HeroLink>
            {item.last_scan_id ? (
              <HeroLink href={`/scans/details/${item.last_scan_id}`} className="no-underline">
                <Button size="sm" variant="primary" className="h-8 px-3 text-xs font-medium">
                  Open last scan
                </Button>
              </HeroLink>
            ) : null}
          </div>
        </div>
      </Card.Content>
    </Card>
  );
}

function WatchlistModalList({
  watchlistError,
  watchlistLoading,
  watchlistItems,
  displayedWatchlistItems,
}: {
  watchlistError: string;
  watchlistLoading: boolean;
  watchlistItems: WatchlistItem[];
  displayedWatchlistItems: WatchlistItem[];
}) {
  if (watchlistError) {
    return (
      <Card variant="secondary">
        <Card.Content className="py-8 text-center text-sm text-danger">
          {watchlistError}
        </Card.Content>
      </Card>
    );
  }

  if (watchlistLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <RecentScanRowSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (watchlistItems.length === 0) {
    return (
      <Card variant="secondary">
        <Card.Content className="py-8 text-center text-sm text-muted">
          No watchlist items in this scope.
        </Card.Content>
      </Card>
    );
  }

  return (
    <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
      {displayedWatchlistItems.map((item) => (
        <WatchlistModalRow key={item.id} item={item} />
      ))}
    </div>
  );
}

function DrilldownPrimaryAction({
  href,
  label,
  onClose,
}: {
  href: string;
  label: string;
  onClose: () => void;
}) {
  return (
    <HeroLink href={href} className="no-underline" onPress={onClose}>
      <Button>{label}</Button>
    </HeroLink>
  );
}

function WatchlistBody({
  watchlistError,
  watchlistLoading,
  watchlistItems,
  displayedWatchlistItems,
}: {
  watchlistError: string;
  watchlistLoading: boolean;
  watchlistItems: WatchlistItem[];
  displayedWatchlistItems: WatchlistItem[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">Prioritized by policy and scan health</p>
        <Chip size="sm" variant="secondary">
          {watchlistItems.length} item{watchlistItems.length === 1 ? '' : 's'}
        </Chip>
      </div>
      <WatchlistModalList
        watchlistError={watchlistError}
        watchlistLoading={watchlistLoading}
        watchlistItems={watchlistItems}
        displayedWatchlistItems={displayedWatchlistItems}
      />
    </div>
  );
}

function formatImageDisplayName(imageName: string): string {
  const slashIndex = imageName.indexOf('/');
  const withoutRegistry = slashIndex >= 0 ? imageName.slice(slashIndex + 1) : imageName;
  const segments = withoutRegistry.split('/').filter(Boolean);
  if (segments.length <= 3) return withoutRegistry;
  return `.../${segments.slice(-3).join('/')}`;
}

function CompactScanRow({ scan, showActions = false }: { scan: Scan; showActions?: boolean }) {
  const eventTime = scan.started_at ?? scan.created_at;
  const displayName = formatImageDisplayName(scan.image_name);

  return (
    <Card variant="secondary">
      <Card.Content className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-5">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <StatusBadge status={scan.status} externalStatus={scan.external_status} />
            <p className="truncate font-mono text-sm text-foreground" title={scan.image_name}>
              {displayName}:{scan.image_tag}
            </p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted">Started {timeAgo(eventTime)}</span>
            {scan.critical_count > 0 && (
              <span
                className="rounded-md px-1.5 py-0.5 text-[10px] font-mono"
                style={{
                  color: '#f87171',
                  background: 'rgba(239,68,68,0.12)',
                  border: '1px solid rgba(239,68,68,0.2)',
                }}
              >
                C:{scan.critical_count}
              </span>
            )}
            {scan.high_count > 0 && (
              <span
                className="rounded-md px-1.5 py-0.5 text-[10px] font-mono"
                style={{
                  color: '#fb923c',
                  background: 'rgba(249,115,22,0.12)',
                  border: '1px solid rgba(249,115,22,0.2)',
                }}
              >
                H:{scan.high_count}
              </span>
            )}
            {scan.medium_count > 0 && (
              <span
                className="rounded-md px-1.5 py-0.5 text-[10px] font-mono"
                style={{
                  color: '#fbbf24',
                  background: 'rgba(245,158,11,0.12)',
                  border: '1px solid rgba(245,158,11,0.2)',
                }}
              >
                M:{scan.medium_count}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {showActions ? (
            <div className="flex items-center gap-2">
              <HeroLink href={`/scans/details/${scan.id}`} className="no-underline">
                <Button size="sm" variant="primary" className="h-8 px-3 text-xs font-medium">
                  Open scan
                </Button>
              </HeroLink>
              <HeroLink href="/scans" className="no-underline">
                <Button size="sm" variant="secondary" className="h-8 px-3 text-xs font-medium">
                  Open in scans
                </Button>
              </HeroLink>
            </div>
          ) : null}
        </div>
      </Card.Content>
    </Card>
  );
}

type DashboardDrilldownModalProps = {
  state: ReturnType<typeof useOverlayState>;
  activeCard: DashboardDrilldownKey | null;
  totalScans: number;
  completedCount: number;
  watchlistCount: number;
  recentActivityRange: RecentActivityRange;
  onRecentActivityRangeChange: (value: RecentActivityRange) => void;
  recentActivityRangeLabel: string;
  scans: Scan[];
  scansLoading: boolean;
  scansError: string;
  watchlistItems: WatchlistItem[];
  watchlistLoading: boolean;
  watchlistError: string;
  recentActivityHref: string;
};

export function DashboardDrilldownModal({
  state,
  activeCard,
  totalScans,
  completedCount,
  watchlistCount,
  recentActivityRange,
  onRecentActivityRangeChange,
  recentActivityRangeLabel,
  scans,
  scansLoading,
  scansError,
  watchlistItems,
  watchlistLoading,
  watchlistError,
  recentActivityHref,
}: DashboardDrilldownModalProps) {
  if (!activeCard) return null;

  const isWatchlist = activeCard === 'watchlist';
  const heading =
    activeCard === 'total'
      ? 'Recent scans'
      : activeCard === 'completed'
        ? 'Completed scans'
        : 'Watchlist';
  const description =
    activeCard === 'total'
      ? `${totalScans.toLocaleString()} total scans overall. Showing activity from ${recentActivityRangeLabel.toLowerCase()}.`
      : activeCard === 'completed'
        ? `${completedCount.toLocaleString()} completed scans overall. Showing completions from ${recentActivityRangeLabel.toLowerCase()}.`
        : `${watchlistCount.toLocaleString()} watchlist item${watchlistCount === 1 ? '' : 's'} in the current scope.`;
  const emptyMessage =
    activeCard === 'completed'
      ? `No completed scans in ${recentActivityRangeLabel.toLowerCase()}.`
      : `No scans started in ${recentActivityRangeLabel.toLowerCase()}.`;
  const primaryHref = isWatchlist ? '/watchlist' : recentActivityHref;
  const primaryLabel = isWatchlist ? 'Open watchlist' : 'Open full list';
  const displayedWatchlistItems = isWatchlist
    ? watchlistItems.toSorted((left, right) => {
        const rank = (item: WatchlistItem) => {
          const kind = getWatchlistPosture(item).kind;
          if (kind === 'blocked') return 0;
          if (kind === 'policy_failed') return 1;
          if (kind === 'scan_failed') return 2;
          if (kind === 'never_scanned') return 3;
          return 4;
        };
        const rankDiff = rank(left) - rank(right);
        if (rankDiff !== 0) return rankDiff;
        const leftTime = Date.parse(left.last_scanned_at ?? left.created_at);
        const rightTime = Date.parse(right.last_scanned_at ?? right.created_at);
        return rightTime - leftTime;
      })
    : [];

  return (
    <Modal state={state}>
      <Modal.Backdrop isDismissable>
        <Modal.Container size="lg" placement="center">
          <Modal.Dialog className="surface-modal overflow-hidden rounded-[28px] w-[min(920px,calc(100vw-1.5rem))] max-w-none">
            <Modal.Header>
              <div className="flex min-w-0 items-start gap-3">
                <Modal.Icon className={drilldownHeaderMeta[activeCard].className}>
                  {(() => {
                    const HeaderIcon = drilldownHeaderMeta[activeCard].Icon;
                    return <HeaderIcon className="size-5" />;
                  })()}
                </Modal.Icon>
                <div>
                  <Modal.Heading className="text-base font-semibold sm:text-lg">
                    {heading}
                  </Modal.Heading>
                  <p className="mt-1 text-sm text-muted">{description}</p>
                </div>
              </div>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="min-h-0 py-5">
              {isWatchlist ? (
                <WatchlistBody
                  watchlistError={watchlistError}
                  watchlistLoading={watchlistLoading}
                  watchlistItems={watchlistItems}
                  displayedWatchlistItems={displayedWatchlistItems}
                />
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <RecentActivityRangePicker
                      value={recentActivityRange}
                      onChange={onRecentActivityRangeChange}
                    />

                    <span className="text-[11px] text-muted">
                      {scans.length} item{scans.length === 1 ? '' : 's'} loaded
                    </span>
                  </div>

                  {scansError ? (
                    <p className="py-8 text-center text-sm" style={{ color: '#f87171' }}>
                      {scansError}
                    </p>
                  ) : scansLoading ? (
                    <div className="space-y-1.5">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <RecentScanRowSkeleton key={index} />
                      ))}
                    </div>
                  ) : scans.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted">{emptyMessage}</p>
                  ) : (
                    <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                      {scans.map((scan) => (
                        <CompactScanRow key={scan.id} scan={scan} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </Modal.Body>
            <Modal.Footer>
              <DrilldownPrimaryAction
                href={primaryHref}
                label={primaryLabel}
                onClose={() => state.close()}
              />
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
