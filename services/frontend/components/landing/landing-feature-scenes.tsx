import { LandingButtonLink } from '@/components/landing/landing-controls';
import { LandingFaq } from '@/components/landing/landing-faq';
import { LandingReveal } from '@/components/landing/landing-motion';
import { Card, Chip, Separator, Surface } from '@heroui/react';
import {
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  CloudServerIcon,
  CodeFolderIcon,
  ComingSoon02Icon,
  CommandLineIcon,
  FileSearchIcon,
  GitBranchIcon,
  GitCompareIcon,
  PackageIcon,
  Search01Icon,
  Shield01Icon,
  WorkflowSquare06Icon,
} from 'hugeicons-react';
import type { ReactNode } from 'react';

function SectionIntro({
  eyebrow,
  title,
  description,
  centered = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  centered?: boolean;
}) {
  return (
    <div className={centered ? 'mx-auto max-w-4xl text-center' : 'max-w-2xl'}>
      <Chip color="accent" size="sm" variant="soft">
        {eyebrow}
      </Chip>
      <h2 className="mt-5 text-4xl font-semibold leading-[1.04] tracking-[-0.045em] text-foreground sm:text-5xl lg:text-6xl">
        {title}
      </h2>
      <p
        className={`mt-5 text-base leading-7 text-muted sm:text-lg sm:leading-8 ${
          centered ? 'mx-auto max-w-2xl' : ''
        }`}
      >
        {description}
      </p>
    </div>
  );
}

function StageFrame({
  children,
  className = '',
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <Surface
      aria-label={label}
      className={`landing-stage landing-technical-grid relative isolate overflow-hidden rounded-2xl border border-divider/80 ${className}`}
      variant="secondary"
    >
      <div aria-hidden className="landing-stage-glow pointer-events-none absolute inset-0 -z-10" />
      {children}
    </Surface>
  );
}

function ScanPipelineScene() {
  return (
    <div className="relative flex min-h-64 items-center justify-center overflow-hidden p-6 sm:min-h-72 sm:p-8">
      <div className="relative flex w-full max-w-lg items-center justify-between">
        <div className="landing-scene-node">
          <PackageIcon aria-hidden size={22} />
          <span>image</span>
        </div>
        <div aria-hidden className="landing-scene-track left-[18%] right-[18%] top-1/2">
          <span className="landing-scene-packet" />
        </div>
        <div className="landing-scanner-node relative z-10">
          <span aria-hidden className="landing-scanner-beam" />
          <Search01Icon aria-hidden size={28} />
          <span>analyze</span>
        </div>
        <div className="landing-scene-node">
          <Shield01Icon aria-hidden size={22} />
          <span>verdict</span>
        </div>
      </div>

      <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.18em] text-muted">
        <span>Pull</span>
        <span className="text-accent">Prioritize</span>
        <span>Decide</span>
      </div>
    </div>
  );
}

function RemediationScene() {
  const rows = [
    ['CVE-2026-46595', 'critical', '0.52.0'],
    ['CVE-2026-39821', 'high', '0.55.0'],
    ['CVE-2026-34182', 'high', '3.5.7-r0'],
  ] as const;

  return (
    <div className="relative min-h-64 p-5 sm:min-h-72 sm:p-7">
      <div className="mb-5 flex items-center justify-between">
        <span className="text-xs font-medium text-muted">Fixable findings</span>
        <span className="landing-live-badge">
          <span aria-hidden />
          live
        </span>
      </div>
      <div className="space-y-2">
        {rows.map(([cve, severity, fixed], index) => (
          <div
            key={cve}
            className="landing-finding-row grid grid-cols-[1fr_auto] gap-3 rounded-xl border border-divider/70 bg-surface/80 px-3 py-3"
            style={{ animationDelay: `${index * 1.15}s` }}
          >
            <div className="min-w-0">
              <p className="truncate font-mono text-xs font-medium text-foreground">{cve}</p>
              <p className="mt-1 text-[11px] text-muted">
                {index === 0
                  ? 'golang.org/x/crypto'
                  : index === 1
                    ? 'golang.org/x/net'
                    : 'libcrypto3'}
              </p>
            </div>
            <div className="text-right">
              <p
                className={severity === 'critical' ? 'text-xs text-danger' : 'text-xs text-warning'}
              >
                {severity}
              </p>
              <p className="mt-1 flex items-center gap-1 text-[11px] text-success">
                <CheckmarkCircle02Icon aria-hidden size={12} />
                {fixed}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div aria-hidden className="landing-finding-scanline" />
    </div>
  );
}

function CoverageScene() {
  return (
    <div className="relative flex min-h-64 items-center justify-center overflow-hidden p-5 sm:min-h-72">
      <div className="landing-radar relative size-44 rounded-full border border-divider/80 sm:size-48">
        <span aria-hidden className="landing-radar-ring inset-[18%]" />
        <span aria-hidden className="landing-radar-ring inset-[36%]" />
        <span aria-hidden className="landing-radar-cross landing-radar-cross-x" />
        <span aria-hidden className="landing-radar-cross landing-radar-cross-y" />
        <span aria-hidden className="landing-radar-sweep" />
        <span aria-hidden className="landing-radar-dot left-[68%] top-[27%]" />
        <span
          aria-hidden
          className="landing-radar-dot left-[24%] top-[62%]"
          style={{ animationDelay: '1.3s' }}
        />
        <span
          aria-hidden
          className="landing-radar-dot left-[63%] top-[70%]"
          style={{ animationDelay: '2.4s' }}
        />
        <Shield01Icon
          aria-hidden
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-accent"
          size={24}
        />
      </div>
      <div className="absolute bottom-5 left-5 rounded-lg border border-divider/70 bg-surface/90 px-3 py-2 shadow-sm">
        <p className="text-[10px] uppercase tracking-[0.16em] text-muted">Watchlist</p>
        <p className="mt-1 font-mono text-xs text-foreground">payments:release</p>
      </div>
      <Chip className="absolute right-5 top-5" color="success" size="sm" variant="soft">
        scheduled
      </Chip>
    </div>
  );
}

export function LandingFeatureOverviewSection() {
  return (
    <section id="features" className="scroll-mt-24 px-5 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <LandingReveal>
          <SectionIntro
            centered
            description="Every stage stays connected—from the artifact entering your environment to the evidence your team uses to ship."
            eyebrow="A workflow you can see"
            title="Security that moves with the release."
          />
        </LandingReveal>

        <div className="mt-14 grid gap-4 lg:grid-cols-12">
          <LandingReveal className="lg:col-span-7">
            <Card
              className="h-full overflow-hidden border-divider/80 bg-surface/70 p-0"
              variant="default"
            >
              <ScanPipelineScene />
              <Card.Footer className="block border-t border-divider/70 p-6 sm:p-7">
                <div className="flex items-center gap-2 text-accent">
                  <WorkflowSquare06Icon aria-hidden size={18} />
                  <span className="text-xs font-semibold uppercase tracking-[0.16em]">
                    One flow
                  </span>
                </div>
                <h3 className="mt-3 text-xl font-semibold text-foreground">
                  Scan the sources your release actually uses.
                </h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                  Container images, Helm charts, registries, archives, Trivy, and Xray enter the
                  same governed review path.
                </p>
              </Card.Footer>
            </Card>
          </LandingReveal>

          <LandingReveal className="lg:col-span-5" delay={0.04}>
            <Card
              className="h-full overflow-hidden border-divider/80 bg-surface/70 p-0"
              variant="default"
            >
              <RemediationScene />
              <Card.Footer className="block border-t border-divider/70 p-6 sm:p-7">
                <h3 className="text-xl font-semibold text-foreground">Move fixable risk first.</h3>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Severity, package, fixed version, and policy context stay in one decision surface.
                </p>
              </Card.Footer>
            </Card>
          </LandingReveal>

          <LandingReveal className="lg:col-span-5" delay={0.03}>
            <Card
              className="h-full overflow-hidden border-divider/80 bg-surface/70 p-0"
              variant="default"
            >
              <CoverageScene />
              <Card.Footer className="block border-t border-divider/70 p-6 sm:p-7">
                <h3 className="text-xl font-semibold text-foreground">
                  Keep important images watched.
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Scheduled rescans surface newly disclosed CVEs without losing ownership context.
                </p>
              </Card.Footer>
            </Card>
          </LandingReveal>

          <LandingReveal className="lg:col-span-7" delay={0.06}>
            <Card
              className="flex h-full flex-col justify-between border-divider/80 bg-surface/70"
              variant="default"
            >
              <Card.Header>
                <div className="flex size-11 items-center justify-center rounded-xl border border-divider/70 bg-surface-secondary text-accent">
                  <Shield01Icon aria-hidden size={21} />
                </div>
              </Card.Header>
              <Card.Content className="mt-10">
                <p className="max-w-xl text-2xl font-semibold leading-tight tracking-[-0.025em] text-foreground sm:text-3xl">
                  Your registry credentials, identity model, policy decisions, and evidence stay
                  inside the environment you operate.
                </p>
              </Card.Content>
              <Card.Footer className="mt-8 flex-wrap gap-2">
                {['Self-hosted', 'OIDC-ready', 'Encrypted at rest', 'API-first'].map((label) => (
                  <Chip key={label} size="sm" variant="secondary">
                    {label}
                  </Chip>
                ))}
              </Card.Footer>
            </Card>
          </LandingReveal>
        </div>
      </div>
    </section>
  );
}

function CliScene() {
  return (
    <StageFrame className="min-h-[430px]" label="Animated JustScan CLI scan">
      <div className="flex items-center justify-between border-b border-divider/70 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-danger/70" />
          <span className="size-2.5 rounded-full bg-warning/70" />
          <span className="size-2.5 rounded-full bg-success/70" />
        </div>
        <div className="flex items-center gap-2 rounded-md border border-divider/70 bg-surface/70 px-3 py-1 text-[10px] text-muted">
          <CommandLineIcon aria-hidden size={12} />
          justscan · pipeline
        </div>
        <span className="w-12" />
      </div>
      <div className="p-5 font-mono text-xs leading-6 sm:p-8 sm:text-sm">
        <p className="text-muted">
          <span className="text-accent">$</span> justscan scan ghcr.io/acme/api:release
        </p>
        <div className="mt-6 space-y-3">
          {[
            ['01', 'Resolving image manifest', 'complete'],
            ['02', 'Submitting artifact to JustScan', 'complete'],
            ['03', 'Scanning packages and policies', 'active'],
            ['04', 'Writing organization result', 'pending'],
          ].map(([number, label, state], index) => (
            <div
              key={number}
              className="landing-cli-line grid grid-cols-[24px_1fr_auto] items-center gap-3"
              style={{ animationDelay: `${index * 0.65}s` }}
            >
              <span className="text-muted">{number}</span>
              <span className={state === 'pending' ? 'text-muted' : 'text-foreground'}>
                {label}
              </span>
              {state === 'complete' ? (
                <CheckmarkCircle02Icon aria-hidden className="text-success" size={15} />
              ) : state === 'active' ? (
                <span className="landing-cli-spinner" />
              ) : (
                <span className="size-1.5 rounded-full bg-divider" />
              )}
            </div>
          ))}
        </div>
        <div className="mt-7 h-1 overflow-hidden rounded-full bg-divider/70">
          <span
            aria-hidden
            className="landing-cli-progress block h-full w-3/4 rounded-full bg-accent"
          />
        </div>
        <div className="landing-cli-verdict mt-8 rounded-xl border border-success/30 bg-success/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-sans text-sm font-semibold text-foreground">
              <CheckmarkCircle02Icon aria-hidden className="text-success" size={17} />
              Policy passed
            </span>
            <span className="font-sans text-xs text-muted">exit 0</span>
          </div>
          <p className="mt-2 text-xs text-muted">9 fixable findings · result saved to Platform</p>
        </div>
      </div>
    </StageFrame>
  );
}

export function LandingCliSection() {
  return (
    <section id="cli" className="scroll-mt-24 px-5 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-12 lg:gap-16">
        <LandingReveal className="lg:col-span-5">
          <SectionIntro
            description="Bring the same scan engine and organization policies into a laptop, build runner, or release job—without rebuilding the workflow in shell scripts."
            eyebrow="JustScan CLI"
            title="One command between build and deploy."
          />
          <div className="mt-7 space-y-4">
            {[
              ['Local images', 'Stream from Docker or Podman without publishing first.'],
              [
                'Registry + archive scans',
                'Submit remote images, saved OCI archives, or HTTPS URLs.',
              ],
              ['CI-native verdicts', 'Wait for the server policy and use predictable exit codes.'],
            ].map(([title, description]) => (
              <div key={title} className="flex gap-3">
                <CheckmarkCircle02Icon
                  aria-hidden
                  className="mt-0.5 shrink-0 text-accent"
                  size={18}
                />
                <p className="text-sm leading-6 text-muted">
                  <span className="font-medium text-foreground">{title}.</span> {description}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <LandingButtonLink
              href="https://github.com/JustLABv1/justscan/releases/latest"
              label="Download the CLI"
              showArrow
            />
            <LandingButtonLink
              href="https://github.com/JustLABv1/justscan/blob/main/docs/justscan-cli.md"
              label="Read the guide"
              variant="outline"
            />
          </div>
        </LandingReveal>
        <LandingReveal className="lg:col-span-7" delay={0.05}>
          <CliScene />
        </LandingReveal>
      </div>
    </section>
  );
}

function GitOpsScene() {
  return (
    <StageFrame className="min-h-[470px] p-5 sm:p-7 lg:p-9" label="Animated GitOps discovery flow">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl border border-divider/80 bg-surface text-accent">
            <GitBranchIcon aria-hidden size={19} />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">platform/production</p>
            <p className="mt-0.5 font-mono text-[10px] text-muted">main · synced just now</p>
          </div>
        </div>
        <Chip color="success" size="sm" variant="soft">
          connected
        </Chip>
      </div>

      <div className="mt-8 grid gap-5 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div className="space-y-2">
          {[
            ['apps/api/deployment.yaml', 'api:2.4.0'],
            ['apps/web/values.yaml', 'web:2.4.0'],
            ['workers/scan/kustomization.yaml', 'scanner:stable'],
          ].map(([file, image], index) => (
            <div
              key={file}
              className="landing-manifest-row rounded-xl border border-divider/70 bg-surface/80 p-3"
              style={{ animationDelay: `${index * 0.7}s` }}
            >
              <p className="flex items-center gap-2 truncate font-mono text-[10px] text-muted">
                <CodeFolderIcon aria-hidden className="shrink-0" size={13} />
                {file}
              </p>
              <p className="mt-2 truncate font-mono text-xs text-foreground">{image}</p>
            </div>
          ))}
        </div>

        <div aria-hidden className="landing-gitops-bridge relative hidden h-48 w-16 sm:block">
          <span className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-divider/80" />
          <span className="landing-gitops-packet top-[8%]" />
          <span className="landing-gitops-packet top-[44%]" style={{ animationDelay: '1.1s' }} />
          <span className="landing-gitops-packet top-[78%]" style={{ animationDelay: '2.2s' }} />
        </div>

        <div className="relative rounded-2xl border border-divider/80 bg-surface/85 p-4">
          <div className="flex items-center gap-2 border-b border-divider/70 pb-3">
            <FileSearchIcon aria-hidden className="text-accent" size={17} />
            <p className="text-xs font-semibold text-foreground">Discovered workloads</p>
          </div>
          <div className="mt-3 space-y-3">
            {[
              ['api', '3 critical', 'danger'],
              ['web', 'policy passed', 'success'],
              ['scanner', 'scan queued', 'accent'],
            ].map(([name, status, tone]) => (
              <div key={name} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs text-foreground">
                  <PackageIcon aria-hidden className="text-muted" size={14} />
                  {name}
                </span>
                <span
                  className={
                    tone === 'danger'
                      ? 'text-[10px] text-danger'
                      : tone === 'success'
                        ? 'text-[10px] text-success'
                        : 'text-[10px] text-accent'
                  }
                >
                  {status}
                </span>
              </div>
            ))}
          </div>
          <Separator className="my-4" variant="tertiary" />
          <div className="flex items-center justify-between text-[10px] text-muted">
            <span className="flex items-center gap-1.5">
              <GitCompareIcon aria-hidden size={12} /> 3 manifests
            </span>
            <span>3 images</span>
          </div>
        </div>
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-2 text-[10px] text-muted">
        <span className="rounded-md border border-divider/70 bg-surface/65 px-2.5 py-1.5">
          Discover
        </span>
        <ArrowRight01Icon aria-hidden size={13} />
        <span className="rounded-md border border-divider/70 bg-surface/65 px-2.5 py-1.5">
          Scan
        </span>
        <ArrowRight01Icon aria-hidden size={13} />
        <span className="rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-accent">
          Enforce policy
        </span>
      </div>
    </StageFrame>
  );
}

export function LandingGitOpsSection() {
  return (
    <section id="gitops" className="scroll-mt-24 px-5 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <LandingReveal>
          <SectionIntro
            centered
            description="Turn the manifests that describe production into a living inventory of what needs to be scanned, reviewed, and watched."
            eyebrow="GitOps discovery"
            title="Follow the source of truth."
          />
        </LandingReveal>
        <LandingReveal className="mt-14" delay={0.05}>
          <GitOpsScene />
        </LandingReveal>
        <LandingReveal className="mt-4" delay={0.08}>
          <div className="grid overflow-hidden rounded-2xl border border-divider/70 bg-surface/60 md:grid-cols-3">
            {[
              [
                '01',
                'Connect',
                'Point JustScan at the repository and branch your platform team already owns.',
              ],
              [
                '02',
                'Discover',
                'Resolve declared images from supported manifests into reviewable workloads.',
              ],
              [
                '03',
                'Keep current',
                'Scan immediately or schedule recurring repository discovery and analysis.',
              ],
            ].map(([number, title, description], index) => (
              <div
                key={number}
                className={`p-6 sm:p-7 ${
                  index > 0 ? 'border-t border-divider/70 md:border-l md:border-t-0' : ''
                }`}
              >
                <span className="font-mono text-xs text-accent">{number}</span>
                <h3 className="mt-4 text-lg font-semibold text-foreground">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
              </div>
            ))}
          </div>
        </LandingReveal>
      </div>
    </section>
  );
}

function CollectorScene() {
  const nodes = [
    ['Kubernetes', 'left-[12%] top-[18%]', '0s'],
    ['Edge', 'right-[10%] top-[22%]', '0.9s'],
    ['Private cloud', 'bottom-[12%] left-[18%]', '1.8s'],
    ['Air-gapped', 'bottom-[16%] right-[12%]', '2.7s'],
  ] as const;

  return (
    <StageFrame
      className="min-h-[430px] p-5 sm:p-8"
      label="Preview of the planned Collectors network"
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <span aria-hidden className="landing-collector-orbit size-48 sm:size-64" />
        <span aria-hidden className="landing-collector-orbit size-72 sm:size-96" />
        <div className="landing-collector-core relative z-10 flex size-28 flex-col items-center justify-center rounded-3xl border border-accent/35 bg-surface/95 text-center shadow-lg shadow-accent/10">
          <CloudServerIcon aria-hidden className="text-accent" size={27} />
          <span className="mt-2 text-xs font-semibold text-foreground">JustScan</span>
          <span className="text-[9px] uppercase tracking-[0.16em] text-muted">control plane</span>
        </div>
      </div>
      {nodes.map(([label, position, delay]) => (
        <div
          key={label}
          className={`landing-collector-node absolute ${position} rounded-xl border border-divider/75 bg-surface/90 px-3 py-2 shadow-sm`}
          style={{ animationDelay: delay }}
        >
          <span className="flex items-center gap-2 text-[10px] font-medium text-foreground sm:text-xs">
            <span aria-hidden className="size-1.5 rounded-full bg-accent" />
            {label}
          </span>
        </div>
      ))}
      <span aria-hidden className="landing-collector-signal left-[27%] top-[34%]" />
      <span
        aria-hidden
        className="landing-collector-signal right-[25%] top-[38%]"
        style={{ animationDelay: '1.4s' }}
      />
      <span
        aria-hidden
        className="landing-collector-signal bottom-[28%] left-[32%]"
        style={{ animationDelay: '2.7s' }}
      />
    </StageFrame>
  );
}

export function LandingCollectorsSection() {
  return (
    <section id="collectors" className="scroll-mt-24 px-5 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-3xl border border-divider/70 bg-surface/55 p-5 sm:p-8 lg:p-12">
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-14">
          <LandingReveal className="lg:col-span-5">
            <Chip color="accent" size="sm" variant="soft">
              <ComingSoon02Icon aria-hidden size={14} />
              Coming soon
            </Chip>
            <h2 className="mt-5 text-4xl font-semibold leading-[1.04] tracking-[-0.045em] text-foreground sm:text-5xl">
              Collect closer to where workloads run.
            </h2>
            <p className="mt-5 text-base leading-7 text-muted">
              Collectors are the next step in extending JustScan into distributed and restricted
              environments while keeping policy and review centralized.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              {['Distributed environments', 'Central policy', 'Planned capability'].map((label) => (
                <Chip key={label} size="sm" variant="secondary">
                  {label}
                </Chip>
              ))}
            </div>
            <p className="mt-6 text-xs leading-5 text-muted">
              This preview reflects the product direction currently being planned. Availability and
              final scope may change.
            </p>
          </LandingReveal>
          <LandingReveal className="lg:col-span-7" delay={0.05}>
            <CollectorScene />
          </LandingReveal>
        </div>
      </div>
    </section>
  );
}

export function LandingFaqSection() {
  return (
    <section id="faq" className="scroll-mt-24 px-5 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-12 lg:gap-16">
        <LandingReveal className="lg:col-span-4">
          <SectionIntro
            description="The short version of how JustScan fits into your infrastructure and release workflow."
            eyebrow="FAQ"
            title="Questions, answered."
          />
        </LandingReveal>
        <LandingReveal className="lg:col-span-8" delay={0.04}>
          <LandingFaq />
        </LandingReveal>
      </div>
    </section>
  );
}
