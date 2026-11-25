'use client';

import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { ScannerRuntimePanel } from '@/components/admin/scanner-runtime-panel';
import { Button, ResourceList } from '@/components/ui';
import { StatusAlert } from '@/components/ui/form-alert';
import { StatStrip, StatStripItem } from '@/components/ui/stat-strip';
import { StatusDot, StatusTag, type StatusDotTone } from '@/components/ui/status-dot';
import { getScannerHealth } from '@/lib/api/dashboard';
import type { ScannerHealth, ScannerHealthWorker } from '@/lib/api/types/dashboard';
import { deferEffect } from '@/lib/defer-effect';
import { summarizeError } from '@/lib/labels';
import { fullDate, timeAgo } from '@/lib/time';
import { useCallback, useEffect, useState } from 'react';

function formatDbAge(hours?: number | null): string {
  if (hours == null || Number.isNaN(hours)) return 'Unknown';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 24) return `${hours >= 10 ? hours.toFixed(0) : hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

const WORKER_STATUS: Record<
  ScannerHealthWorker['status'],
  { label: string; tone: StatusDotTone; rowTone: 'default' | 'warning' | 'danger' }
> = {
  healthy: { label: 'Healthy', tone: 'success', rowTone: 'default' },
  stale: { label: 'Stale', tone: 'warning', rowTone: 'warning' },
  error: { label: 'Error', tone: 'danger', rowTone: 'danger' },
};

function DbFreshness({
  label,
  updatedAt,
  downloadedAt,
}: {
  label: string;
  updatedAt?: string | null;
  downloadedAt?: string | null;
}) {
  if (!updatedAt && !downloadedAt) {
    return <span>{label} not downloaded yet</span>;
  }
  const title = [
    updatedAt ? `Published ${fullDate(updatedAt)}` : null,
    downloadedAt ? `Downloaded ${fullDate(downloadedAt)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span title={title}>
      {label} published {timeAgo(updatedAt)}
      {downloadedAt ? `, downloaded ${timeAgo(downloadedAt)}` : ''}
    </span>
  );
}

export function ScannerTab() {
  const [health, setHealth] = useState<ScannerHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setHealth(await getScannerHealth());
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load scanner health');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => deferEffect(load), [load]);

  return (
    <AdminPageShell
      actions={
        <Button size="sm" variant="secondary" onPress={load} isDisabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      }
    >
      <div className="space-y-4">
        {error ? (
          <StatusAlert status="danger" title="Scanner health failed to load" description={error} />
        ) : null}

        {health && !health.local_scanner_enabled ? (
          <StatusAlert
            status="warning"
            title="Local scanner is disabled"
            description={
              health.message ||
              'This backend instance is running without the built-in local scanner.'
            }
          />
        ) : null}

        {health && health.local_scanner_enabled ? (
          <>
            <StatStrip className="lg:grid-cols-4">
              <StatStripItem
                label="Healthy workers"
                value={health.healthy_workers}
                tone="success"
              />
              <StatStripItem
                label="Stale workers"
                value={health.stale_workers}
                tone={health.stale_workers > 0 ? 'warning' : undefined}
              />
              <StatStripItem
                label="Oldest vulnerability DB"
                value={formatDbAge(health.oldest_vuln_db_age_hours)}
                hint={`Healthy within ${health.max_allowed_age_hours} h`}
              />
              <StatStripItem
                label="Oldest Java DB"
                value={formatDbAge(health.oldest_java_db_age_hours)}
              />
            </StatStrip>

            <section className="space-y-2" aria-labelledby="scanner-workers-heading">
              <div>
                <h2 id="scanner-workers-heading" className="text-base font-medium">
                  Workers
                </h2>
                <p className="text-sm text-muted-foreground">
                  A worker is healthy when it downloaded its vulnerability database within the last{' '}
                  {health.max_allowed_age_hours} hours.
                </p>
              </div>
              <ResourceList>
                {health.workers.map((worker) => {
                  const status = WORKER_STATUS[worker.status] ?? WORKER_STATUS.error;
                  return (
                    <ResourceList.Item
                      key={worker.worker_id}
                      media={<StatusDot tone={status.tone} />}
                      title={`Worker ${worker.worker_id}`}
                      tone={status.rowTone}
                      description={
                        <span title={worker.cache_dir}>
                          Trivy {worker.trivy_version || 'version unknown'} · {worker.cache_dir}
                        </span>
                      }
                      meta={<StatusTag tone={status.tone}>{status.label}</StatusTag>}
                    >
                      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-4">
                        <DbFreshness
                          label="Vulnerability DB"
                          updatedAt={worker.vuln_db_updated_at}
                          downloadedAt={worker.vuln_db_downloaded_at}
                        />
                        <DbFreshness
                          label="Java DB"
                          updatedAt={worker.java_db_updated_at}
                          downloadedAt={worker.java_db_downloaded_at}
                        />
                      </div>
                      {worker.error ? (
                        <p className="mt-1 text-xs text-destructive" title={worker.error}>
                          {summarizeError(worker.error)}
                        </p>
                      ) : null}
                    </ResourceList.Item>
                  );
                })}
              </ResourceList>
            </section>
          </>
        ) : null}

        <ScannerRuntimePanel />
      </div>
    </AdminPageShell>
  );
}
