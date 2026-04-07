'use client';

import { SevCount, StatusBadge } from '@/components/ui/badges';
import { useConditionalInterval } from '@/hooks/use-conditional-interval';
import { listScans, Scan } from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
import { Checkbox } from '@heroui/react';
import { Cancel01Icon, Delete01Icon } from 'hugeicons-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

interface ImageChildrenProps {
  imageName: string;
  onDelete: (id: string, imageName: string) => Promise<void> | void;
  onCancel: (id: string, imageName: string) => Promise<void> | void;
  selectedScans: Set<string>;
  onSelectScan: (scanId: string, selected: boolean) => void;
}

export function ImageChildren({ imageName, onDelete, onCancel, selectedScans, onSelectScan }: ImageChildrenProps) {
  const router = useRouter();
  const [scans, setScans] = useState<Scan[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const limit = 10;

  const load = useCallback(async (nextPage: number) => {
    setLoading(true);
    try {
      const res = await listScans(nextPage, limit, imageName, undefined, true);
      setScans(res.data ?? []);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [imageName]);

  useEffect(() => {
    load(page);
  }, [load, page]);

  useConditionalInterval(() => {
    void load(page);
  }, scans.some((scan) => scan.status === 'running' || scan.status === 'pending'), 5000);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <tr>
      <td colSpan={10} className="p-0">
        <div className="mx-4 mb-3 rounded-xl overflow-hidden" style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)' }}>
          {loading ? (
            <div className="flex justify-center py-6">
              <div className="w-5 h-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
            </div>
          ) : scans.length === 0 ? (
            <div className="py-5 text-center text-xs text-zinc-500">No scans yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                  <th className="w-8 px-3 py-2" scope="col" />
                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider" scope="col">Tag</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider" scope="col">Status</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider" scope="col">Tags</th>
                  <th className="text-center px-3 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(239,68,68,0.7)' }} scope="col"><abbr title="Critical">C</abbr></th>
                  <th className="text-center px-3 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(249,115,22,0.7)' }} scope="col"><abbr title="High">H</abbr></th>
                  <th className="text-center px-3 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(234,179,8,0.7)' }} scope="col"><abbr title="Medium">M</abbr></th>
                  <th className="text-center px-3 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(59,130,246,0.7)' }} scope="col"><abbr title="Low">L</abbr></th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">Date</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {scans.map((scan, index) => (
                  <tr
                    key={scan.id}
                    className="cursor-pointer group transition-colors"
                    style={{ borderTop: index > 0 ? '1px solid var(--row-divider)' : undefined }}
                    onClick={() => router.push(`/scans/${scan.id}`)}
                    onMouseEnter={(event) => (event.currentTarget.style.background = 'rgba(124,58,237,0.06)')}
                    onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
                  >
                    <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}>
                      <Checkbox isSelected={selectedScans.has(scan.id)} onChange={(checked: boolean) => onSelectScan(scan.id, checked)}>
                        <Checkbox.Control className="border border-zinc-500/50 data-[selected=true]:border-violet-500 data-[selected=true]:bg-violet-600">
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                      </Checkbox>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-1 h-5 rounded-full shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'linear-gradient(180deg,#a78bfa,#7c3aed)' }} />
                        <span className="font-mono text-sm font-medium text-zinc-700 dark:text-zinc-200">:{scan.image_tag}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={scan.status} externalStatus={scan.external_status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        {(scan.tags ?? []).map((tag) => (
                          <span key={tag.id} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: `${tag.color}22`, color: tag.color, border: `1px solid ${tag.color}44` }}>
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center"><SevCount count={scan.critical_count} level="critical" /></td>
                    <td className="px-3 py-3 text-center"><SevCount count={scan.high_count} level="high" /></td>
                    <td className="px-3 py-3 text-center"><SevCount count={scan.medium_count} level="medium" /></td>
                    <td className="px-3 py-3 text-center"><SevCount count={scan.low_count} level="low" /></td>
                    <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap" title={fullDate(scan.created_at)}>{timeAgo(scan.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        {(scan.status === 'pending' || scan.status === 'running') && (
                          <button onClick={(event) => { event.stopPropagation(); void onCancel(scan.id, imageName); }} className="text-zinc-400 hover:text-amber-400 transition-colors" title="Cancel scan" aria-label="Cancel scan">
                            <Cancel01Icon size={15} aria-hidden />
                          </button>
                        )}
                        <button onClick={(event) => { event.stopPropagation(); void onDelete(scan.id, imageName); }} className="text-zinc-400 hover:text-red-400 transition-colors" title="Delete scan" aria-label="Delete scan">
                          <Delete01Icon size={15} aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2" style={{ borderTop: '1px solid var(--row-divider)' }}>
              <span className="text-xs text-zinc-500">{total} scans</span>
              <div className="flex items-center gap-1.5">
                <button disabled={page <= 1} onClick={() => setPage((previous) => previous - 1)} className="px-2.5 py-1 text-xs rounded-lg text-zinc-500 disabled:opacity-30 transition-all" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>← Prev</button>
                <span className="text-xs text-zinc-500 px-1">{page} / {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => setPage((previous) => previous + 1)} className="px-2.5 py-1 text-xs rounded-lg text-zinc-500 disabled:opacity-30 transition-all" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>Next →</button>
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}