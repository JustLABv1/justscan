'use client';
import { useWorkScope } from '@/hooks/use-work-scope';
import { search, SearchImageResult, SearchScanResult, SearchVulnResult } from '@/lib/api';
import { Cancel01Icon, Search01Icon, Shield01Icon, ShieldKeyIcon, TaskDone02Icon } from 'hugeicons-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

const SEV_COLOR: Record<string, string> = {
  CRITICAL: '#f87171',
  HIGH: '#fb923c',
  MEDIUM: '#fbbf24',
  LOW: '#60a5fa',
  UNKNOWN: '#a1a1aa',
};

type ResultItem =
  | { kind: 'image'; data: SearchImageResult }
  | { kind: 'scan'; data: SearchScanResult }
  | { kind: 'vuln';  data: SearchVulnResult  };

export function SearchModal({ onClose }: { onClose: () => void }) {
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [images, setImages] = useState<SearchImageResult[]>([]);
  const [scans, setScans] = useState<SearchScanResult[]>([]);
  const [vulns,  setVulns]  = useState<SearchVulnResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setImages([]);
      setScans([]);
      setVulns([]);
      return;
    }
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
    if (query.trim().length < 2) return;
    void doSearch(query);
  }, [doSearch, query, scopeKey]);

  function handleChange(val: string) {
    setQuery(val);
    setActiveIdx(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 280);
  }

  const allItems: ResultItem[] = [
    ...images.map(d => ({ kind: 'image' as const, data: d })),
    ...scans.map(d => ({ kind: 'scan' as const, data: d })),
    ...vulns.map(d  => ({ kind: 'vuln'  as const, data: d })),
  ];

  function navigate(item: ResultItem) {
    if (item.kind === 'image') {
      router.push(`/scans?image=${encodeURIComponent(item.data.image_name)}`);
    } else if (item.kind === 'scan') {
      router.push(`/scans/${item.data.id}`);
    } else {
      router.push(`/vulnkb?q=${encodeURIComponent(item.data.vuln_id)}`);
    }
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (allItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, allItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      navigate(allItems[activeIdx]!);
    }
  }

  const hasResults = images.length > 0 || scans.length > 0 || vulns.length > 0;
  const showEmpty  = query.trim().length >= 2 && !loading && !hasResults;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
        aria-hidden
        onClick={onClose}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-label="Global search"
        aria-modal="true"
        className="fixed inset-x-0 top-[12vh] z-[101] mx-auto w-full max-w-lg px-4"
      >
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid var(--glass-border)',
            boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(167,139,250,0.08)',
          }}
        >
          {/* Input row */}
          <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            {loading
              ? <div className="w-4 h-4 rounded-full border-2 border-zinc-500 border-t-violet-400 animate-spin shrink-0" aria-label="Searching" />
              : <Search01Icon size={16} className="text-zinc-500 shrink-0" aria-hidden />
            }
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={e => handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search images, CVEs, packages…"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-500"
              style={{ color: 'var(--text-primary)' }}
              aria-label="Search query"
              aria-autocomplete="list"
              aria-controls="search-results"
              aria-activedescendant={activeIdx >= 0 ? `search-item-${activeIdx}` : undefined}
            />
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
              aria-label="Close search"
            >
              <Cancel01Icon size={15} />
            </button>
          </div>

          {/* Results */}
          <div id="search-results" role="listbox" aria-label="Search results">
            {query.trim().length < 2 && (
              <p className="px-4 py-6 text-center text-xs text-zinc-500">
                Type at least 2 characters to search
              </p>
            )}

            {showEmpty && (
              <p className="px-4 py-6 text-center text-xs text-zinc-500">
                No results for <span className="font-semibold text-zinc-400">&ldquo;{query}&rdquo;</span>
              </p>
            )}

            {hasResults && (
              <div className="py-2 max-h-[60vh] overflow-y-auto">

                {/* Images group */}
                {images.length > 0 && (
                  <div>
                    <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                      Images
                    </p>
                    {images.map((img, i) => {
                      const globalIdx = i;
                      const isActive = activeIdx === globalIdx;
                      return (
                        <button
                          key={img.image_name}
                          id={`search-item-${globalIdx}`}
                          role="option"
                          aria-selected={isActive}
                          onClick={() => navigate({ kind: 'image', data: img })}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100"
                          style={{ background: isActive ? 'var(--row-hover)' : 'transparent' }}
                          onMouseEnter={() => setActiveIdx(globalIdx)}
                        >
                          <div
                            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                            style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(167,139,250,0.15)' }}
                          >
                            <Shield01Icon size={14} color="#a78bfa" />
                          </div>
                          <span className="flex-1 font-mono text-sm text-zinc-200 truncate">{img.image_name}</span>
                          <span
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded-md shrink-0"
                            style={{ color: 'var(--text-muted)', background: 'var(--row-divider)', border: '1px solid var(--glass-border)' }}
                          >
                            {img.scan_count} scan{img.scan_count !== 1 ? 's' : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {scans.length > 0 && (
                  <div className={images.length > 0 ? 'mt-1' : ''}>
                    <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                      Scans
                    </p>
                    {scans.map((scan, i) => {
                      const globalIdx = images.length + i;
                      const isActive = activeIdx === globalIdx;
                      return (
                        <button
                          key={scan.id}
                          id={`search-item-${globalIdx}`}
                          role="option"
                          aria-selected={isActive}
                          onClick={() => navigate({ kind: 'scan', data: scan })}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100"
                          style={{ background: isActive ? 'var(--row-hover)' : 'transparent' }}
                          onMouseEnter={() => setActiveIdx(globalIdx)}
                        >
                          <div
                            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                            style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(96,165,250,0.2)' }}
                          >
                            <TaskDone02Icon size={14} color="#60a5fa" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-mono text-sm text-zinc-200 truncate">{scan.image_name}:{scan.image_tag}</p>
                            <p className="text-[11px] text-zinc-500 truncate">
                              {scan.status} · {scan.critical_count} critical · {scan.high_count} high
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Vulns group */}
                {vulns.length > 0 && (
                  <div className={images.length > 0 || scans.length > 0 ? 'mt-1' : ''}>
                    <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                      CVEs &amp; Packages
                    </p>
                    {vulns.map((v, i) => {
                      const globalIdx = images.length + scans.length + i;
                      const isActive = activeIdx === globalIdx;
                      const sevColor = SEV_COLOR[v.severity] ?? SEV_COLOR.UNKNOWN;
                      return (
                        <button
                          key={`${v.vuln_id}-${v.pkg_name}`}
                          id={`search-item-${globalIdx}`}
                          role="option"
                          aria-selected={isActive}
                          onClick={() => navigate({ kind: 'vuln', data: v })}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100"
                          style={{ background: isActive ? 'var(--row-hover)' : 'transparent' }}
                          onMouseEnter={() => setActiveIdx(globalIdx)}
                        >
                          <div
                            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                            style={{ background: `${sevColor}1a`, border: `1px solid ${sevColor}30` }}
                          >
                            <ShieldKeyIcon size={14} color={sevColor} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-mono text-sm truncate" style={{ color: sevColor }}>{v.vuln_id}</p>
                            <p className="text-[11px] text-zinc-500 truncate">{v.pkg_name}</p>
                          </div>
                          <span
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded-md shrink-0"
                            style={{ color: sevColor, background: `${sevColor}18`, border: `1px solid ${sevColor}30` }}
                          >
                            {v.severity.charAt(0).toUpperCase() + v.severity.slice(1).toLowerCase()}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Footer hint */}
            {hasResults && (
              <div
                className="flex items-center gap-3 px-4 py-2 text-[10px] text-zinc-600"
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                <span><kbd className="font-mono">↑↓</kbd> navigate</span>
                <span><kbd className="font-mono">↵</kbd> open</span>
                <span><kbd className="font-mono">Esc</kbd> close</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
