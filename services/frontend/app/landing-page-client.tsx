'use client';

import { Logo } from '@/components/logo';
import { Button, Chip, ProgressBar } from '@heroui/react';
import {
  ArrowRight01Icon,
  Building04Icon,
  Clock01Icon,
  FileExportIcon,
  GridTableIcon,
  Moon02Icon,
  Notification01Icon,
  PackageIcon,
  Search01Icon,
  ServerStack01Icon,
  Shield01Icon,
  Sun01Icon,
  Tag01Icon,
} from 'hugeicons-react';
import { motion, useReducedMotion } from 'motion/react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { ComponentType, useSyncExternalStore } from 'react';

type IconComponent = ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>;

const FEATURES: Array<{
  title: string;
  desc: string;
  Icon: IconComponent;
  className?: string;
  label: string;
}> = [
  {
    title: 'Image CVE detection',
    desc: 'Scan Docker images with Trivy-backed analysis and review findings by severity, package, layer, and fix status.',
    Icon: Search01Icon,
    className: 'lg:col-span-2',
    label: 'Core scan',
  },
  {
    title: 'Helm chart scanning',
    desc: 'Extract image references from Helm charts and scan the workload before it reaches a cluster.',
    Icon: PackageIcon,
    label: 'Charts',
  },
  {
    title: 'SBOM export',
    desc: 'Export CycloneDX or SPDX evidence for audits, handoffs, and release reviews.',
    Icon: FileExportIcon,
    label: 'Evidence',
  },
  {
    title: 'Watchlists',
    desc: 'Schedule recurring scans for important images and catch newly disclosed CVEs over time.',
    Icon: Notification01Icon,
    className: 'lg:row-span-2',
    label: 'Recurring',
  },
  {
    title: 'Organizations',
    desc: 'Share scans, reports, suppressions, and private workflows with the teams that need them.',
    Icon: Building04Icon,
    label: 'Teams',
  },
  {
    title: 'Audit trail',
    desc: 'Track scan activity, exports, and access changes when security work needs a paper trail.',
    Icon: GridTableIcon,
    label: 'Governance',
  },
  {
    title: 'Trivy and Xray workflows',
    desc: 'Start instantly with public scans, then route private registry workflows through Artifactory/Xray when you sign in.',
    Icon: ServerStack01Icon,
    className: 'lg:col-span-2',
    label: 'Engines',
  },
];

const STEPS = [
  [
    '1',
    'Paste an image or chart',
    'Start with a public image reference or a Helm chart URL. No account is needed for the first scan.',
  ],
  [
    '2',
    'Watch the scan resolve',
    'JustScan runs the scanner, separates findings by severity, and shows which package introduced each CVE.',
  ],
  [
    '3',
    'Keep the useful context',
    'Sign in when you want saved history, SBOM exports, team sharing, watchlists, and private registry workflows.',
  ],
] as const;

function useMountedTheme() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  return {
    isDark: mounted && resolvedTheme === 'dark',
    mounted,
    setTheme,
  };
}

function ScanAnimation() {
  const reduceMotion = useReducedMotion();
  const images = [
    { label: 'nginx:latest', delay: 0 },
    { label: 'python:3.11-slim', delay: 1.35 },
    { label: 'postgres:16-alpine', delay: 2.7 },
  ];
  const findings = [
    { id: 'CRITICAL', tone: 'critical', delay: 0.82, top: 122 },
    { id: 'HIGH', tone: 'high', delay: 1.24, top: 166 },
    { id: 'SBOM', tone: 'ready', delay: 1.68, top: 212 },
  ];

  return (
    <div className="pointer-events-none relative mx-auto h-[440px] w-full max-w-[640px] select-none overflow-visible">
      <div
        className="absolute inset-x-6 top-1/2 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 24%, transparent), color-mix(in srgb, var(--accent) 44%, transparent), color-mix(in srgb, var(--accent) 24%, transparent), transparent)',
        }}
      />
      <div
        className="absolute inset-x-14 top-[calc(50%-4.5rem)] h-36 rounded-full blur-3xl"
        style={{
          background:
            'radial-gradient(circle, color-mix(in srgb, var(--accent) 15%, transparent) 0%, transparent 70%)',
        }}
      />

      {images.map((image) => (
        <motion.div
          key={image.label}
          className="absolute top-[172px] flex items-center gap-3 rounded-full border border-divider/70 bg-background/75 px-4 py-2 text-sm shadow-sm backdrop-blur"
          initial={{ x: -150, opacity: 0 }}
          animate={
            reduceMotion
              ? { opacity: [0, 1, 0] }
              : {
                  x: [-150, 62, 205, 205, 440],
                  opacity: [0, 1, 1, 1, 0],
                  scale: [0.96, 1, 1, 0.98, 0.96],
                }
          }
          transition={{
            delay: image.delay,
            duration: 4.45,
            ease: 'easeInOut',
            repeat: Infinity,
            repeatDelay: 0.55,
            times: reduceMotion ? [0, 0.5, 1] : [0, 0.18, 0.42, 0.58, 1],
          }}
        >
          <PackageIcon className="text-accent" size={18} aria-hidden />
          <span className="font-medium text-foreground">{image.label}</span>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </motion.div>
      ))}

      <motion.div
        className="absolute left-1/2 top-[92px] flex h-[250px] w-[94px] -translate-x-1/2 items-center justify-center rounded-[2rem] border border-accent/50 bg-accent/10 shadow-[0_0_64px_color-mix(in_srgb,var(--accent)_28%,transparent)] backdrop-blur"
        animate={reduceMotion ? { opacity: 0.9 } : { opacity: [0.82, 1, 0.82] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
      >
        <div className="absolute inset-3 rounded-[1.5rem] border border-accent/20" />
        <Shield01Icon className="text-accent" size={32} aria-hidden />
        <motion.div
          className="absolute inset-x-0 h-0.5 rounded-full bg-accent shadow-[0_0_18px_var(--accent)]"
          animate={
            reduceMotion ? { opacity: 0.65 } : { y: [-84, 84, -84], opacity: [0.45, 1, 0.45] }
          }
          transition={{ duration: 2.35, repeat: Infinity, ease: 'easeInOut' }}
        />
      </motion.div>

      {findings.map((finding) => {
        const toneClass =
          finding.tone === 'critical'
            ? 'border-red-500/30 bg-red-500/10 text-red-500'
            : finding.tone === 'high'
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-500'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500';

        return (
          <motion.div
            key={finding.id}
            className={`absolute left-[61%] rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur ${toneClass}`}
            style={{ top: finding.top }}
            initial={{ x: -8, y: 18, opacity: 0, scale: 0.92 }}
            animate={
              reduceMotion
                ? { opacity: [0, 1, 0] }
                : {
                    x: [-8, 34, 58],
                    y: [18, -8, -18],
                    opacity: [0, 1, 1, 0],
                    scale: [0.92, 1, 1, 0.96],
                  }
            }
            transition={{
              delay: finding.delay,
              duration: 3.6,
              ease: 'easeOut',
              repeat: Infinity,
              repeatDelay: 1.4,
              times: reduceMotion ? [0, 0.5, 1] : [0, 0.24, 0.74, 1],
            }}
          >
            {finding.id}
          </motion.div>
        );
      })}

      <div className="absolute bottom-16 right-[8%] w-[210px] rounded-[1.5rem] border border-divider/60 bg-background/55 p-4 shadow-sm backdrop-blur">
        <div className="mb-3 flex items-center justify-between text-xs text-muted">
          <span>Finding summary</span>
          <span>live</span>
        </div>
        <div className="space-y-2">
          {['critical', 'high', 'medium'].map((severity, index) => (
            <div key={severity} className="flex items-center gap-2">
              <span
                className={
                  index === 0
                    ? 'h-1.5 w-8 rounded-full bg-red-500'
                    : index === 1
                      ? 'h-1.5 w-12 rounded-full bg-amber-500'
                      : 'h-1.5 w-16 rounded-full bg-blue-500'
                }
              />
              <span className="text-xs text-muted">{severity}</span>
            </div>
          ))}
        </div>
      </div>

      <div
        className="absolute inset-0 -z-10 rounded-[3rem]"
        style={{
          background:
            'radial-gradient(circle at 52% 42%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 38%)',
        }}
      />
    </div>
  );
}

function FeatureTile({
  title,
  desc,
  Icon,
  className,
  label,
}: {
  title: string;
  desc: string;
  Icon: IconComponent;
  className?: string;
  label: string;
}) {
  return (
    <div
      className={`group relative min-h-[230px] overflow-hidden rounded-[2rem] border border-divider/50 bg-surface/55 p-6 transition-colors hover:border-accent/30 ${className ?? ''}`}
    >
      <div
        className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{
          background:
            'radial-gradient(circle at 85% 10%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 36%)',
        }}
      />
      <div className="relative flex h-full flex-col">
        <div className="flex items-start justify-between gap-4">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            <Icon size={25} aria-hidden />
          </div>
          <span className="rounded-full border border-divider/60 px-3 py-1 text-xs text-muted">
            {label}
          </span>
        </div>
        <div className="mt-auto pt-8">
          <h3 className="text-xl font-semibold text-foreground">{title}</h3>
          <p className="mt-3 text-sm leading-6 text-muted">{desc}</p>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const { isDark, mounted, setTheme } = useMountedTheme();

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: isDark
            ? 'linear-gradient(180deg, color-mix(in srgb, var(--background) 92%, #07111b) 0%, var(--background) 42%, color-mix(in srgb, var(--background) 96%, #05070c) 100%)'
            : 'linear-gradient(180deg, color-mix(in srgb, var(--background) 88%, #f4f8fd) 0%, var(--background) 42%, color-mix(in srgb, var(--background) 94%, #eef4fa) 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.55] dark:opacity-[0.42]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--accent) 34%, transparent) 1.15px, transparent 0), linear-gradient(180deg, color-mix(in srgb, var(--foreground) 5%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--foreground) 4%, transparent) 1px, transparent 1px)',
          backgroundPosition: 'center top, center top, center top',
          backgroundSize: '24px 24px, 24px 24px, 24px 24px',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: isDark
            ? 'radial-gradient(circle at 50% 10%, color-mix(in srgb, var(--accent) 11%, transparent), transparent 26%), radial-gradient(circle at 50% 54%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 24%), radial-gradient(circle at 50% 100%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 22%)'
            : 'radial-gradient(circle at 50% 8%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 22%), radial-gradient(circle at 50% 54%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 20%), radial-gradient(circle at 50% 100%, color-mix(in srgb, var(--accent) 6%, transparent), transparent 18%)',
        }}
      />

      <section className="relative z-10 overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: isDark
              ? 'linear-gradient(180deg, color-mix(in srgb, var(--background) 82%, #05111c) 0%, color-mix(in srgb, var(--background) 50%, transparent) 72%, transparent 100%)'
              : 'linear-gradient(180deg, color-mix(in srgb, var(--background) 76%, #edf7ff) 0%, color-mix(in srgb, var(--background) 44%, transparent) 72%, transparent 100%)',
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-45"
          style={{
            background:
              'radial-gradient(circle at 64% 48%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 28%)',
          }}
        />

        <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-3">
            <Logo size={34} />
            <span className="text-sm font-semibold tracking-normal text-foreground">JustScan</span>
          </Link>

          <div className="flex items-center gap-2">
            {mounted ? (
              <Button
                isIconOnly
                aria-label="Toggle theme"
                variant="tertiary"
                onPress={() => setTheme(isDark ? 'light' : 'dark')}
              >
                {isDark ? (
                  <Sun01Icon size={16} aria-hidden />
                ) : (
                  <Moon02Icon size={16} aria-hidden />
                )}
              </Button>
            ) : null}
            <Link href="/login">
              <Button variant="secondary">Sign in</Button>
            </Link>
          </div>
        </header>

        <div className="relative z-10 mx-auto grid min-h-[calc(100svh-76px)] max-w-7xl items-center gap-10 px-6 pb-16 pt-6 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="max-w-2xl space-y-7">
            <Chip color="accent" variant="soft">
              Self-hosted vulnerability scanner
            </Chip>

            <div className="space-y-5">
              <h1 className="text-5xl font-semibold leading-[1.05] tracking-normal text-foreground sm:text-6xl lg:text-7xl">
                Scan container images before they ship.
              </h1>
              <p className="max-w-xl text-base leading-7 text-muted sm:text-lg">
                JustScan turns image and Helm chart scans into clear CVE findings, SBOM exports,
                reports, watchlists, and team workflows.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/public/scan/image" className="w-full sm:w-auto">
                <Button fullWidth size="lg">
                  Scan Docker image
                  <ArrowRight01Icon size={18} aria-hidden />
                </Button>
              </Link>
              <Link href="/public/scan/helm" className="w-full sm:w-auto">
                <Button fullWidth size="lg" variant="secondary">
                  Scan Helm chart
                </Button>
              </Link>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
              <span>Public scans without an account</span>
              <span>Trivy and Artifactory/Xray workflows</span>
              <span>Self-hosted control</span>
            </div>
          </div>

          <ScanAnimation />
        </div>
      </section>

      <main className="relative z-10">
        <section className="px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <div className="mb-12 max-w-3xl">
              <Chip color="accent" variant="soft">
                Feature map
              </Chip>
              <h2 className="mt-4 text-3xl font-semibold tracking-normal text-foreground sm:text-5xl">
                One workspace for the scan, the evidence, and the follow-up.
              </h2>
              <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
                The public entry point stays simple. The deeper workflows are ready when your team
                needs recurring checks, shared reports, and private registry coverage.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <FeatureTile key={feature.title} {...feature} />
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-divider/60 px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-12 lg:grid-cols-[0.8fr_1fr] lg:items-center">
              <div className="space-y-5">
                <Chip color="accent" variant="soft">
                  How it works
                </Chip>
                <h2 className="max-w-xl text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
                  A public scan first. A workspace when you need one.
                </h2>
                <p className="max-w-lg text-sm leading-6 text-muted sm:text-base">
                  The homepage should feel useful before signup. You can scan an image immediately,
                  then create an account when the result becomes something your team should keep,
                  share, or monitor.
                </p>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Link href="/public/scan/image" className="w-full sm:w-auto">
                    <Button fullWidth size="lg">
                      Scan without account
                      <ArrowRight01Icon size={18} aria-hidden />
                    </Button>
                  </Link>
                  <Link href="/login" className="w-full sm:w-auto">
                    <Button fullWidth size="lg" variant="secondary">
                      Sign in to save scans
                    </Button>
                  </Link>
                </div>
              </div>

              <div className="grid gap-3">
                {STEPS.map(([number, title, desc]) => (
                  <div
                    key={title}
                    className="group grid gap-4 rounded-[1.5rem] border border-divider/60 bg-surface/35 p-4 transition-colors hover:border-accent/30 sm:grid-cols-[3rem_1fr] sm:p-5"
                  >
                    <div className="flex size-11 items-center justify-center rounded-2xl bg-accent/10 text-sm font-semibold text-accent">
                      {number}
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
                      <p className="mt-2 text-sm leading-6 text-muted">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="px-6 py-20">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-center">
            <div className="space-y-5">
              <Chip color="accent" variant="soft">
                Why sign up
              </Chip>
              <h2 className="text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
                Free scans are the doorway. Accounts make the findings useful over time.
              </h2>
              <p className="max-w-2xl text-base leading-7 text-muted">
                You can scan without friction, but signing in lets you keep scan history, export
                evidence, work with teammates, schedule watchlists, and connect private registry
                workflows.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link href="/login" className="w-full sm:w-auto">
                  <Button fullWidth size="lg">
                    Create workspace
                    <ArrowRight01Icon size={18} aria-hidden />
                  </Button>
                </Link>
                <Link href="/public/scan/image" className="w-full sm:w-auto">
                  <Button fullWidth size="lg" variant="secondary">
                    Try a public scan first
                  </Button>
                </Link>
              </div>
            </div>

            <div className="space-y-6 rounded-[2rem] bg-surface/50 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">Watchlist posture</p>
                  <p className="mt-1 text-xs text-muted">12 images monitored across 3 teams</p>
                </div>
                <Clock01Icon className="text-accent" size={26} aria-hidden />
              </div>
              <ProgressBar aria-label="Findings reviewed" value={78}>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted">Findings reviewed</span>
                  <ProgressBar.Output className="text-xs text-muted" />
                </div>
                <ProgressBar.Track>
                  <ProgressBar.Fill />
                </ProgressBar.Track>
              </ProgressBar>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ['24 scans', Search01Icon],
                  ['8 reports', FileExportIcon],
                  ['Team access', Building04Icon],
                  ['Audit trail', GridTableIcon],
                ].map(([label, Icon]) => {
                  const ItemIcon = Icon as IconComponent;

                  return (
                    <div
                      key={label as string}
                      className="flex items-center gap-3 rounded-2xl bg-background/50 p-3"
                    >
                      <ItemIcon className="text-accent" size={18} aria-hidden />
                      <span className="font-medium text-foreground">{label as string}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="px-6 pb-24">
          <div className="mx-auto max-w-7xl rounded-[2.5rem] bg-accent/10 px-6 py-12 text-center sm:px-12">
            <Tag01Icon className="mx-auto text-accent" size={34} aria-hidden />
            <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
              Start with one image. Keep the evidence when it matters.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted">
              Paste a Docker image reference, scan it, and turn the result into a report, an SBOM,
              or a recurring watchlist entry.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/public/scan/image" className="w-full sm:w-auto">
                <Button fullWidth size="lg">
                  Scan Docker image
                  <ArrowRight01Icon size={18} aria-hidden />
                </Button>
              </Link>
              <Link href="/login" className="w-full sm:w-auto">
                <Button fullWidth size="lg" variant="secondary">
                  Sign in
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
