import { timeAgo } from '@/lib/time';
import { Delete01Icon, PlusSignIcon } from 'hugeicons-react';
import Link from 'next/link';

import { OrgScanItem, StatusBadge } from './shared';

interface OrgScansTabProps {
  onOpenAssignModal: () => void | Promise<void>;
  onRemoveScan: (scanId: string) => void | Promise<void>;
  orgScans: OrgScanItem[];
}

export function OrgScansTab({ onOpenAssignModal, onRemoveScan, orgScans }: OrgScansTabProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Assigned Scans</h2>
        <button onClick={() => void onOpenAssignModal()} className="btn-secondary inline-flex items-center gap-2" type="button">
          <PlusSignIcon size={14} />
          Assign Scan
        </button>
      </div>

      {orgScans.length === 0 ? (
        <div className="glass-panel rounded-2xl p-6 text-center text-sm text-zinc-500">
          No scans assigned. Assign a scan to evaluate it against this organization&apos;s policies.
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Image</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Compliance</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {orgScans.map((scan, index) => (
                <tr
                  key={scan.id}
                  style={{ borderTop: index > 0 ? '1px solid var(--row-divider)' : undefined }}
                  onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--row-hover)')}
                  onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
                >
                  <td className="px-4 py-3">
                    <Link href={`/scans/${scan.id}`} className="font-mono text-sm text-zinc-700 dark:text-zinc-300 hover:text-violet-500 dark:hover:text-violet-400 transition-colors">
                      {scan.image_name}:{scan.image_tag}
                    </Link>
                    <p className="text-xs text-zinc-500 mt-0.5">{timeAgo(scan.created_at)}</p>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={scan.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {(scan.compliance ?? []).map((result) => (
                        <span
                          key={result.policy_id}
                          className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${
                            result.status === 'pass'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-red-500/10 text-red-400 border-red-500/20'
                          }`}
                        >
                          {result.status === 'pass' ? '✓' : '✗'} {result.policy_name}
                        </span>
                      ))}
                      {(scan.compliance ?? []).length === 0 && <span className="text-xs text-zinc-500">Not evaluated</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => void onRemoveScan(scan.id)} className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors" title="Remove scan from org" type="button">
                      <Delete01Icon size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}