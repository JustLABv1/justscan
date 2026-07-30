'use client';

import { ImageOverviewTable } from '@/components/scans/image-overview-table';
import {
  FilterDisclosureTrigger,
  filterDisclosureBodyClassName,
} from '@/components/ui/filter-toolbar';
import { PageContainer, PageTitle } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  getRecentActivityBounds,
  RECENT_ACTIVITY_RANGE_OPTIONS,
  type RecentActivityRange,
} from '@/components/scans/recent-activity';
import { deleteScanImageGroup, listScanImages, type ImageOverview } from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { useToast } from '@/components/toast';
import { parseDate, type DateValue } from '@internationalized/date';
import {
  AlertDialog,
  Button,
  Card,
  DateField,
  DateRangePicker,
  Disclosure,
  Label,
  ListBox,
  Pagination,
  RangeCalendar,
  SearchField,
  Select,
} from '@heroui/react';
import { Clock01Icon, GitCompareIcon, PlusSignIcon, Shield01Icon } from 'hugeicons-react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react';

const PAGE_SIZE = 30;
const STATUS_OPTIONS = [
  { id: '', label: 'Any state' },
  { id: 'failed', label: 'Failed' },
  { id: 'blocked_by_xray_policy', label: 'Blocked by policy' },
  { id: 'running', label: 'Running' },
  { id: 'pending', label: 'Queued' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

type ScanFilters = {
  query: string;
  status: string;
  critical: '' | 'yes' | 'no';
  policy: '' | 'fail';
  range: '' | RecentActivityRange;
  date: string;
  dateTo: string;
  sort: string;
};

type MetricTone = 'default' | 'danger' | 'success';

function Metric({
  label,
  value,
  description,
  icon,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  description?: string;
  icon: ReactNode;
  tone?: MetricTone;
}) {
  return <StatCard label={label} value={value} hint={description} icon={icon} tone={tone} />;
}

function initialScanFilters(searchParams: { get(name: string): string | null }): ScanFilters {
  const range = searchParams.get('range');
  const date = getValidCalendarDate(searchParams.get('date') ?? searchParams.get('from') ?? '');
  const dateTo = getValidCalendarDate(searchParams.get('dateTo') ?? searchParams.get('to') ?? '');
  return {
    query: searchParams.get('q') ?? searchParams.get('image') ?? '',
    status: searchParams.get('status') ?? '',
    critical: (searchParams.get('critical') as ScanFilters['critical']) ?? '',
    policy: (searchParams.get('policy') as ScanFilters['policy']) ?? '',
    range: range === '6h' || range === '24h' || range === '7d' || range === '30d' ? range : '',
    date,
    dateTo: dateTo || date,
    sort: searchParams.get('sort') ?? '',
  };
}

function scanFiltersReducer(
  state: ScanFilters,
  action: Partial<ScanFilters> | 'reset'
): ScanFilters {
  return action === 'reset'
    ? { query: '', status: '', critical: '', policy: '', range: '', date: '', dateTo: '', sort: '' }
    : { ...state, ...action };
}

function getValidCalendarDate(value: string): string {
  try {
    return parseDate(value).toString() === value ? value : '';
  } catch {
    return '';
  }
}

function getScanDateBounds(date: string, dateTo: string): { from: string; to: string } | null {
  const endDate = dateTo || date;
  if (!date || !endDate || endDate < date) return null;

  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(`${endDate}T23:59:59.999Z`);
  if (Number.isNaN(end.getTime())) return null;
  return { from: start.toISOString(), to: end.toISOString() };
}

function ScansPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const [images, setImages] = useState<ImageOverview[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ImageOverview | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page') ?? '1')));
  const [filters, updateFilters] = useReducer(scanFiltersReducer, searchParams, initialScanFilters);
  const { query, status, critical, policy, range, date, dateTo, sort } = filters;
  const toast = useToast();

  const bounds = useMemo(
    () => (date ? getScanDateBounds(date, dateTo) : range ? getRecentActivityBounds(range) : null),
    [date, dateTo, range]
  );
  const selectedDateRange = useMemo<{ start: DateValue; end: DateValue } | null>(() => {
    if (!date) return null;
    const start = getValidCalendarDate(date);
    const end = getValidCalendarDate(dateTo || date);
    return start && end ? { start: parseDate(start), end: parseDate(end) } : null;
  }, [date, dateTo]);
  const activeFilters = Boolean(query || status || critical || policy || range || date || sort);
  const filterCount = [critical, policy, range, date, sort].filter(Boolean).length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const visibleOverview = useMemo(
    () => ({
      critical: images.filter((image) => image.health_critical_count > 0).length,
      policyFailed: images.filter((image) => image.health_policy_failed).length,
      active: images.filter((image) => ['running', 'pending'].includes(image.latest_status)).length,
    }),
    [images]
  );

  const syncRoute = useCallback(() => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (status) params.set('status', status);
    if (critical) params.set('critical', critical);
    if (policy) params.set('policy', policy);
    if (range) params.set('range', range);
    if (date) params.set('date', date);
    if (dateTo && dateTo !== date) params.set('dateTo', dateTo);
    if (sort) params.set('sort', sort);
    if (page > 1) params.set('page', String(page));
    router.replace(params.size ? `/scans?${params}` : '/scans', { scroll: false });
  }, [critical, date, dateTo, page, policy, query, range, router, sort, status]);

  useEffect(() => {
    syncRoute();
  }, [syncRoute]);
  useEffect(
    () => deferEffect(() => setPage(1)),
    [query, status, critical, policy, range, date, dateTo, sort]
  );
  useEffect(
    () =>
      deferEffect(() => {
        let cancelled = false;
        setImages([]);
        setTotal(0);
        setLoading(true);
        setError('');
        void listScanImages(
          page,
          PAGE_SIZE,
          query || undefined,
          status || undefined,
          critical,
          policy,
          bounds?.from,
          bounds?.to,
          sort || undefined
        )
          .then((response) => {
            if (!cancelled) {
              setImages(response.data ?? []);
              setTotal(response.total);
            }
          })
          .catch((reason) => {
            if (!cancelled)
              setError(reason instanceof Error ? reason.message : 'Failed to load scans');
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
        return () => {
          cancelled = true;
        };
      }),
    [bounds?.from, bounds?.to, critical, page, policy, query, refreshKey, scopeKey, sort, status]
  );

  function clearFilters() {
    updateFilters('reset');
  }

  async function confirmDeleteImage() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const result = await deleteScanImageGroup(pendingDelete.image_name);
      toast.success(
        `Deleted ${result.deleted} scan${result.deleted === 1 ? '' : 's'} and all image tags`
      );
      setPendingDelete(null);
      if (images.length === 1 && page > 1) {
        setPage((current) => current - 1);
      } else {
        setRefreshKey((current) => current + 1);
      }
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Failed to delete scan group');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <PageContainer>
      <PageTitle
        title="Scans"
        description={total === 1 ? '1 scanned image' : `${total} scanned images`}
        actions={
          <>
            <Button onPress={() => router.push('/scans/compare')} variant="secondary">
              <GitCompareIcon size={16} />
              Compare
            </Button>
            <Button onPress={() => router.push('/scans/new')}>
              <PlusSignIcon size={16} />
              New scan
            </Button>
          </>
        }
      />
      <AlertDialog
        isOpen={Boolean(pendingDelete)}
        onOpenChange={(isOpen) => {
          if (!isOpen && !deleting) setPendingDelete(null);
        }}
      >
        <AlertDialog.Backdrop variant="blur">
          <AlertDialog.Container placement="center">
            <AlertDialog.Dialog className="sm:max-w-[440px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>Delete image scan group?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm leading-6 text-muted">
                  This removes <strong>{pendingDelete?.image_name}</strong>, including all{' '}
                  {pendingDelete?.tag_count ?? 0} tags and {pendingDelete?.scan_count ?? 0} scan
                  runs in this workspace. This cannot be undone.
                </p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button isDisabled={deleting} slot="close" variant="tertiary">
                  Cancel
                </Button>
                <Button
                  isPending={deleting}
                  onPress={() => void confirmDeleteImage()}
                  variant="danger"
                >
                  Delete image group
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-2">
        <Metric
          description="Current filter scope"
          icon={<Shield01Icon size={16} />}
          label="Matching images"
          value={total}
        />
        <Metric
          description="On this page"
          icon={<Shield01Icon size={16} />}
          label="Critical risk"
          tone="danger"
          value={visibleOverview.critical}
        />
        <Metric
          description="On this page"
          icon={<Shield01Icon size={16} />}
          label="Policy failed"
          tone="danger"
          value={visibleOverview.policyFailed}
        />
        <Metric
          description="Running or queued"
          icon={<Clock01Icon size={16} />}
          label="Active scans"
          value={visibleOverview.active}
        />
      </div>
      <Card className="p-3">
        <Disclosure className="w-full">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <SearchField
              aria-label="Search images, tags, or labels"
              className="min-w-0 flex-1"
              value={query}
              onChange={(value) => updateFilters({ query: value })}
              variant="secondary"
            >
              <Label className="sr-only">Search images, tags, or labels</Label>
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Search images, tags, or labels…" />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <Select
              aria-label="Latest state"
              className="min-w-[180px]"
              value={status || '__all__'}
              onChange={(value) =>
                updateFilters({ status: value === '__all__' ? '' : String(value ?? '') })
              }
              variant="secondary"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {STATUS_OPTIONS.map((option) => (
                    <ListBox.Item key={option.id || '__all__'} id={option.id || '__all__'}>
                      {option.label}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <Select
              aria-label="Current risk"
              className="min-w-[170px]"
              value={critical || '__all__'}
              onChange={(value) =>
                updateFilters({
                  critical: (value === '__all__'
                    ? ''
                    : String(value ?? '')) as ScanFilters['critical'],
                })
              }
              variant="secondary"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="__all__">Any risk</ListBox.Item>
                  <ListBox.Item id="yes">Has critical</ListBox.Item>
                  <ListBox.Item id="no">No critical</ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
            <FilterDisclosureTrigger activeCount={filterCount} label="More filters" />
          </div>
          <Disclosure.Content>
            <Disclosure.Body className={filterDisclosureBodyClassName}>
              <Select
                aria-label="Time range"
                className="min-w-[180px] flex-1"
                value={range || '__all__'}
                onChange={(value) =>
                  updateFilters({
                    range: (value === '__all__' ? '' : String(value ?? '')) as ScanFilters['range'],
                    date: '',
                    dateTo: '',
                  })
                }
                variant="secondary"
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="__all__">All time</ListBox.Item>
                    {RECENT_ACTIVITY_RANGE_OPTIONS.map((option) => (
                      <ListBox.Item key={option.id} id={option.id}>
                        {option.label}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <DateRangePicker
                aria-label="Scan date range"
                className="min-w-[280px] flex-1"
                value={selectedDateRange}
                onChange={(value) =>
                  updateFilters({
                    date: value?.start.toString() ?? '',
                    dateTo: value?.end.toString() ?? '',
                    range: '',
                  })
                }
              >
                <Label className="sr-only">Scan date range</Label>
                <DateField.Group fullWidth variant="secondary">
                  <DateField.Input slot="start">
                    {(segment) => <DateField.Segment segment={segment} />}
                  </DateField.Input>
                  <DateRangePicker.RangeSeparator />
                  <DateField.Input slot="end">
                    {(segment) => <DateField.Segment segment={segment} />}
                  </DateField.Input>
                  <DateField.Suffix>
                    <DateRangePicker.Trigger>
                      <DateRangePicker.TriggerIndicator />
                    </DateRangePicker.Trigger>
                  </DateField.Suffix>
                </DateField.Group>
                <DateRangePicker.Popover>
                  <RangeCalendar aria-label="Scan date range">
                    <RangeCalendar.Header>
                      <RangeCalendar.YearPickerTrigger>
                        <RangeCalendar.YearPickerTriggerHeading />
                        <RangeCalendar.YearPickerTriggerIndicator />
                      </RangeCalendar.YearPickerTrigger>
                      <RangeCalendar.NavButton slot="previous" />
                      <RangeCalendar.NavButton slot="next" />
                    </RangeCalendar.Header>
                    <RangeCalendar.Grid>
                      <RangeCalendar.GridHeader>
                        {(day) => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}
                      </RangeCalendar.GridHeader>
                      <RangeCalendar.GridBody>
                        {(calendarDate) => <RangeCalendar.Cell date={calendarDate} />}
                      </RangeCalendar.GridBody>
                    </RangeCalendar.Grid>
                  </RangeCalendar>
                </DateRangePicker.Popover>
              </DateRangePicker>
              <Select
                aria-label="Policy result"
                className="min-w-[180px] flex-1"
                value={policy || '__all__'}
                onChange={(value) =>
                  updateFilters({
                    policy: (value === '__all__'
                      ? ''
                      : String(value ?? '')) as ScanFilters['policy'],
                  })
                }
                variant="secondary"
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="__all__">Any policy result</ListBox.Item>
                    <ListBox.Item id="fail">Policy failed</ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              <Select
                aria-label="Sort images"
                className="min-w-[180px] flex-1"
                value={sort || '__default__'}
                onChange={(value) =>
                  updateFilters({ sort: value === '__default__' ? '' : String(value ?? '') })
                }
                variant="secondary"
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="__default__">Last scanned</ListBox.Item>
                    <ListBox.Item id="risk_desc">Highest risk</ListBox.Item>
                    <ListBox.Item id="scan_count_desc">Most scans</ListBox.Item>
                    <ListBox.Item id="image_asc">Image name</ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              {activeFilters ? (
                <Button onPress={clearFilters} size="sm" variant="tertiary">
                  Clear filters
                </Button>
              ) : null}
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>
      </Card>
      {error ? <Card className="border-danger/40 p-4 text-sm text-danger">{error}</Card> : null}
      <Card className="overflow-hidden">
        <ImageOverviewTable
          hasActiveFilters={activeFilters}
          images={images}
          loading={loading}
          onDeleteImage={setPendingDelete}
        />
      </Card>
      {total > 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">
            Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} of {total}{' '}
            images
          </p>
          {totalPages > 1 ? (
            <Pagination size="sm">
              <Pagination.Content>
                <Pagination.Item>
                  <Pagination.Previous
                    isDisabled={page === 1}
                    onPress={() => setPage((value) => value - 1)}
                  >
                    <Pagination.PreviousIcon />
                  </Pagination.Previous>
                </Pagination.Item>
                {Array.from({ length: totalPages }, (_, index) => index + 1)
                  .slice(Math.max(0, page - 3), page + 2)
                  .map((value) => (
                    <Pagination.Item key={value}>
                      <Pagination.Link isActive={value === page} onPress={() => setPage(value)}>
                        {value}
                      </Pagination.Link>
                    </Pagination.Item>
                  ))}
                <Pagination.Item>
                  <Pagination.Next
                    isDisabled={page === totalPages}
                    onPress={() => setPage((value) => value + 1)}
                  >
                    <Pagination.NextIcon />
                  </Pagination.Next>
                </Pagination.Item>
              </Pagination.Content>
            </Pagination>
          ) : null}
        </div>
      ) : null}
    </PageContainer>
  );
}

export default function ScansPage() {
  return (
    <Suspense
      fallback={
        <PageContainer>
          <Card className="h-64 animate-pulse">
            <div />
          </Card>
        </PageContainer>
      }
    >
      <ScansPageContent />
    </Suspense>
  );
}
