import { Card, Chip, ProgressBar } from '@heroui/react';
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

export function HeroProductDemo() {
  return (
    <div className="landing-demo-shell relative mx-auto w-full max-w-[520px] lg:ml-auto">
      <div className="landing-hero-halo pointer-events-none absolute inset-x-12 inset-y-8 -z-10 rounded-full blur-3xl" />
      <Card
        className="overflow-hidden border-divider/70 bg-background/88 shadow-xl shadow-accent/5 backdrop-blur-xl"
        variant="secondary"
      >
        <Card.Header className="flex-row items-center justify-between gap-4 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <PackageIcon aria-hidden size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Example scan</p>
              <p className="mt-0.5 text-xs text-muted">Public image workflow</p>
            </div>
          </div>
          <Chip color="accent" size="sm" variant="soft">
            Example
          </Chip>
        </Card.Header>

        <Card.Content className="pt-0">
          <p className="sr-only">
            Example container scan: a public source is connected, analyzed, and summarized as 14
            actionable findings with 9 fixes available.
          </p>

          <div aria-hidden className="relative grid grid-cols-3 border-y border-divider/60">
            <div className="landing-demo-highlight absolute inset-x-auto bottom-[-1px] left-0 h-0.5 w-1/3 bg-accent" />
            {['Source', 'Analyze', 'Result'].map((stage, index) => (
              <div
                key={stage}
                className="flex items-center justify-center gap-2 py-3 text-[11px] font-medium text-muted sm:text-xs"
              >
                <span className="text-[10px] tabular-nums text-accent">{index + 1}</span>
                <span>{stage}</span>
              </div>
            ))}
          </div>

          <div aria-hidden className="relative min-h-[226px] overflow-hidden">
            <div className="landing-demo-phase landing-demo-phase--source absolute inset-0 flex flex-col justify-center opacity-100">
              <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-accent">
                Source connected
              </span>
              <p className="mt-3 truncate text-lg font-semibold text-foreground sm:text-xl">
                ghcr.io/acme/payments:1.8.4
              </p>
              <p className="mt-2 text-sm text-muted">Public registry · No credentials required</p>
            </div>

            <div className="landing-demo-phase landing-demo-phase--scan absolute inset-0 flex flex-col justify-center opacity-0">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <Search01Icon aria-hidden size={17} />
                </span>
                <div>
                  <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-accent">
                    Analyzing image
                  </span>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    Scanning 212 packages
                  </p>
                </div>
              </div>

              <ProgressBar
                aria-label="Example scan progress"
                className="mt-6"
                color="accent"
                size="sm"
                value={68}
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="text-xs text-muted">Trivy analysis</span>
                  <ProgressBar.Output className="text-xs text-muted" />
                </div>
                <ProgressBar.Track>
                  <ProgressBar.Fill />
                </ProgressBar.Track>
              </ProgressBar>
              <p className="mt-3 text-xs text-muted">Packages indexed · SBOM prepared</p>
            </div>

            <div className="landing-demo-phase landing-demo-phase--result absolute inset-0 flex flex-col justify-center opacity-0">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success">
                  <Shield01Icon aria-hidden size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-success">
                    Result ready
                  </span>
                  <p className="mt-1 text-xl font-semibold tracking-[-0.02em] text-foreground sm:text-2xl">
                    14 actionable findings
                  </p>
                  <p className="mt-1 text-sm text-muted">9 fixes are available now</p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Chip color="danger" size="sm" variant="soft">
                  3 critical
                </Chip>
                <Chip color="warning" size="sm" variant="soft">
                  11 high
                </Chip>
                <Chip color="success" size="sm" variant="soft">
                  9 fixes available
                </Chip>
              </div>

              <div className="mt-5 flex flex-col gap-1 border-t border-divider/60 pt-4 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span className="text-muted">Top fix</span>
                <span className="truncate font-medium text-foreground">
                  golang.org/x/crypto → v0.52.0
                </span>
              </div>
            </div>
          </div>
        </Card.Content>
      </Card>
    </div>
  );
}

export function FindingPreview() {
  return (
    <Card className="overflow-hidden border-divider/70 bg-surface/55" variant="secondary">
      <Card.Header className="flex-row items-start justify-between gap-4 border-b border-divider/60 pb-4">
        <div>
          <Card.Title>Prioritized findings</Card.Title>
          <Card.Description className="mt-1">
            Fix context stays next to severity and package data.
          </Card.Description>
        </div>
        <Chip color="accent" size="sm" variant="soft">
          Example result
        </Chip>
      </Card.Header>
      <Card.Content className="pt-4">
        <div className="grid grid-cols-3 gap-2 pb-4">
          {[
            ['Critical + high', '14'],
            ['Fixable', '9'],
            ['Policy blockers', '1'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-background/65 p-3">
              <p className="text-[11px] leading-4 text-muted">{label}</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
            </div>
          ))}
        </div>

        <div className="space-y-2" aria-label="Example vulnerability findings" role="list">
          {FINDINGS.map((finding) => (
            <div
              key={finding.cve}
              className="grid gap-3 rounded-xl border border-divider/60 bg-background/55 p-3 sm:grid-cols-[1.1fr_1.2fr_auto_auto] sm:items-center"
              role="listitem"
            >
              <div>
                <p className="text-sm font-medium text-accent">{finding.cve}</p>
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
    <Card className="overflow-hidden border-divider/70 bg-surface/55" variant="secondary">
      <Card.Header className="flex-row items-start justify-between gap-4 border-b border-divider/60 pb-4">
        <div>
          <Card.Title>Continuous coverage</Card.Title>
          <Card.Description className="mt-1">
            Scheduled scans stay connected to teams and ownership.
          </Card.Description>
        </div>
        <Clock01Icon aria-hidden className="text-accent" size={22} />
      </Card.Header>
      <Card.Content className="space-y-3 pt-4">
        {WATCHLIST_ITEMS.map((item) => (
          <div
            key={item.image}
            className="flex flex-col gap-3 rounded-xl border border-divider/60 bg-background/55 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <PackageIcon aria-hidden size={17} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{item.image}</p>
                <p className="mt-1 text-xs text-muted">{item.metadata}</p>
              </div>
            </div>
            <Chip color={item.tone} size="sm" variant="soft">
              {item.status}
            </Chip>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-4 border-t border-divider/60 pt-4 text-xs text-muted">
          <span className="flex items-center gap-2">
            <Search01Icon aria-hidden size={15} /> New CVEs surfaced automatically
          </span>
          <span className="flex items-center gap-2">
            <Shield01Icon aria-hidden size={15} /> Ownership stays visible
          </span>
        </div>
      </Card.Content>
    </Card>
  );
}
