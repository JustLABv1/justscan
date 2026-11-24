'use client';

import {
  Alert,
  Button,
  Card,
  Checkbox,
  Label,
  ListBox,
  Popover,
  SearchField,
  Select,
  Skeleton,
  Table,
  TablePager,
  Tabs,
} from '@/components/ui';
import { SeverityBadge } from '@/components/ui/badges';
import { FormField } from '@/components/ui/form-field';
import type { Vulnerability } from '@/lib/api';
import { cn } from '@/lib/utils';
import { FilterHorizontalIcon } from 'hugeicons-react';
import type { ReactNode } from 'react';
import {
  FINDINGS_PAGE_SIZE,
  type FindingQueryState,
  type FindingSortKey,
  type FindingsState,
} from './use-public-findings';

type SeverityCounts = { critical: number; high: number; medium: number; low: number };

const SEVERITY_TABS = [
  { id: 'all', label: 'All' },
  { id: 'CRITICAL', label: 'Critical', count: 'critical' },
  { id: 'HIGH', label: 'High', count: 'high' },
  { id: 'MEDIUM', label: 'Medium', count: 'medium' },
  { id: 'LOW', label: 'Low', count: 'low' },
] as const;

const SORT_OPTIONS: Array<{ id: FindingSortKey; label: string }> = [
  { id: 'severity', label: 'Severity' },
  { id: 'cvss_score', label: 'CVSS score' },
  { id: 'vuln_id', label: 'Vulnerability ID' },
  { id: 'pkg_name', label: 'Package' },
  { id: 'fixed_version', label: 'Fix available' },
];

/** "Update to 1.2.5" or "No fix available yet". */
export function remediationLabel(fixedVersion?: string | null) {
  const fixed = String(fixedVersion ?? '').trim();
  return fixed ? `Update to ${fixed}` : 'No fix available yet';
}

function cvssLabel(score?: number | null) {
  return score ? `CVSS ${score.toFixed(1)}` : null;
}

function Remediation({ vulnerability }: { vulnerability: Vulnerability }) {
  return (
    <span
      className={cn(
        'text-sm [overflow-wrap:anywhere]',
        vulnerability.fixed_version ? 'text-foreground' : 'text-muted-foreground'
      )}
    >
      {remediationLabel(vulnerability.fixed_version)}
    </span>
  );
}

function FindingCard({
  vulnerability,
  onOpen,
  policy,
}: {
  vulnerability: Vulnerability;
  onOpen: () => void;
  policy?: ReactNode;
}) {
  const cvss = cvssLabel(vulnerability.cvss_score);
  return (
    <li className="relative flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-muted/50 has-[:focus-visible]:bg-muted/50">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={vulnerability.severity} />
        <button
          type="button"
          onClick={onOpen}
          className="font-mono text-sm font-medium text-foreground outline-none after:absolute after:inset-0 hover:underline focus-visible:underline"
        >
          {vulnerability.vuln_id || 'Unnamed finding'}
        </button>
        {cvss ? <span className="text-xs tabular-nums text-muted-foreground">{cvss}</span> : null}
      </div>
      <p className="text-sm [overflow-wrap:anywhere]">
        <span className="font-medium">{vulnerability.pkg_name}</span>
        {vulnerability.installed_version ? (
          <span className="text-muted-foreground"> {vulnerability.installed_version}</span>
        ) : null}
        <span className="text-muted-foreground"> → </span>
        <Remediation vulnerability={vulnerability} />
      </p>
      {vulnerability.title ? (
        <p className="line-clamp-2 text-sm text-muted-foreground">{vulnerability.title}</p>
      ) : null}
      {policy ? <div className="relative z-10">{policy}</div> : null}
    </li>
  );
}

function FindingsTable({
  rows,
  query,
  onSort,
  onOpen,
  renderPolicy,
  showPolicy,
  label,
}: {
  rows: Vulnerability[];
  query: FindingQueryState['query'];
  onSort: (key: FindingSortKey, direction: 'asc' | 'desc') => void;
  onOpen: (vulnerability: Vulnerability) => void;
  renderPolicy?: (vulnerability: Vulnerability) => ReactNode | null;
  showPolicy: boolean;
  label: string;
}) {
  return (
    <Table>
      <Table.ScrollContainer className="rounded-none border-0">
        <Table.Content
          aria-label={label}
          className="table-fixed"
          sortDescriptor={{
            column: query.sortBy,
            direction: query.sortDir === 'desc' ? 'descending' : 'ascending',
          }}
          onSortChange={(descriptor) =>
            onSort(
              String(descriptor.column) as FindingSortKey,
              descriptor.direction === 'descending' ? 'desc' : 'asc'
            )
          }
        >
          <Table.Header>
            <Table.Column id="vuln_id" isRowHeader allowsSorting className="w-[34%]">
              <Table.SortableColumnHeader column="vuln_id">
                Vulnerability
              </Table.SortableColumnHeader>
            </Table.Column>
            <Table.Column id="pkg_name" allowsSorting className="w-[24%]">
              <Table.SortableColumnHeader column="pkg_name">Package</Table.SortableColumnHeader>
            </Table.Column>
            <Table.Column id="severity" allowsSorting className="w-[14%]">
              <Table.SortableColumnHeader column="severity">Severity</Table.SortableColumnHeader>
            </Table.Column>
            <Table.Column id="fixed_version" allowsSorting>
              <Table.SortableColumnHeader column="fixed_version">Fix</Table.SortableColumnHeader>
            </Table.Column>
            {showPolicy ? (
              <Table.Column id="policy" className="w-[12%]">
                Policy
              </Table.Column>
            ) : (
              <></>
            )}
          </Table.Header>
          <Table.Body>
            {rows.map((vulnerability) => {
              const cvss = cvssLabel(vulnerability.cvss_score);
              return (
                <Table.Row key={vulnerability.id} id={vulnerability.id}>
                  <Table.Cell>
                    <Button
                      variant="link"
                      onPress={() => onOpen(vulnerability)}
                      className="h-auto max-w-full justify-start p-0 font-mono text-sm text-foreground"
                    >
                      {vulnerability.vuln_id || 'Unnamed finding'}
                    </Button>
                    {vulnerability.title ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {vulnerability.title}
                      </p>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell>
                    <p className="font-medium [overflow-wrap:anywhere]">{vulnerability.pkg_name}</p>
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {vulnerability.installed_version}
                    </p>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-1">
                      <SeverityBadge severity={vulnerability.severity} />
                      {cvss ? (
                        <span className="text-xs tabular-nums text-muted-foreground">{cvss}</span>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Remediation vulnerability={vulnerability} />
                  </Table.Cell>
                  {showPolicy ? (
                    <Table.Cell>{renderPolicy?.(vulnerability) ?? null}</Table.Cell>
                  ) : (
                    <></>
                  )}
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

function FindingsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="divide-y divide-border">
      <span className="sr-only">Loading vulnerabilities</span>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="space-y-2 px-4 py-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}

function FilterPopover({
  state,
  enableCveSearch,
  enablePolicyFirst,
}: {
  state: FindingQueryState;
  enableCveSearch: boolean;
  enablePolicyFirst: boolean;
}) {
  const { query, inputs, update, setInput, reset, activeFilterCount } = state;
  return (
    <Popover>
      <Popover.Trigger>
        <Button variant="outline">
          <FilterHorizontalIcon size={15} />
          Filter and sort
          {activeFilterCount > 0 ? (
            <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">
              {activeFilterCount}
            </span>
          ) : null}
        </Button>
      </Popover.Trigger>
      <Popover.Content placement="bottom end" className="w-[min(calc(100vw-2rem),28rem)]">
        <div className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {enableCveSearch ? (
              <FormField
                label="Vulnerability ID"
                value={inputs.cve}
                onChange={(event) => setInput('cve', event.target.value)}
                placeholder="e.g. CVE-2024-3094"
                containerClassName="sm:col-span-2"
              />
            ) : null}
            <Select
              aria-label="Sort by"
              value={query.sortBy}
              className="w-full"
              onChange={(value) => update({ sortBy: (value ?? 'severity') as FindingSortKey })}
            >
              <Label>Sort by</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {SORT_OPTIONS.map((option) => (
                    <ListBox.Item key={option.id} id={option.id}>
                      {option.label}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <Select
              aria-label="Order"
              value={query.sortDir}
              className="w-full"
              onChange={(value) => update({ sortDir: value === 'desc' ? 'desc' : 'asc' })}
            >
              <Label>Order</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="asc">Most important first</ListBox.Item>
                  <ListBox.Item id="desc">Least important first</ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
            <FormField
              label="Minimum CVSS score"
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={inputs.minCvss}
              onChange={(event) => setInput('minCvss', event.target.value)}
              placeholder="0.0"
            />
            <div className="flex flex-col justify-end gap-3 pb-1">
              <Checkbox isSelected={query.hasFix} onChange={(value) => update({ hasFix: value })}>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <span>Only with a fix</span>
              </Checkbox>
              {enablePolicyFirst ? (
                <Checkbox
                  isSelected={query.xrayPolicyFirst}
                  onChange={(value) => update({ xrayPolicyFirst: value })}
                >
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <span>Policy matches first</span>
                </Checkbox>
              ) : null}
            </div>
          </div>
          <Button size="sm" variant="ghost" onPress={reset}>
            Clear filters
          </Button>
        </div>
      </Popover.Content>
    </Popover>
  );
}

/**
 * Findings for one scan: severity tabs, search, a filter popover, then cards
 * below `lg` and a four-column table from `lg` up, with a pager.
 */
export function FindingsView({
  label,
  counts,
  queryState,
  findings,
  onOpen,
  renderPolicy,
  enableCveSearch = false,
  enablePolicyFirst = false,
}: {
  label: string;
  counts: SeverityCounts;
  queryState: FindingQueryState;
  findings: FindingsState;
  onOpen: (vulnerability: Vulnerability) => void;
  /** Policy cell content; return null when a row has none. The column only shows when a row has data. */
  renderPolicy?: (vulnerability: Vulnerability) => ReactNode | null;
  enableCveSearch?: boolean;
  enablePolicyFirst?: boolean;
}) {
  const { query, inputs, update, setInput, page, setPage, isFiltered, reset } = queryState;
  const { rows, total, loading, error, retry } = findings;
  const showPolicy = Boolean(renderPolicy && rows.some((row) => renderPolicy(row) != null));

  let body: ReactNode;
  if (error && rows.length === 0) {
    body = (
      <div className="p-4">
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Vulnerabilities didn’t load</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
          <Button size="sm" variant="outline" onPress={retry}>
            Try again
          </Button>
        </Alert>
      </div>
    );
  } else if (loading && rows.length === 0) {
    body = <FindingsSkeleton />;
  } else if (rows.length === 0) {
    body = (
      <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
        <p className="text-sm font-medium">
          {isFiltered ? 'No vulnerabilities match these filters' : 'No vulnerabilities found'}
        </p>
        {isFiltered ? (
          <Button size="sm" variant="outline" onPress={reset}>
            Clear filters
          </Button>
        ) : null}
      </div>
    );
  } else {
    body = (
      <div className={cn(loading && 'opacity-60 transition-opacity')} aria-busy={loading}>
        <ul className="divide-y divide-border lg:hidden" aria-label={label}>
          {rows.map((vulnerability) => (
            <FindingCard
              key={vulnerability.id}
              vulnerability={vulnerability}
              onOpen={() => onOpen(vulnerability)}
              policy={showPolicy ? renderPolicy?.(vulnerability) : null}
            />
          ))}
        </ul>
        <div className="hidden lg:block">
          <FindingsTable
            rows={rows}
            query={query}
            label={label}
            onSort={(sortBy, sortDir) => update({ sortBy, sortDir })}
            onOpen={onOpen}
            renderPolicy={renderPolicy}
            showPolicy={showPolicy}
          />
        </div>
      </div>
    );
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Vulnerabilities</h2>
          {total > 0 ? (
            <span className="text-sm tabular-nums text-muted-foreground">
              {total.toLocaleString()} {isFiltered ? 'matching' : 'total'}
            </span>
          ) : null}
        </div>
        <Tabs
          selectedKey={query.severity || 'all'}
          onSelectionChange={(key) => update({ severity: key === 'all' ? '' : String(key) })}
        >
          <Tabs.ListContainer className="-mx-1 overflow-x-auto px-1">
            <Tabs.List aria-label="Filter by severity" className="min-w-max">
              {SEVERITY_TABS.map((tab) => (
                <Tabs.Tab id={tab.id} key={tab.id}>
                  {tab.label}
                  {'count' in tab ? (
                    <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                      {counts[tab.count].toLocaleString()}
                    </span>
                  ) : null}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchField
            aria-label="Search packages"
            className="w-full sm:max-w-sm"
            value={inputs.pkg}
            onChange={(value) => setInput('pkg', value)}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search packages" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <FilterPopover
            state={queryState}
            enableCveSearch={enableCveSearch}
            enablePolicyFirst={enablePolicyFirst}
          />
        </div>
      </div>

      {error && rows.length > 0 ? (
        <div className="border-b border-border p-4">
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>
                Couldn’t refresh the list, so these are the last results that loaded.
              </Alert.Description>
            </Alert.Content>
            <Button size="sm" variant="outline" onPress={retry}>
              Try again
            </Button>
          </Alert>
        </div>
      ) : null}

      {body}

      <TablePager
        page={page}
        pageSize={FINDINGS_PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        noun="vulnerabilities"
      />
    </Card>
  );
}
