'use client';

import { Card, Chip, Separator } from '@heroui/react';
import { Clock01Icon, PackageIcon, Search01Icon, Shield01Icon } from 'hugeicons-react';

const FINDINGS = [
  {
    cve: 'CVE-2026-46595',
    fixed: 'v0.52.0',
    packageName: 'golang.org/x/crypto',
    severity: 'Critical',
    tone: 'danger' as const,
  },
  {
    cve: 'CVE-2026-39821',
    fixed: 'v0.55.0',
    packageName: 'golang.org/x/net',
    severity: 'High',
    tone: 'warning' as const,
  },
  {
    cve: 'CVE-2026-34182',
    fixed: '3.5.7-r0',
    packageName: 'libcrypto3',
    severity: 'High',
    tone: 'warning' as const,
  },
] as const;

const WATCHLIST_ITEMS = [
  {
    image: 'ghcr.io/team/api:stable',
    metadata: 'Daily · Platform team',
    status: 'Stable',
    tone: 'success' as const,
  },
  {
    image: 'registry.local/payments:release',
    metadata: 'On push · Payments',
    status: 'Review',
    tone: 'warning' as const,
  },
  {
    image: 'docker.io/library/nginx:mainline',
    metadata: 'Weekly · Shared services',
    status: 'Scheduled',
    tone: 'default' as const,
  },
] as const;

export function FindingPreview() {
  return (
    <Card
      className="overflow-hidden border-divider/70 bg-surface shadow-sm shadow-foreground/5"
      variant="default"
    >
      <Card.Header className="flex-row items-start justify-between gap-4 border-b border-divider/60 pb-5">
        <div>
          <Card.Title>Prioritized findings</Card.Title>
          <Card.Description className="mt-1">
            Fix context stays beside severity and package data.
          </Card.Description>
        </div>
        <Chip color="accent" size="sm" variant="soft">
          Example result
        </Chip>
      </Card.Header>
      <Card.Content className="space-y-5 pt-5">
        <div className="grid grid-cols-3 divide-x divide-divider/60 rounded-xl border border-divider/60 bg-surface-secondary/50">
          {[
            ['Critical + high', '14'],
            ['Fixable', '9'],
            ['Policy blockers', '1'],
          ].map(([label, value]) => (
            <div key={label} className="px-3 py-3 sm:px-4">
              <p className="text-[11px] leading-4 text-muted">{label}</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
            </div>
          ))}
        </div>

        <div aria-label="Example vulnerability findings" className="space-y-1" role="list">
          {FINDINGS.map((finding) => (
            <div
              key={finding.cve}
              className="grid gap-3 rounded-lg px-2 py-2.5 sm:grid-cols-[1.05fr_1.25fr_auto_auto] sm:items-center"
              role="listitem"
            >
              <div>
                <p className="font-mono text-xs font-medium text-accent sm:text-sm">
                  {finding.cve}
                </p>
                <p className="mt-1 text-xs text-muted sm:hidden">{finding.packageName}</p>
              </div>
              <span className="hidden truncate text-sm text-foreground sm:block">
                {finding.packageName}
              </span>
              <Chip color={finding.tone} size="sm" variant="soft">
                {finding.severity}
              </Chip>
              <span className="text-xs text-success">Fixed in {finding.fixed}</span>
            </div>
          ))}
        </div>
      </Card.Content>
    </Card>
  );
}

export function WatchlistPreview() {
  return (
    <Card
      className="overflow-hidden border-divider/70 bg-surface shadow-sm shadow-foreground/5"
      variant="default"
    >
      <Card.Header className="flex-row items-start justify-between gap-4 border-b border-divider/60 pb-5">
        <div>
          <Card.Title>Continuous coverage</Card.Title>
          <Card.Description className="mt-1">
            Scheduled scans remain connected to teams and ownership.
          </Card.Description>
        </div>
        <Clock01Icon aria-hidden className="text-accent" size={22} />
      </Card.Header>
      <Card.Content className="space-y-4 pt-5">
        <div className="divide-y divide-divider/60 rounded-xl border border-divider/60 bg-surface-secondary/40 px-4">
          {WATCHLIST_ITEMS.map((item) => (
            <div
              key={item.image}
              className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <PackageIcon aria-hidden size={17} />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs font-medium text-foreground sm:text-sm">
                    {item.image}
                  </p>
                  <p className="mt-1 text-xs text-muted">{item.metadata}</p>
                </div>
              </div>
              <Chip color={item.tone} size="sm" variant="soft">
                {item.status}
              </Chip>
            </div>
          ))}
        </div>

        <Separator variant="tertiary" />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
          <span className="flex items-center gap-2">
            <Search01Icon aria-hidden size={15} /> New CVEs surface automatically
          </span>
          <span className="flex items-center gap-2">
            <Shield01Icon aria-hidden size={15} /> Ownership stays visible
          </span>
        </div>
      </Card.Content>
    </Card>
  );
}
