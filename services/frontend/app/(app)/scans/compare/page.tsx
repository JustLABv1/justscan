'use client';
import { StatStrip, StatStripItem } from '@/components/ui/stat-strip';
import { fieldSelectTriggerClassName } from '@/components/ui/form-styles';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { FormAlert } from '@/components/ui/form-alert';
import { StatusTag } from '@/components/ui/status-dot';
import { useWorkScope } from '@/hooks/use-work-scope';
import { compareScans, listScans, Scan, ScanComparison, Vulnerability } from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { humanize } from '@/lib/labels';
import { timeAgo } from '@/lib/time';
import { SeverityBadge } from '@/components/ui/badges';
import { Button, Card, ListBox, Select, Spinner, Table } from '@/components/ui';
import { ArrowLeft01Icon } from 'hugeicons-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

const selectTriggerCls = fieldSelectTriggerClassName;

function VulnTable({ vulns, emptyText }: { vulns: Vulnerability[]; emptyText: string }) {
  if (vulns.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">{emptyText}</p>;
  }
  return (
    <Table variant="secondary">
      <Table.Responsive>
        <Table.ScrollContainer>
          <Table.Content aria-label="Scan comparison vulnerabilities" className="[&_td]:align-top">
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
                  className="hover:bg-muted/50"
                >
                  <Table.Cell data-label="CVE">
                    {v.vuln_id ? (
                      <a
                        href={`https://nvd.nist.gov/vuln/detail/${v.vuln_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="whitespace-nowrap font-mono text-xs text-primary hover:underline"
                      >
                        {v.vuln_id}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </Table.Cell>
                  <Table.Cell
                    data-label="Package"
                    className="text-sm text-foreground [overflow-wrap:anywhere]"
                  >
                    {v.pkg_name}
                  </Table.Cell>
                  <Table.Cell data-label="Severity">
                    <SeverityBadge severity={(v.severity || 'UNKNOWN').toUpperCase()} />
                  </Table.Cell>
                  <Table.Cell
                    data-label="Version"
                    className="break-all font-mono text-xs text-muted-foreground"
                  >
                    {v.installed_version}
                  </Table.Cell>
                  <Table.Cell
                    data-label="CVSS"
                    className="text-right font-mono text-xs text-muted-foreground"
                  >
                    {v.cvss_score ? v.cvss_score.toFixed(1) : '-'}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table.Responsive>
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
      <label className="text-sm font-medium text-foreground">{label}</label>
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
                {s.image_name}:{s.image_tag} · {timeAgo(s.created_at)} · {humanize(s.status)}
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

  const sections = result
    ? [
        {
          key: 'added',
          title: 'New vulnerabilities',
          count: `+${result.summary.added_count}`,
          tone: 'danger' as const,
          vulns: result.added,
          empty: 'No new vulnerabilities.',
        },
        {
          key: 'removed',
          title: 'Resolved vulnerabilities',
          count: `−${result.summary.removed_count}`,
          tone: 'success' as const,
          vulns: result.removed,
          empty: 'No vulnerabilities were resolved.',
        },
        {
          key: 'unchanged',
          title: 'Unchanged',
          count: String(result.summary.unchanged_count),
          tone: 'muted' as const,
          vulns: result.unchanged,
          empty: 'No unchanged vulnerabilities.',
        },
      ]
    : [];

  return (
    <PageContainer size="default">
      <PageHeader
        title="Compare scans"
        description="See which vulnerabilities were added or resolved between two scans."
        actions={
          <Button onPress={() => router.push('/scans')} variant="secondary">
            <ArrowLeft01Icon size={15} />
            Back to scans
          </Button>
        }
      />

      <Card>
        <Card.Content className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-end">
          {scansLoading ? (
            <div className="flex flex-1 items-center justify-center py-4">
              <Spinner size="sm" />
            </div>
          ) : (
            <>
              <ScanSelector label="Baseline scan" value={scanA} onChange={setScanA} scans={scans} />
              <ScanSelector label="Compare with" value={scanB} onChange={setScanB} scans={scans} />
            </>
          )}
          <Button onClick={handleCompare} isDisabled={loading || !scanA || !scanB}>
            {loading ? <Spinner size="sm" /> : null}
            Compare
          </Button>
        </Card.Content>
      </Card>

      {error ? <FormAlert description={error} /> : null}

      {result ? (
        <>
          <StatStrip>
            <StatStripItem
              label="New vulnerabilities"
              value={result.summary.added_count}
              hint={
                result.summary.added_critical > 0 || result.summary.added_high > 0
                  ? [
                      result.summary.added_critical > 0
                        ? `${result.summary.added_critical} critical`
                        : '',
                      result.summary.added_high > 0 ? `${result.summary.added_high} high` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : 'No critical or high findings added'
              }
              tone="danger"
            />
            <StatStripItem
              label="Resolved vulnerabilities"
              value={result.summary.removed_count}
              hint="Removed since the baseline scan"
              tone="success"
            />
            <StatStripItem
              label="Unchanged"
              value={result.summary.unchanged_count}
              hint="Present in both scans"
            />
          </StatStrip>

          {sections.map((section) => (
            <Card key={section.key}>
              <Card.Header className="flex flex-row items-center gap-2">
                <Card.Title className="text-sm">{section.title}</Card.Title>
                <StatusTag tone={section.tone}>{section.count}</StatusTag>
              </Card.Header>
              <Card.Content className="px-0">
                <VulnTable vulns={section.vulns} emptyText={section.empty} />
              </Card.Content>
            </Card>
          ))}
        </>
      ) : null}
    </PageContainer>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <div className="size-7 rounded-full border-2 border-border dark:border-border border-t-primary animate-spin" />
        </div>
      }
    >
      <ComparePageInner />
    </Suspense>
  );
}
