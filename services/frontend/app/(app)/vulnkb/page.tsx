'use client';

import { StatusAlert } from '@/components/ui/form-alert';
import { PageHeader } from '@/components/ui/page-header';
import {
  CVSS_OPTIONS,
  PUBLISHED_OPTIONS,
  SEV_OPTIONS,
  VulnerabilityKBFilters,
} from '@/components/vulnkb/vulnerability-kb-filters';
import { VulnerabilityKBTable } from '@/components/vulnkb/vulnerability-kb-table';
import { listKBEntries, type VulnKBEntry } from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { Spinner } from '@heroui/react';
import { InformationCircleIcon } from 'hugeicons-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

const LIMIT = 10;

type VulnKBState = {
  entries: VulnKBEntry[];
  total: number;
  page: number;
  loading: boolean;
  error: string;
  query: string;
  queryInput: string;
  severity: string;
  minCvss: string;
  exploitOnly: boolean;
  publishedRange: string;
  showFilters: boolean;
};

type VulnKBAction =
  | { type: 'load-start' }
  | { type: 'load-success'; entries: VulnKBEntry[]; total: number }
  | { type: 'load-error'; error: string }
  | { type: 'set-query-input'; value: string }
  | { type: 'apply-query'; value: string }
  | { type: 'set-severity'; value: string }
  | { type: 'set-min-cvss'; value: string }
  | { type: 'set-exploit'; value: boolean }
  | { type: 'set-published-range'; value: string }
  | { type: 'set-page'; value: number }
  | { type: 'set-show-filters'; value: boolean }
  | { type: 'clear-filters' };

function vulnKBReducer(state: VulnKBState, action: VulnKBAction): VulnKBState {
  switch (action.type) {
    case 'load-start':
      return { ...state, loading: true, error: '' };
    case 'load-success':
      return { ...state, entries: action.entries, total: action.total, loading: false };
    case 'load-error':
      return { ...state, entries: [], total: 0, loading: false, error: action.error };
    case 'set-query-input':
      return { ...state, queryInput: action.value };
    case 'apply-query':
      return { ...state, query: action.value, page: 1 };
    case 'set-severity':
      return { ...state, severity: action.value, page: 1 };
    case 'set-min-cvss':
      return { ...state, minCvss: action.value, page: 1 };
    case 'set-exploit':
      return { ...state, exploitOnly: action.value, page: 1 };
    case 'set-published-range':
      return { ...state, publishedRange: action.value, page: 1 };
    case 'set-page':
      return { ...state, page: action.value };
    case 'set-show-filters':
      return { ...state, showFilters: action.value };
    case 'clear-filters':
      return {
        ...state,
        severity: '',
        minCvss: '0',
        exploitOnly: false,
        publishedRange: '',
        page: 1,
      };
    default:
      return state;
  }
}

function publishedAfterDate(value: string): string | undefined {
  if (!value) return undefined;
  const now = new Date();
  switch (value) {
    case '30d':
      now.setDate(now.getDate() - 30);
      break;
    case '90d':
      now.setDate(now.getDate() - 90);
      break;
    case '1y':
      now.setFullYear(now.getFullYear() - 1);
      break;
    default:
      return undefined;
  }
  return now.toISOString();
}

function parsePage(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function VulnKBPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, dispatch] = useReducer(vulnKBReducer, {
    entries: [],
    total: 0,
    page: parsePage(searchParams.get('page')),
    loading: true,
    error: '',
    query: searchParams.get('q') ?? '',
    queryInput: searchParams.get('q') ?? '',
    severity: searchParams.get('severity') ?? '',
    minCvss: searchParams.get('min_cvss') ?? '0',
    exploitOnly: searchParams.get('exploit') === 'true',
    publishedRange: searchParams.get('published') ?? '',
    showFilters: false,
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const totalPages = Math.max(1, Math.ceil(state.total / LIMIT));

  const replaceUrl = useCallback(
    (
      overrides: Partial<
        Pick<
          VulnKBState,
          'query' | 'severity' | 'minCvss' | 'exploitOnly' | 'publishedRange' | 'page'
        >
      > = {}
    ) => {
      const nextQuery = overrides.query ?? state.query;
      const nextSeverity = overrides.severity ?? state.severity;
      const nextMinCvss = overrides.minCvss ?? state.minCvss;
      const nextExploitOnly = overrides.exploitOnly ?? state.exploitOnly;
      const nextPublishedRange = overrides.publishedRange ?? state.publishedRange;
      const nextPage = overrides.page ?? state.page;
      const nextParams = new URLSearchParams();
      if (nextQuery) nextParams.set('q', nextQuery);
      if (nextSeverity) nextParams.set('severity', nextSeverity);
      if (nextMinCvss !== '0') nextParams.set('min_cvss', nextMinCvss);
      if (nextExploitOnly) nextParams.set('exploit', 'true');
      if (nextPublishedRange) nextParams.set('published', nextPublishedRange);
      if (nextPage > 1) nextParams.set('page', String(nextPage));
      const nextQueryString = nextParams.toString();
      router.replace(`/vulnkb${nextQueryString ? `?${nextQueryString}` : ''}`, { scroll: false });
    },
    [router, state]
  );

  const load = useCallback(async () => {
    dispatch({ type: 'load-start' });
    try {
      const response = await listKBEntries(
        state.query || undefined,
        state.severity || undefined,
        state.page,
        LIMIT,
        state.exploitOnly || undefined,
        Number(state.minCvss) || undefined,
        publishedAfterDate(state.publishedRange)
      );
      dispatch({ type: 'load-success', entries: response.data ?? [], total: response.total ?? 0 });
    } catch (reason: unknown) {
      dispatch({
        type: 'load-error',
        error: reason instanceof Error ? reason.message : 'Failed to load KB',
      });
    }
  }, [
    state.exploitOnly,
    state.minCvss,
    state.page,
    state.publishedRange,
    state.query,
    state.severity,
  ]);

  useEffect(() => deferEffect(load), [load]);
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  const paginationItems = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
    const items: Array<number | 'ellipsis'> = [1];
    if (state.page > 3) items.push('ellipsis');
    const start = Math.max(2, state.page - 1);
    const end = Math.min(totalPages - 1, state.page + 1);
    for (let page = start; page <= end; page += 1) items.push(page);
    if (state.page < totalPages - 2) items.push('ellipsis');
    items.push(totalPages);
    return items;
  }, [state.page, totalPages]);

  const activeFilters = [
    state.severity ? SEV_OPTIONS.find((option) => option.id === state.severity)?.label : '',
    state.minCvss !== '0' ? `CVSS ≥ ${state.minCvss}` : '',
    state.exploitOnly ? 'Exploit Only' : '',
    state.publishedRange
      ? PUBLISHED_OPTIONS.find((option) => option.id === state.publishedRange)?.label
      : '',
  ].filter((value): value is string => Boolean(value));

  const handleQueryInputChange = (value: string) => {
    dispatch({ type: 'set-query-input', value });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const nextQuery = value.trim();
      dispatch({ type: 'apply-query', value: nextQuery });
      replaceUrl({ query: nextQuery, page: 1 });
    }, 350);
  };

  const handleSeverityChange = (value: string) => {
    dispatch({ type: 'set-severity', value });
    replaceUrl({ severity: value, page: 1 });
  };

  const handleMinCvssChange = (value: string) => {
    dispatch({ type: 'set-min-cvss', value });
    replaceUrl({ minCvss: value, page: 1 });
  };

  const handlePublishedRangeChange = (value: string) => {
    dispatch({ type: 'set-published-range', value });
    replaceUrl({ publishedRange: value, page: 1 });
  };

  const handleExploitChange = (value: boolean) => {
    dispatch({ type: 'set-exploit', value });
    replaceUrl({ exploitOnly: value, page: 1 });
  };

  const goToPage = (nextPage: number) => {
    const boundedPage = Math.max(1, Math.min(totalPages, nextPage));
    dispatch({ type: 'set-page', value: boundedPage });
    replaceUrl({ page: boundedPage });
  };

  const clearFilters = () => {
    dispatch({ type: 'clear-filters' });
    replaceUrl({ severity: '', minCvss: '0', exploitOnly: false, publishedRange: '', page: 1 });
  };

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="Vulnerability Knowledge Base"
        description="Explore CVE records, source changes, and the exposure that is visible in your scans."
      />

      <VulnerabilityKBFilters
        queryInput={state.queryInput}
        severity={state.severity}
        minCvss={state.minCvss}
        exploitOnly={state.exploitOnly}
        publishedRange={state.publishedRange}
        showFilters={state.showFilters}
        activeFilters={activeFilters}
        onQueryInputChange={handleQueryInputChange}
        onSeverityChange={handleSeverityChange}
        onMinCvssChange={handleMinCvssChange}
        onExploitChange={handleExploitChange}
        onPublishedRangeChange={handlePublishedRangeChange}
        onShowFiltersChange={(value) => dispatch({ type: 'set-show-filters', value })}
        onClearFilters={clearFilters}
      />

      {state.error ? (
        <StatusAlert
          status="danger"
          title="Vulnerability knowledge base failed to load"
          description={state.error}
        />
      ) : null}

      <VulnerabilityKBTable
        entries={state.entries}
        loading={state.loading}
        total={state.total}
        page={state.page}
        totalPages={totalPages}
        paginationItems={paginationItems}
        onRowOpen={(vulnId) => router.push(`/vulnkb/${encodeURIComponent(vulnId)}`)}
        onPageChange={goToPage}
      />

      <p className="flex items-center gap-1.5 text-xs text-zinc-400">
        <InformationCircleIcon size={13} />
        Select a CVE to view its source timeline, references, and authorized scan exposure.
      </p>
    </div>
  );
}

export default function VulnKBPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-64 items-center justify-center">
          <Spinner color="accent" size="sm" />
        </div>
      }
    >
      <VulnKBPageContent />
    </Suspense>
  );
}
