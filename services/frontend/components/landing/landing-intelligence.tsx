'use client';

import { LandingButtonLink } from '@/components/landing/landing-controls';
import { LandingReveal } from '@/components/landing/landing-motion';
import { Button, Card, Chip, Link } from '@heroui/react';
import {
  ArrowUpRight01Icon,
  CheckmarkCircle02Icon,
  DatabaseSyncIcon,
  Shield01Icon,
} from 'hugeicons-react';
import { useState } from 'react';

const INTELLIGENCE_EVENTS = [
  {
    cve: 'CVE-2026-46595',
    label: 'Rejected by source',
    packageName: 'golang.org/x/crypto',
    time: '12 min ago',
    tone: 'success' as const,
    detail:
      'The current intelligence posture no longer treats this finding as affected. The original scan result remains available for audit.',
  },
  {
    cve: 'CVE-2026-39821',
    label: 'Severity increased',
    packageName: 'openssl / libcrypto3',
    time: '28 min ago',
    tone: 'danger' as const,
    detail:
      'Current CVSS moved from 7.4 to 9.1. Review the policy impact and rescan before the next release.',
  },
  {
    cve: 'CVE-2026-34182',
    label: 'Needs validation',
    packageName: 'curl',
    time: '41 min ago',
    tone: 'warning' as const,
    detail:
      'Sources disagree about the affected range. JustScan keeps the historical finding active until a confirming scan runs.',
  },
] as const;

export function LandingIntelligenceSection() {
  const [selected, setSelected] = useState(0);
  const event = INTELLIGENCE_EVENTS[selected];

  return (
    <section
      id="intelligence"
      className="landing-intelligence-section relative scroll-mt-24 overflow-hidden px-5 py-20 sm:px-6 lg:py-28"
      aria-labelledby="landing-intelligence-title"
    >
      <div aria-hidden className="landing-intelligence-glow pointer-events-none absolute inset-0" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-12 lg:gap-16">
        <LandingReveal className="lg:col-span-5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted">
            <span aria-hidden className="landing-intelligence-kicker-dot" />
            CVE intelligence
          </div>
          <h2
            id="landing-intelligence-title"
            className="mt-5 max-w-xl text-4xl font-semibold leading-[0.98] tracking-[-0.055em] text-foreground sm:text-5xl lg:text-6xl"
          >
            Your scan is a snapshot. Your risk picture should not be.
          </h2>
          <p className="mt-6 max-w-xl text-base leading-7 text-muted sm:text-lg sm:leading-8">
            Track what changed after the scan, understand the policy impact, and know when a rescan
            is the only answer that closes the loop.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <LandingButtonLink
              href="/vulnkb"
              label="Explore CVE intelligence"
              showArrow
              size="lg"
            />
            <Link className="inline-flex items-center gap-1.5 text-sm text-muted" href="/docs">
              Read the workflow
              <ArrowUpRight01Icon aria-hidden size={14} />
            </Link>
          </div>
          <div
            className="mt-10 flex flex-wrap gap-x-7 gap-y-4 border-t border-divider/70 pt-5"
            aria-label="CVE intelligence highlights"
          >
            <div className="grid gap-0.5">
              <strong className="text-xl font-semibold tracking-[-0.04em] text-foreground">
                7,412
              </strong>
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
                CVE records tracked
              </span>
            </div>
            <div className="grid gap-0.5">
              <strong className="text-xl font-semibold tracking-[-0.04em] text-foreground">
                Live
              </strong>
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
                Source history
              </span>
            </div>
            <div className="grid gap-0.5">
              <strong className="text-xl font-semibold tracking-[-0.04em] text-foreground">
                Scoped
              </strong>
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
                Policy impact
              </span>
            </div>
          </div>
        </LandingReveal>

        <LandingReveal className="lg:col-span-7" delay={0.05}>
          <Card className="landing-intelligence-panel overflow-hidden p-0" variant="default">
            <span className="landing-intelligence-scan-beam" aria-hidden />
            <div className="landing-intelligence-panel-header">
              <div>
                <p className="landing-intelligence-panel-eyebrow">Example workspace</p>
                <p className="mt-1 text-sm font-semibold text-foreground">Intelligence stream</p>
              </div>
              <Chip color="accent" size="sm" variant="soft">
                <DatabaseSyncIcon aria-hidden size={13} />
                Live posture
              </Chip>
            </div>
            <ul className="landing-intelligence-list" aria-label="Recent CVE intelligence changes">
              {INTELLIGENCE_EVENTS.map((item, index) => (
                <li key={item.cve}>
                  <Button
                    fullWidth
                    className={`landing-intelligence-row landing-intelligence-enter landing-intelligence-enter-${index + 1}`}
                    data-selected={selected === index}
                    variant="ghost"
                    onPress={() => setSelected(index)}
                  >
                    <span
                      className="landing-intelligence-marker"
                      data-tone={item.tone}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="landing-intelligence-row-title">{item.cve}</span>
                      <span className="landing-intelligence-row-meta">
                        <span>{item.label}</span>
                        <span aria-hidden>·</span>
                        <span>{item.packageName}</span>
                      </span>
                    </span>
                    <span className="whitespace-nowrap text-[10px] text-muted">{item.time}</span>
                  </Button>
                </li>
              ))}
            </ul>
            <div className="landing-intelligence-detail" aria-live="polite">
              <p>
                <strong>{event.label}.</strong> {event.detail}
              </p>
              <Link className="landing-intelligence-detail-link" href={`/vulnkb/${event.cve}`}>
                Open {event.cve}
                <ArrowUpRight01Icon aria-hidden size={14} />
              </Link>
            </div>
            <Card.Footer className="flex items-center justify-between gap-3 border-t border-divider/60 px-5 py-4">
              <span className="flex items-center gap-2 text-xs text-muted">
                <Shield01Icon aria-hidden className="text-accent" size={15} />
                Original scan verdicts stay immutable
              </span>
              <CheckmarkCircle02Icon aria-hidden className="text-success" size={17} />
            </Card.Footer>
          </Card>
        </LandingReveal>
      </div>
    </section>
  );
}
