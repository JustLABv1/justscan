'use client';

import type { Vulnerability } from '@/lib/api';
import { Pagination, Table } from '@heroui/react';
import type { ReactNode } from 'react';

type VulnerabilitySortKey =
  | 'vuln_id'
  | 'pkg_name'
  | 'installed_version'
  | 'fixed_version'
  | 'severity'
  | 'cvss_score';

interface VulnerabilitiesTableProps {
  ariaLabel: string;
  vulns: Vulnerability[];
  vulnLoading: boolean;
  vulnTotal: number;
  sortBy: VulnerabilitySortKey;
  sortDir: 'asc' | 'desc';
  onSortChange: (key: VulnerabilitySortKey, direction: 'asc' | 'desc') => void;
  onOpenVulnerability: (vulnerability: Vulnerability) => void;
  renderSeverityBadge: (severity: string) => ReactNode;
  renderSourceBadge: (source?: string) => ReactNode;
  renderXrayPolicyCell?: (vulnerability: Vulnerability) => ReactNode;
  page?: number;
  totalPages?: number;
  paginationItems?: Array<number | 'ellipsis'>;
  onPageChange?: (page: number) => void;
  pageSize?: number;
}

const COLUMNS: Array<{ label: string; key: VulnerabilitySortKey; align: 'left' | 'right' }> = [
  { label: 'CVE ID', key: 'vuln_id', align: 'left' },
  { label: 'Package', key: 'pkg_name', align: 'left' },
  { label: 'Installed', key: 'installed_version', align: 'left' },
  { label: 'Fixed In', key: 'fixed_version', align: 'left' },
  { label: 'Severity', key: 'severity', align: 'left' },
  { label: 'CVSS', key: 'cvss_score', align: 'right' },
];

export function VulnerabilitiesTable({
  ariaLabel,
  vulns,
  vulnLoading,
  vulnTotal,
  sortBy,
  sortDir,
  onSortChange,
  onOpenVulnerability,
  renderSeverityBadge,
  renderSourceBadge,
  renderXrayPolicyCell,
  page = 1,
  totalPages = 1,
  paginationItems = [],
  onPageChange,
  pageSize = 25,
}: VulnerabilitiesTableProps) {
  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label={ariaLabel} className="min-w-[1120px]">
          <Table.Header>
            {COLUMNS.map(({ label, key, align }) => {
              const active = sortBy === key;
              return (
                <Table.Column
                  key={key}
                  isRowHeader={key === 'vuln_id'}
                  onClick={() => onSortChange(key, active && sortDir === 'asc' ? 'desc' : 'asc')}
                  className={`cursor-pointer select-none transition-colors ${
                    align === 'right' ? 'text-right' : 'text-left'
                  }`}
                  style={{ color: active ? 'var(--color-accent)' : undefined }}
                >
                  <span className="inline-flex items-center gap-1">
                    {label}
                    <span className={`transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}>
                      {active && sortDir === 'desc' ? '↓' : '↑'}
                    </span>
                  </span>
                </Table.Column>
              );
            })}
            {renderXrayPolicyCell && <Table.Column className="text-left">Xray Policy</Table.Column>}
          </Table.Header>
          <Table.Body>
            {vulnLoading ? (
              <Table.Row key="loading-row" id="loading">
                <Table.Cell colSpan={renderXrayPolicyCell ? 7 : 6}>
                  <div className="py-12 text-center">
                    <div className="flex justify-center">
                      <div className="size-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-accent animate-spin" />
                    </div>
                  </div>
                </Table.Cell>
              </Table.Row>
            ) : vulns.length === 0 ? (
              <Table.Row key="empty-row" id="empty">
                <Table.Cell colSpan={renderXrayPolicyCell ? 7 : 6}>
                  <div className="py-12 text-center text-zinc-500 text-sm">
                    {vulnTotal === 0 ? 'No vulnerabilities found.' : 'No results match your filters.'}
                  </div>
                </Table.Cell>
              </Table.Row>
            ) : (
              vulns.map((v) => (
                <Table.Row key={v.id} id={v.id} className="hover:bg-[var(--row-hover)]">
                  <Table.Cell>
                    {v.vuln_id ? (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => onOpenVulnerability(v)}
                          className="text-xs text-accent hover:text-accent/80 hover:underline transition-colors"
                        >
                          {v.vuln_id}
                        </button>
                        {renderSourceBadge(v.data_source)}
                      </div>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-600">-</span>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-xs text-zinc-700 dark:text-zinc-300">{v.pkg_name}</Table.Cell>
                  <Table.Cell className="text-xs text-zinc-500">{v.installed_version}</Table.Cell>
                  <Table.Cell className="text-xs text-emerald-500">
                    {v.fixed_version || <span className="text-zinc-400 dark:text-zinc-700">-</span>}
                  </Table.Cell>
                  <Table.Cell>{renderSeverityBadge(v.severity)}</Table.Cell>
                  <Table.Cell className="text-right text-xs text-zinc-500">
                    {v.cvss_score ? v.cvss_score.toFixed(1) : '-'}
                  </Table.Cell>
                  {renderXrayPolicyCell && <Table.Cell>{renderXrayPolicyCell(v)}</Table.Cell>}
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
      {onPageChange && totalPages > 1 && (
        <Table.Footer className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3">
          <span className="text-xs text-zinc-500 whitespace-nowrap">
            Showing {vulnTotal === 0 ? 0 : (page - 1) * pageSize + 1}-
            {Math.min(page * pageSize, vulnTotal)} of {vulnTotal}
          </span>
          <Pagination size="sm" className="justify-self-center">
            <Pagination.Content>
              <Pagination.Item>
                <Pagination.Previous
                  isDisabled={page === 1}
                  onPress={() => onPageChange(Math.max(1, page - 1))}
                >
                  <Pagination.PreviousIcon />
                  <span>Previous</span>
                </Pagination.Previous>
              </Pagination.Item>
              {paginationItems.map((item, index) =>
                item === 'ellipsis' ? (
                  <Pagination.Item key={`vuln-ellipsis-${index}`}>
                    <Pagination.Ellipsis />
                  </Pagination.Item>
                ) : (
                  <Pagination.Item key={`vuln-page-${item}`}>
                    <Pagination.Link isActive={item === page} onPress={() => onPageChange(item)}>
                      {item}
                    </Pagination.Link>
                  </Pagination.Item>
                )
              )}
              <Pagination.Item>
                <Pagination.Next
                  isDisabled={page === totalPages}
                  onPress={() => onPageChange(Math.min(totalPages, page + 1))}
                >
                  <span>Next</span>
                  <Pagination.NextIcon />
                </Pagination.Next>
              </Pagination.Item>
            </Pagination.Content>
          </Pagination>
          <span />
        </Table.Footer>
      )}
    </Table>
  );
}
