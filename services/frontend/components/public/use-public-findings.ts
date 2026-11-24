'use client';

import type { Vulnerability } from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { isAbortError } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState } from 'react';

export type FindingSortKey =
  'vuln_id' | 'pkg_name' | 'installed_version' | 'fixed_version' | 'severity' | 'cvss_score';

export type FindingQuery = {
  severity: string;
  pkg: string;
  cve: string;
  minCvss: number;
  hasFix: boolean;
  xrayPolicyFirst: boolean;
  sortBy: FindingSortKey;
  sortDir: 'asc' | 'desc';
};

export const DEFAULT_FINDING_QUERY: FindingQuery = {
  severity: '',
  pkg: '',
  cve: '',
  minCvss: 0,
  hasFix: false,
  xrayPolicyFirst: false,
  sortBy: 'severity',
  sortDir: 'asc',
};

export const FINDINGS_PAGE_SIZE = 25;

/**
 * Filter, sort, and page state for a findings list. Text inputs update
 * immediately and are applied to `query` after a short pause.
 */
export function useFindingQuery() {
  const [inputs, setInputs] = useState({ pkg: '', cve: '', minCvss: '' });
  const [query, setQuery] = useState<FindingQuery>(DEFAULT_FINDING_QUERY);
  const [page, setPage] = useState(1);

  const appliedPkg = query.pkg;
  const appliedCve = query.cve;
  useEffect(() => {
    const cve = inputs.cve.trim().toUpperCase();
    if (appliedPkg === inputs.pkg && appliedCve === cve) return;
    const timer = setTimeout(() => {
      setQuery((current) => ({ ...current, pkg: inputs.pkg, cve }));
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [inputs.pkg, inputs.cve, appliedPkg, appliedCve]);

  const update = useCallback((patch: Partial<FindingQuery>) => {
    setQuery((current) => ({ ...current, ...patch }));
    setPage(1);
  }, []);

  const setInput = useCallback(
    (field: 'pkg' | 'cve' | 'minCvss', value: string) => {
      setInputs((current) => ({ ...current, [field]: value }));
      if (field === 'minCvss') {
        const parsed = parseFloat(value);
        update({ minCvss: Number.isNaN(parsed) ? 0 : parsed });
      }
    },
    [update]
  );

  const reset = useCallback(() => {
    setInputs({ pkg: '', cve: '', minCvss: '' });
    setQuery(DEFAULT_FINDING_QUERY);
    setPage(1);
  }, []);

  const activeFilterCount =
    (query.cve ? 1 : 0) +
    (query.minCvss > 0 ? 1 : 0) +
    (query.hasFix ? 1 : 0) +
    (query.xrayPolicyFirst ? 1 : 0) +
    (query.sortBy !== DEFAULT_FINDING_QUERY.sortBy ||
    query.sortDir !== DEFAULT_FINDING_QUERY.sortDir
      ? 1
      : 0);
  const isFiltered = Boolean(
    query.severity || query.pkg || query.cve || query.minCvss > 0 || query.hasFix
  );

  return { inputs, query, page, setPage, update, setInput, reset, activeFilterCount, isFiltered };
}

export type FindingQueryState = ReturnType<typeof useFindingQuery>;

export type FindingsPage = { data: Vulnerability[]; total: number };

/**
 * Loads one page of findings whenever the query, page, or `sourceKey` changes.
 * Keeps the last good rows on screen when a refresh fails.
 */
export function useFindings({
  enabled,
  sourceKey,
  query,
  page,
  load,
  onUnauthorized,
}: {
  enabled: boolean;
  /** Changes when the underlying scan changes (id + status). */
  sourceKey: string;
  query: FindingQuery;
  page: number;
  load: (query: FindingQuery, page: number, signal: AbortSignal) => Promise<FindingsPage>;
  onUnauthorized?: (reason: unknown) => boolean;
}) {
  const [rows, setRows] = useState<Vulnerability[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const loadRef = useRef(load);
  const unauthorizedRef = useRef(onUnauthorized);

  useEffect(() => {
    loadRef.current = load;
    unauthorizedRef.current = onUnauthorized;
  });

  useEffect(() => {
    return deferEffect(() => {
      if (!enabled) return;
      const controller = new AbortController();
      setLoading(true);
      setError('');
      loadRef
        .current(query, page, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setRows(result.data ?? []);
          setTotal(result.total ?? 0);
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted || isAbortError(reason)) return;
          if (unauthorizedRef.current?.(reason)) return;
          setError(reason instanceof Error ? reason.message : 'Failed to load vulnerabilities.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
      return () => controller.abort();
    });
  }, [enabled, sourceKey, query, page, retryKey]);

  const retry = useCallback(() => setRetryKey((current) => current + 1), []);

  return { rows, total, loading, error, retry };
}

export type FindingsState = ReturnType<typeof useFindings>;

/** Fetches every page of a paged findings endpoint (used for client-side filters). */
export async function loadAllFindingPages(
  fetchPage: (page: number, pageSize: number) => Promise<FindingsPage>,
  signal: AbortSignal
): Promise<Vulnerability[]> {
  const pageSize = 100;
  const all: Vulnerability[] = [];
  for (let current = 1; ; current += 1) {
    const result = await fetchPage(current, pageSize);
    if (signal.aborted) return all;
    const rows = result.data ?? [];
    all.push(...rows);
    if (rows.length < pageSize || all.length >= (result.total ?? 0)) return all;
  }
}

export function pageSlice<T>(rows: T[], page: number, pageSize = FINDINGS_PAGE_SIZE) {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

/**
 * Loads one page of findings. ID search and policy-first ordering are not
 * supported by the API, so those load every page and filter here.
 */
export async function loadFindingsPage(
  fetchPage: (page: number, pageSize: number) => Promise<FindingsPage>,
  query: FindingQuery,
  page: number,
  signal: AbortSignal,
  prioritize?: (rows: Vulnerability[]) => Vulnerability[]
): Promise<FindingsPage> {
  const usePolicyOrder = Boolean(query.xrayPolicyFirst && prioritize);
  if (!query.cve && !usePolicyOrder) {
    const result = await fetchPage(page, FINDINGS_PAGE_SIZE);
    return { data: result.data ?? [], total: result.total ?? 0 };
  }
  let rows = await loadAllFindingPages(fetchPage, signal);
  if (query.cve) {
    rows = rows.filter((row) => (row.vuln_id ?? '').toUpperCase().includes(query.cve));
  }
  if (usePolicyOrder && prioritize) rows = prioritize(rows);
  return { data: pageSlice(rows, page), total: rows.length };
}
