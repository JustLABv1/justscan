'use client';
import { useWorkScope } from '@/hooks/use-work-scope';
import { search, SearchImageResult, SearchScanResult, SearchVulnResult } from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { Card, Chip, Kbd, SearchField, Spinner } from '@heroui/react';
import { ArrowRight01Icon, Shield01Icon, ShieldKeyIcon, TaskDone02Icon } from 'hugeicons-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SEARCHABLE_PAGES = [
  { href: '/dashboard', label: 'Dashboard', keywords: ['overview', 'home'] },
  { href: '/assistant', label: 'Assistant', keywords: ['ai', 'chat'] },
  { href: '/scans', label: 'Scans', keywords: ['images', 'results'] },
  { href: '/helm', label: 'Helm Scan', keywords: ['chart', 'repository'] },
  { href: '/watchlist', label: 'Watchlist', keywords: ['tracking'] },
  { href: '/vulnkb', label: 'Vulnerability KB', keywords: ['cve', 'vulnerability', 'osv', 'nvd'] },
  { href: '/suppressions', label: 'Suppressions', keywords: ['ignore', 'policy'] },
  { href: '/status', label: 'Status Pages', keywords: ['public', 'health'] },
  { href: '/registries', label: 'Registries', keywords: ['container registry'] },
  { href: '/tags', label: 'Tags', keywords: ['labeling'] },
  { href: '/orgs', label: 'Organizations', keywords: ['teams', 'workspace'] },
] as const;

type SeverityColor = 'default' | 'accent' | 'warning' | 'danger';

const SEV_CHIP_COLOR: Record<string, SeverityColor> = {
  CRITICAL: 'danger',
  HIGH: 'warning',
  MEDIUM: 'warning',
  LOW: 'accent',
  UNKNOWN: 'default',
};

type SearchPageResult = {
  href: string;
  label: string;
};

type ResultItem =
  | { kind: 'page'; data: SearchPageResult }
  | { kind: 'image'; data: SearchImageResult }
  | { kind: 'scan'; data: SearchScanResult }
  | { kind: 'vuln'; data: SearchVulnResult };

export function SearchModal({ onClose }: { onClose: () => void }) {
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [pages, setPages] = useState<SearchPageResult[]>([]);
  const [images, setImages] = useState<SearchImageResult[]>([]);
  const [scans, setScans] = useState<SearchScanResult[]>([]);
  const [vulns, setVulns] = useState<SearchVulnResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allItemsRef = useRef<ResultItem[]>([]);
  const activeIdxRef = useRef(-1);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setImages([]);
      setScans([]);
      setVulns([]);
      setPages([]);
      return;
    }
    const normalized = q.trim().toLowerCase();
    const pageHits = SEARCHABLE_PAGES.filter((page) => {
      if (page.label.toLowerCase().includes(normalized)) return true;
      if (page.href.toLowerCase().includes(normalized)) return true;
      return page.keywords.some((keyword) => keyword.toLowerCase().includes(normalized));
    }).slice(0, 5);
    setPages(pageHits.map((page) => ({ href: page.href, label: page.label })));
    setLoading(true);
    try {
      const res = await search(q.trim());
      setImages(res.images ?? []);
      setScans(res.scans ?? []);
      setVulns(res.vulns ?? []);
    } catch {
      setImages([]);
      setScans([]);
      setVulns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    return deferEffect(() => {
      if (query.trim().length < 2) return;
      void doSearch(query);
    });
  }, [doSearch, query, scopeKey]);

  function handleChange(val: string) {
    setQuery(val);
    setActiveIdx(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 280);
  }

  const allItems: ResultItem[] = useMemo(
    () => [
      ...pages.map((d) => ({ kind: 'page' as const, data: d })),
      ...images.map((d) => ({ kind: 'image' as const, data: d })),
      ...scans.map((d) => ({ kind: 'scan' as const, data: d })),
      ...vulns.map((d) => ({ kind: 'vuln' as const, data: d })),
    ],
    [images, pages, scans, vulns]
  );

  const navigate = useCallback(
    (item: ResultItem) => {
      if (item.kind === 'page') {
        router.push(item.data.href);
      } else if (item.kind === 'image') {
        router.push(`/scans?image=${encodeURIComponent(item.data.image_name)}`);
      } else if (item.kind === 'scan') {
        router.push(`/scans/${item.data.id}`);
      } else {
        router.push(`/vulnkb?q=${encodeURIComponent(item.data.vuln_id)}`);
      }
      onClose();
    },
    [onClose, router]
  );

  const activeItem = useMemo(
    () => (activeIdx >= 0 ? allItems[activeIdx] : undefined),
    [activeIdx, allItems]
  );

  useEffect(() => {
    allItemsRef.current = allItems;
    activeIdxRef.current = activeIdx;
  }, [activeIdx, allItems]);

  const handleKeyNavigation = useCallback(
    (
      e:
        | Pick<KeyboardEvent, 'key' | 'preventDefault'>
        | Pick<React.KeyboardEvent, 'key' | 'preventDefault'>
    ) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      const items = allItemsRef.current;
      const currentIdx = activeIdxRef.current;
      if (items.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => {
          const next = i < 0 ? 0 : Math.min(i + 1, items.length - 1);
          activeIdxRef.current = next;
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => {
          const next = i < 0 ? items.length - 1 : Math.max(i - 1, 0);
          activeIdxRef.current = next;
          return next;
        });
      } else if (e.key === 'Enter' && currentIdx >= 0 && currentIdx < items.length) {
        e.preventDefault();
        navigate(items[currentIdx]!);
      }
    },
    [navigate, onClose]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      handleKeyNavigation(e);
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [handleKeyNavigation]);

  useEffect(() => {
    if (activeIdx < 0) return;
    const target = document.getElementById(`search-item-${activeIdx}`);
    target?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const hasResults = pages.length > 0 || images.length > 0 || scans.length > 0 || vulns.length > 0;
  const showEmpty = query.trim().length >= 2 && !loading && !hasResults;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
        aria-hidden
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-label="Global search"
        aria-modal="true"
        className="fixed inset-x-0 top-[10vh] z-[101] mx-auto w-full max-w-3xl px-4"
      >
        <Card className="rounded-3xl border border-divider/60 bg-content1/95 shadow-2xl backdrop-blur-xl">
          <div className="border-b border-divider px-4 py-3">
            <SearchField name="global-search" variant="secondary">
              <SearchField.Group>
                {loading ? <Spinner size="sm" /> : <SearchField.SearchIcon />}
                <SearchField.Input
                  ref={inputRef}
                  placeholder="Search pages, images, scans, CVEs, packages..."
                  value={query}
                  onChange={(event) => handleChange(event.target.value)}
                  onKeyDown={(event) => handleKeyNavigation(event)}
                  autoComplete="off"
                  spellCheck={false}
                  aria-autocomplete="list"
                  aria-controls="search-results"
                  aria-activedescendant={activeIdx >= 0 ? `search-item-${activeIdx}` : undefined}
                />
                {query.length > 0 ? (
                  <SearchField.ClearButton
                    onPress={() => {
                      setQuery('');
                      setPages([]);
                      setImages([]);
                      setScans([]);
                      setVulns([]);
                      setActiveIdx(-1);
                      inputRef.current?.focus();
                    }}
                  />
                ) : null}
              </SearchField.Group>
            </SearchField>
          </div>

          {/* Results */}
          <div id="search-results" role="listbox" aria-label="Search results">
            {query.trim().length < 2 && (
              <p className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                Type at least 2 characters to search
              </p>
            )}

            {showEmpty && (
              <p className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                No results for{' '}
                <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  &ldquo;{query}&rdquo;
                </span>
              </p>
            )}

            {hasResults && (
              <div className="max-h-[65vh] space-y-1 overflow-y-auto py-2">
                {pages.length > 0 && (
                  <div>
                    <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-default-500">
                      Pages
                    </p>
                    {pages.map((page, i) => {
                      const globalIdx = i;
                      const isActive = activeIdx === globalIdx;
                      return (
                        <button
                          key={page.href}
                          id={`search-item-${globalIdx}`}
                          role="option"
                          aria-selected={isActive}
                          onClick={() => navigate({ kind: 'page', data: page })}
                          className={`w-full px-4 py-2.5 text-left transition-colors ${isActive ? 'bg-surface-secondary' : 'hover:bg-surface-secondary/70'}`}
                          onMouseEnter={() => setActiveIdx(globalIdx)}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex size-8 items-center justify-center rounded-xl border border-default-200 bg-default-100 text-default-600">
                              <ArrowRight01Icon size={14} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground">
                                {page.label}
                              </p>
                              <p className="truncate text-xs text-default-500">{page.href}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Images group */}
                {images.length > 0 && (
                  <div className={pages.length > 0 ? 'mt-1' : ''}>
                    <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-default-500">
                      Images
                    </p>
                    {images.map((img, i) => {
                      const globalIdx = pages.length + i;
                      const isActive = activeIdx === globalIdx;
                      return (
                        <button
                          key={img.image_name}
                          id={`search-item-${globalIdx}`}
                          role="option"
                          aria-selected={isActive}
                          onClick={() => navigate({ kind: 'image', data: img })}
                          className={`w-full px-4 py-2.5 text-left transition-colors ${isActive ? 'bg-surface-secondary' : 'hover:bg-surface-secondary/70'}`}
                          onMouseEnter={() => setActiveIdx(globalIdx)}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex size-8 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
                              <Shield01Icon size={14} />
                            </div>
                            <span className="flex-1 truncate font-mono text-sm text-foreground">
                              {img.image_name}
                            </span>
                            <Chip size="sm" variant="soft" color="accent" className="font-mono">
                              {img.scan_count} scan{img.scan_count !== 1 ? 's' : ''}
                            </Chip>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {scans.length > 0 && (
                  <div className={pages.length > 0 || images.length > 0 ? 'mt-1' : ''}>
                    <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-default-500">
                      Scans
                    </p>
                    {scans.map((scan, i) => {
                      const globalIdx = pages.length + images.length + i;
                      const isActive = activeIdx === globalIdx;
                      return (
                        <button
                          key={scan.id}
                          id={`search-item-${globalIdx}`}
                          role="option"
                          aria-selected={isActive}
                          onClick={() => navigate({ kind: 'scan', data: scan })}
                          className={`w-full px-4 py-2.5 text-left transition-colors ${isActive ? 'bg-surface-secondary' : 'hover:bg-surface-secondary/70'}`}
                          onMouseEnter={() => setActiveIdx(globalIdx)}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-secondary/30 bg-secondary/10 text-secondary">
                              <TaskDone02Icon size={14} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-mono text-sm text-foreground">
                                {scan.image_name}:{scan.image_tag}
                              </p>
                              <p className="truncate text-[11px] text-default-500">
                                {scan.status} · {scan.critical_count} critical · {scan.high_count}{' '}
                                high
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Vulns group */}
                {vulns.length > 0 && (
                  <div
                    className={
                      pages.length > 0 || images.length > 0 || scans.length > 0 ? 'mt-1' : ''
                    }
                  >
                    <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-default-500">
                      CVEs &amp; Packages
                    </p>
                    {vulns.map((v, i) => {
                      const globalIdx = pages.length + images.length + scans.length + i;
                      const isActive = activeIdx === globalIdx;
                      const sevColor = SEV_CHIP_COLOR[v.severity] ?? SEV_CHIP_COLOR.UNKNOWN;
                      return (
                        <button
                          key={`${v.vuln_id}-${v.pkg_name}`}
                          id={`search-item-${globalIdx}`}
                          role="option"
                          aria-selected={isActive}
                          onClick={() => navigate({ kind: 'vuln', data: v })}
                          className={`w-full px-4 py-2.5 text-left transition-colors ${isActive ? 'bg-surface-secondary' : 'hover:bg-surface-secondary/70'}`}
                          onMouseEnter={() => setActiveIdx(globalIdx)}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-danger/30 bg-danger/10 text-danger">
                              <ShieldKeyIcon size={14} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-mono text-sm text-foreground">
                                {v.vuln_id}
                              </p>
                              <p className="truncate text-[11px] text-default-500">{v.pkg_name}</p>
                            </div>
                            <Chip size="sm" variant="soft" color={sevColor} className="font-mono">
                              {v.severity.charAt(0).toUpperCase() +
                                v.severity.slice(1).toLowerCase()}
                            </Chip>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Footer hint */}
            {hasResults && (
              <div className="flex items-center gap-3 border-t border-divider px-4 py-2 text-[10px] text-default-500">
                <span>
                  <Kbd className="font-mono">↑↓</Kbd> navigate
                </span>
                <span>
                  <Kbd className="font-mono">↵</Kbd> open
                </span>
                <span>
                  <Kbd className="font-mono">Esc</Kbd> close
                </span>
              </div>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
