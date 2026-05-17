'use client';

import { getScannerHealth } from '@/lib/api/dashboard';
import type { ScannerHealth } from '@/lib/api/types/dashboard';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate } from '@/lib/time';
import { Button, Card, Chip } from '@heroui/react';
import { useCallback, useEffect, useState } from 'react';

function formatDbAge(hours?: number | null): string {
  if (hours == null || Number.isNaN(hours)) return 'Unknown';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${hours >= 10 ? hours.toFixed(0) : hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function statusColor(status: 'healthy' | 'stale' | 'error'): 'success' | 'warning' | 'danger' {
  if (status === 'healthy') return 'success';
  if (status === 'stale') return 'warning';
  return 'danger';
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
    <div className="space-y-4">
      {error && (
        <Card className="border border-danger/30 bg-danger/10">
          <Card.Content>
            <p className="text-sm text-danger">{error}</p>
          </Card.Content>
        </Card>
      )}

      <Card className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Scanner Health</h2>
            <p className="text-sm text-zinc-500">Live worker cache status from the current backend instance.</p>
          </div>
          <Button variant="secondary" onPress={load} isDisabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>

        {health && (
          <>
            {!health.local_scanner_enabled ? (
              <Card className="border border-warning/30 bg-warning/10">
                <Card.Content className="space-y-1">
                  <p className="text-sm font-medium">Local scanner is disabled.</p>
                  <p className="text-sm text-zinc-500">
                    {health.message || 'This backend instance is running without the built-in local scanner.'}
                  </p>
                </Card.Content>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Card><Card.Content><p className="text-xs text-zinc-500">Healthy Workers</p><p className="text-2xl font-semibold text-success">{health.healthy_workers}</p></Card.Content></Card>
                  <Card><Card.Content><p className="text-xs text-zinc-500">Stale Workers</p><p className="text-2xl font-semibold text-warning">{health.stale_workers}</p></Card.Content></Card>
                  <Card><Card.Content><p className="text-xs text-zinc-500">Oldest Vuln DB</p><p className="text-2xl font-semibold">{formatDbAge(health.oldest_vuln_db_age_hours)}</p></Card.Content></Card>
                  <Card><Card.Content><p className="text-xs text-zinc-500">Oldest Java DB</p><p className="text-2xl font-semibold">{formatDbAge(health.oldest_java_db_age_hours)}</p></Card.Content></Card>
                </div>

                <Card variant="secondary">
                  <Card.Content>
                    <p className="text-xs text-zinc-500">
                      Status is based on when each worker last downloaded its local DB copy. A worker is healthy if it downloaded within the last {health.max_allowed_age_hours}h.
                    </p>
                  </Card.Content>
                </Card>

                <div className="space-y-2">
                  {health.workers.map((worker) => (
                    <Card key={worker.worker_id} variant="secondary" className="space-y-3">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Chip size="sm" variant="soft">Worker {worker.worker_id}</Chip>
                          <Chip size="sm" variant="soft" color={statusColor(worker.status)} className="capitalize">{worker.status}</Chip>
                          <span className="text-xs text-zinc-500">Trivy {worker.trivy_version || 'unknown'}</span>
                        </div>
                        <span className="text-xs text-zinc-500" title={worker.cache_dir}>{worker.cache_dir}</span>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 text-xs">
                        <Card variant="secondary">
                          <Card.Content className="space-y-1">
                            <p className="text-zinc-500">Vulnerability DB</p>
                            <p>Snapshot age: {formatDbAge(worker.vuln_db_age_hours)}</p>
                            <p className="text-zinc-500">Updated: {worker.vuln_db_updated_at ? fullDate(worker.vuln_db_updated_at) : 'Unknown'}</p>
                            <p className="text-zinc-500">Downloaded: {worker.vuln_db_downloaded_at ? fullDate(worker.vuln_db_downloaded_at) : 'Unknown'}</p>
                          </Card.Content>
                        </Card>
                        <Card variant="secondary">
                          <Card.Content className="space-y-1">
                            <p className="text-zinc-500">Java DB</p>
                            <p>Snapshot age: {formatDbAge(worker.java_db_age_hours)}</p>
                            <p className="text-zinc-500">Updated: {worker.java_db_updated_at ? fullDate(worker.java_db_updated_at) : 'Unknown'}</p>
                            <p className="text-zinc-500">Downloaded: {worker.java_db_downloaded_at ? fullDate(worker.java_db_downloaded_at) : 'Unknown'}</p>
                          </Card.Content>
                        </Card>
                      </div>

                      {worker.error && <p className="text-xs text-danger">{worker.error}</p>}
                    </Card>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
