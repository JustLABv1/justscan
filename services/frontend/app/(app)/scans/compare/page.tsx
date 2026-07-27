'use client';
import { heroSelectTriggerClassName } from '@/components/ui/form-styles';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { useWorkScope } from '@/hooks/use-work-scope';
import { compareScans, listScans, Scan, ScanComparison, Vulnerability } from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { Button, Card, ListBox, Select, Table } from '@heroui/react';
import { ArrowLeft01Icon } from 'hugeicons-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

const selectTriggerCls = heroSelectTriggerClassName;

function SevBadge({ sev }: { sev: string }) {
  const cfg: Record<string, { color: string; bg: string }> = {
    CRITICAL: { color: '#f87171', bg: 'rgba(239,68,68,0.12)' },
    HIGH: { color: '#fb923c', bg: 'rgba(249,115,22,0.12)' },
    MEDIUM: { color: '#fbbf24', bg: 'rgba(245,158,11,0.12)' },
    LOW: { color: '#60a5fa', bg: 'rgba(59,130,246,0.12)' },
    UNKNOWN: { color: '#a1a1aa', bg: 'rgba(161,161,170,0.08)' },
  };
  const c = cfg[sev.toUpperCase()] ?? cfg.UNKNOWN;
  return (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded-md"
      style={{ color: c.color, background: c.bg }}
    >
      {sev}
    </span>
  );
}

function VulnTable({ vulns, emptyText }: { vulns: Vulnerability[]; emptyText: string }) {
  if (vulns.length === 0) {
    return <p className="text-sm text-zinc-500 py-6 text-center">{emptyText}</p>;
  }
  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label="Scan comparison vulnerabilities" className="min-w-[760px]">
          <Table.Header>
            <Table.Column isRowHeader>CVE ID</Table.Column>
            <Table.Column>Package</Table.Column>
            <Table.Column>Severity</Table.Column>
            <Table.Column>Version</Table.Column>
            <Table.Column className="text-right">CVSS</Table.Column>
          </Table.Header>
          <Table.Body>
            {vulns.map((v, i) => (
              <Table.Row
                key={v.id ?? i}
                id={v.id ?? `${v.vuln_id || 'row'}-${i}`}
                className="hover:bg-[var(--row-hover)]"
              >
                <Table.Cell>
                  {v.vuln_id ? (
                    <a
                      href={`https://nvd.nist.gov/vuln/detail/${v.vuln_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-accent dark:text-accent hover:underline"
                    >
                      {v.vuln_id}
                    </a>
                  ) : (
                    <span className="text-zinc-400">-</span>
                  )}
                </Table.Cell>
                <Table.Cell className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
                  {v.pkg_name}
                </Table.Cell>
                <Table.Cell>
                  <SevBadge sev={v.severity} />
                </Table.Cell>
                <Table.Cell className="font-mono text-xs text-zinc-500">
                  {v.installed_version}
                </Table.Cell>
                <Table.Cell className="text-right font-mono text-xs text-zinc-500">
                  {v.cvss_score ? v.cvss_score.toFixed(1) : '-'}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

function ScanSelector({
  label,
  value,
  onChange,
  scans,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  scans: Scan[];
}) {
  return (
    <div className="space-y-1.5 flex-1">
      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{label}</label>
      <Select
        value={value || '__none__'}
        onChange={(nextValue) =>
          onChange(String(nextValue === '__none__' ? '' : (nextValue ?? '')))
        }
        variant="secondary"
      >
        <Select.Trigger className={selectTriggerCls}>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="__none__">Select a scan…</ListBox.Item>
            {scans.map((s) => (
              <ListBox.Item key={s.id} id={s.id}>
                {s.image_name}:{s.image_tag} - {new Date(s.created_at).toLocaleDateString()} (
                {s.status})
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    </div>
  );
}

function ComparePageInner() {
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const router = useRouter();
  const params = useSearchParams();
  const [scanA, setScanA] = useState(params.get('a') ?? '');
  const [scanB, setScanB] = useState(params.get('b') ?? '');
  const [scans, setScans] = useState<Scan[]>([]);
  const [result, setResult] = useState<ScanComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [scansLoading, setScansLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    return deferEffect(() => {
      setScansLoading(true);
      listScans(1, 100)
        .then((r) => setScans(r.data ?? []))
        .catch(() => {})
        .finally(() => setScansLoading(false));
    });
  }, [scopeKey]);

  // Auto-compare if both params are present on load
  useEffect(() => {
    const a = params.get('a');
    const b = params.get('b');
    if (a && b) {
      runCompare(a, b);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runCompare(idA: string, idB: string) {
    if (!idA || !idB) {
      setError('Please select two scans to compare.');
      return;
    }
    if (idA === idB) {
      setError('Please select two different scans.');
      return;
    }
    setError('');
    setLoading(true);
    setResult(null);
    try {
      const r = await compareScans(idA, idB);
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Comparison failed');
    } finally {
      setLoading(false);
    }
  }

  function handleCompare() {
    runCompare(scanA, scanB);
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Scan Comparison"
        description="Compare two scans to see which vulnerabilities were added or resolved."
        actions={
          <Button onPress={() => router.push('/scans')} variant="secondary">
            <ArrowLeft01Icon size={15} />
            Back to scans
          </Button>
        }
      />

      {/* Selectors */}
      <Card>
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          {scansLoading ? (
            <div className="flex-1 flex items-center justify-center py-4">
              <div className="size-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-accent-500 animate-spin" />
            </div>
          ) : (
            <>
              <ScanSelector
                label="Scan A (baseline)"
                value={scanA}
                onChange={setScanA}
                scans={scans}
              />
              <div className="flex items-center justify-center pb-2.5 text-zinc-400 font-bold select-none shrink-0">
                vs
              </div>
              <ScanSelector
                label="Scan B (compare to)"
                value={scanB}
                onChange={setScanB}
                scans={scans}
              />
            </>
          )}
          <Button onClick={handleCompare} isDisabled={loading || !scanA || !scanB}>
            {loading && (
              <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            Compare
          </Button>
        </div>
      </Card>

      {error && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.18)',
            color: '#f87171',
          }}
        >
          {error}
        </div>
      )}

      {result && (
        <>
          {/* Summary bar */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              label="New vulnerabilities"
              value={result.summary.added_count}
              hint={
                result.summary.added_critical > 0 || result.summary.added_high > 0
                  ? [
                      result.summary.added_critical > 0 ? `${result.summary.added_critical} critical` : '',
                      result.summary.added_high > 0 ? `${result.summary.added_high} high` : '',
                    ].filter(Boolean).join(' · ')
                  : 'No critical or high findings added'
              }
              tone="danger"
              variant="stacked"
            />
            <StatCard label="Resolved vulnerabilities" value={result.summary.removed_count} hint="Removed since the earlier scan" tone="success" variant="stacked" />
            <StatCard label="Unchanged" value={result.summary.unchanged_count} hint="Present in both scans" variant="stacked" />
          </div>

          {/* Added */}
          <Card>
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
                New Vulnerabilities
              </h2>
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{
                  color: '#f87171',
                  background: 'rgba(239,68,68,0.12)',
                  border: '1px solid rgba(239,68,68,0.2)',
                }}
              >
                +{result.summary.added_count}
              </span>
            </div>
            <VulnTable vulns={result.added} emptyText="No new vulnerabilities - great!" />
          </Card>

          {/* Removed */}
          <Card>
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
                Resolved Vulnerabilities
              </h2>
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{
                  color: '#34d399',
                  background: 'rgba(16,185,129,0.12)',
                  border: '1px solid rgba(16,185,129,0.2)',
                }}
              >
                -{result.summary.removed_count}
              </span>
            </div>
            <VulnTable vulns={result.removed} emptyText="No vulnerabilities were resolved." />
          </Card>

          {/* Unchanged */}
          <Card>
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Unchanged</h2>
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{
                  color: '#a1a1aa',
                  background: 'rgba(161,161,170,0.08)',
                  border: '1px solid rgba(161,161,170,0.15)',
                }}
              >
                {result.summary.unchanged_count}
              </span>
            </div>
            <VulnTable vulns={result.unchanged} emptyText="No unchanged vulnerabilities." />
          </Card>
        </>
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <div className="size-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-accent-500 animate-spin" />
        </div>
      }
    >
      <ComparePageInner />
    </Suspense>
  );
}
