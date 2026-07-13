import { Logo } from '@/components/logo';
import { LandingButtonLink, LandingThemeToggle } from '@/components/landing/landing-controls';
import { LandingHeroIntro, LandingReveal } from '@/components/landing/landing-motion';
import {
  FindingPreview,
  HeroProductDemo,
  WatchlistPreview,
} from '@/components/landing/product-visuals';
import { Card, Chip, Link } from '@heroui/react';
import {
  ArrowUpRight01Icon,
  Building04Icon,
  FileExportIcon,
  GridTableIcon,
  Notification01Icon,
  PackageIcon,
  Search01Icon,
  ServerStack01Icon,
  Shield01Icon,
} from 'hugeicons-react';
import NextLink from 'next/link';
import type { ComponentType } from 'react';

type IconComponent = ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>;

const PLATFORM_PILLARS: Array<{
  title: string;
  description: string;
  eyebrow: string;
  Icon: IconComponent;
  points: string[];
}> = [
  {
    eyebrow: 'Detect',
    title: 'See risk across every image path.',
    description:
      'Scan container images and Helm charts from public or private registries with Trivy and Artifactory Xray workflows.',
    Icon: Search01Icon,
    points: ['Images and Helm charts', 'Public and private registries', 'Trivy and Xray routing'],
  },
  {
    eyebrow: 'Prioritize',
    title: 'Move from CVE volume to clear action.',
    description:
      'Keep severity, CVSS, fix availability, suppressions, organization policy, and Xray context in one review flow.',
    Icon: Shield01Icon,
    points: ['Fix-aware findings', 'Policy and ownership context', 'Focused triage views'],
  },
  {
    eyebrow: 'Prove',
    title: 'Keep the evidence with the decision.',
    description:
      'Export SBOMs and reports, retain audit history, and share the result with the teams responsible for the release.',
    Icon: FileExportIcon,
    points: ['CycloneDX and SPDX', 'Reports and audit history', 'Organization workflows'],
  },
];

const ENTERPRISE_CAPABILITIES: Array<{
  title: string;
  description: string;
  Icon: IconComponent;
}> = [
  {
    title: 'Identity that fits',
    description: 'Connect existing OIDC identity providers and map access into JustScan.',
    Icon: Building04Icon,
  },
  {
    title: 'Protected registry access',
    description: 'Keep credentials for private registry workflows encrypted at rest.',
    Icon: Shield01Icon,
  },
  {
    title: 'Deployment control',
    description: 'Operate JustScan with Docker Compose or Helm on infrastructure you control.',
    Icon: ServerStack01Icon,
  },
  {
    title: 'Automation ready',
    description: 'Use API endpoints and CI/CD workflows to scan before release.',
    Icon: GridTableIcon,
  },
];

const WORKFLOW_STEPS = [
  {
    number: '01',
    title: 'Connect the source',
    description: 'Start with a public image, Helm chart, private registry, Xray route, or archive.',
    Icon: PackageIcon,
  },
  {
    number: '02',
    title: 'Scan and prioritize',
    description:
      'Review vulnerabilities with severity, package, fix, and policy context already aligned.',
    Icon: Search01Icon,
  },
  {
    number: '03',
    title: 'Monitor and share',
    description:
      'Keep important images on watchlists and carry results into reports, SBOMs, and team workflows.',
    Icon: Notification01Icon,
  },
] as const;

function SectionHeading({
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
    <div className={centered ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}>
      <Chip color="accent" size="sm" variant="soft">
        {eyebrow}
      </Chip>
      <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.025em] text-foreground sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      <p
        className={`mt-5 text-base leading-7 text-muted ${centered ? 'mx-auto max-w-2xl' : 'max-w-2xl'}`}
      >
        {description}
      </p>
    </div>
  );
}

function DetailPoint({ children }: { children: string }) {
  return (
    <li className="flex items-start gap-3 text-sm leading-6 text-muted">
      <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
      <span>{children}</span>
    </li>
  );
}

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-divider/60 bg-background/82 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-6">
        <NextLink
          aria-label="JustScan home"
          className="flex shrink-0 items-center gap-2.5"
          href="/"
        >
          <Logo size={30} />
          <span className="text-sm font-semibold text-foreground">JustScan</span>
        </NextLink>

        <nav aria-label="Primary navigation" className="hidden items-center gap-7 lg:flex">
          <Link className="text-sm text-muted" href="#platform">
            Platform
          </Link>
          <Link className="text-sm text-muted" href="#workflow">
            Workflow
          </Link>
          <Link className="text-sm text-muted" href="#enterprise">
            Enterprise
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <LandingThemeToggle />
          <Link className="hidden text-sm text-muted sm:flex" href="/login">
            Sign in
          </Link>
          <LandingButtonLink href="/public/scan/image" label="Scan free" size="sm" />
        </div>
      </div>
    </header>
  );
}

export function LandingHeroSection() {
  return (
    <section className="px-5 pb-16 pt-16 sm:px-6 sm:pb-20 sm:pt-24 lg:pb-28 lg:pt-28">
      <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-12 lg:gap-12">
        <LandingHeroIntro className="max-w-[720px] space-y-7 lg:col-span-7">
          <Chip color="accent" variant="soft">
            Container security, without the workflow sprawl
          </Chip>

          <div>
            <h1 className="text-5xl font-semibold leading-[1.02] tracking-[-0.045em] text-foreground sm:text-6xl lg:text-7xl">
              Find what matters. Fix it before it ships.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted sm:text-lg sm:leading-8">
              JustScan brings image and Helm scanning, prioritized findings, fix paths, SBOM
              evidence, and governed team workflows into one platform—on infrastructure you control.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <LandingButtonLink
              className="w-full sm:w-auto"
              href="/public/scan/image"
              label="Scan an image free"
              showArrow
              size="lg"
            />
            <LandingButtonLink
              className="w-full sm:w-auto"
              href="#platform"
              label="Explore the platform"
              size="lg"
              variant="secondary"
            />
          </div>

          <p className="flex items-center gap-2 text-sm text-muted">
            <span aria-hidden className="size-1.5 rounded-full bg-success" />
            No account required for your first public image scan.
          </p>
        </LandingHeroIntro>

        <LandingReveal className="lg:col-span-5 lg:pl-4" delay={0.12}>
          <HeroProductDemo />
        </LandingReveal>
      </div>
    </section>
  );
}

export function LandingProofStrip() {
  return (
    <section aria-label="Platform capabilities" className="px-5 pb-10 sm:px-6 sm:pb-14">
      <div className="mx-auto max-w-7xl border-y border-divider/60 py-6">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
          {[
            ['Trivy + Xray', 'Flexible scan engines'],
            ['Self-hosted control', 'Your environment and data'],
            ['OIDC SSO', 'Existing identity providers'],
            ['API + CI/CD', 'Release workflow automation'],
          ].map(([title, description], index) => (
            <div
              key={title}
              className={`px-1 lg:px-6 ${index > 0 ? 'lg:border-l lg:border-divider/60' : ''}`}
            >
              <p className="text-sm font-medium text-foreground">{title}</p>
              <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LandingPlatformSection() {
  return (
    <section id="platform" className="scroll-mt-24 px-5 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <LandingReveal>
          <SectionHeading
            description="JustScan keeps the scan, the remediation decision, and the evidence in one calm workflow instead of spreading security context across separate tools."
            eyebrow="Platform"
            title="From first scan to governed remediation."
          />
        </LandingReveal>

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {PLATFORM_PILLARS.map(({ title, description, eyebrow, Icon, points }, index) => (
            <LandingReveal key={title} delay={index * 0.05}>
              <Card
                className="landing-feature-card h-full border-divider/70 bg-surface/40"
                variant="default"
              >
                <Card.Header>
                  <div className="mb-5 flex items-center justify-between gap-4">
                    <div className="flex size-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
                      <Icon aria-hidden size={22} />
                    </div>
                    <span className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
                      {eyebrow}
                    </span>
                  </div>
                  <Card.Title className="text-xl">{title}</Card.Title>
                  <Card.Description className="mt-3 leading-6">{description}</Card.Description>
                </Card.Header>
                <Card.Content className="pt-5">
                  <ul className="space-y-2">
                    {points.map((point) => (
                      <DetailPoint key={point}>{point}</DetailPoint>
                    ))}
                  </ul>
                </Card.Content>
              </Card>
            </LandingReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LandingDecisionSection() {
  return (
    <section className="border-y border-divider/60 bg-surface/20 px-5 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-12 lg:gap-16">
        <LandingReveal className="lg:col-span-5">
          <Chip color="accent" size="sm" variant="soft">
            Decide faster
          </Chip>
          <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.025em] text-foreground sm:text-4xl">
            A scan result built for decisions.
          </h2>
          <p className="mt-5 text-base leading-7 text-muted">
            Findings arrive with the context teams need to choose the next action—not another
            dashboard to decode.
          </p>
          <ul className="mt-7 space-y-3">
            <DetailPoint>
              Start with critical and high exposure without losing the full result.
            </DetailPoint>
            <DetailPoint>
              See fixed versions beside the affected package and vulnerability.
            </DetailPoint>
            <DetailPoint>
              Keep organization and Xray policy signals visible without coloring every row.
            </DetailPoint>
          </ul>
        </LandingReveal>

        <LandingReveal className="lg:col-span-7" delay={0.08}>
          <FindingPreview />
        </LandingReveal>
      </div>
    </section>
  );
}

export function LandingMonitoringSection() {
  return (
    <section className="px-5 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-12 lg:gap-16">
        <LandingReveal className="order-2 lg:order-1 lg:col-span-7" delay={0.08}>
          <WatchlistPreview />
        </LandingReveal>

        <LandingReveal className="order-1 lg:order-2 lg:col-span-5">
          <Chip color="accent" size="sm" variant="soft">
            Stay ahead
          </Chip>
          <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.025em] text-foreground sm:text-4xl">
            Keep risk visible after the first scan.
          </h2>
          <p className="mt-5 text-base leading-7 text-muted">
            Watchlists and triage views keep recurring work focused while ownership and evidence
            remain attached.
          </p>
          <ul className="mt-7 space-y-3">
            <DetailPoint>Schedule important images and surface newly disclosed CVEs.</DetailPoint>
            <DetailPoint>
              Group scans, suppressions, and reports around the responsible organization.
            </DetailPoint>
            <DetailPoint>
              Move from detection to shared follow-up without duplicating context.
            </DetailPoint>
          </ul>
        </LandingReveal>
      </div>
    </section>
  );
}

export function LandingEnterpriseSection() {
  return (
    <section
      id="enterprise"
      className="scroll-mt-24 border-y border-divider/60 bg-surface/20 px-5 py-20 sm:px-6 lg:py-28"
    >
      <div className="mx-auto max-w-7xl">
        <LandingReveal>
          <SectionHeading
            centered
            description="Bring a polished security workflow into the environment, identity model, and delivery process your organization already operates."
            eyebrow="Enterprise"
            title="Enterprise workflows. Your infrastructure."
          />
        </LandingReveal>

        <LandingReveal className="mt-12" delay={0.06}>
          <Card className="border-divider/70 bg-background/65" variant="secondary">
            <Card.Content className="grid gap-8 p-1 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
              {ENTERPRISE_CAPABILITIES.map(({ title, description, Icon }, index) => (
                <div
                  key={title}
                  className={`px-4 py-2 lg:px-6 ${index > 0 ? 'lg:border-l lg:border-divider/60' : ''}`}
                >
                  <div className="flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
                    <Icon aria-hidden size={20} />
                  </div>
                  <h3 className="mt-5 text-base font-semibold text-foreground">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
                </div>
              ))}
            </Card.Content>
          </Card>
        </LandingReveal>
      </div>
    </section>
  );
}

export function LandingWorkflowSection() {
  return (
    <section id="workflow" className="scroll-mt-24 px-5 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <LandingReveal>
          <SectionHeading
            description="Start with the source you already have. JustScan keeps the path from input to evidence direct and understandable."
            eyebrow="Workflow"
            title="A clear path from source to follow-up."
          />
        </LandingReveal>

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {WORKFLOW_STEPS.map(({ number, title, description, Icon }, index) => (
            <LandingReveal key={title} delay={index * 0.05}>
              <Card className="h-full border-divider/70 bg-surface/35" variant="default">
                <Card.Header>
                  <div className="mb-7 flex items-center justify-between gap-4">
                    <span className="text-xs font-semibold tracking-[0.18em] text-accent">
                      {number}
                    </span>
                    <Icon aria-hidden className="text-muted" size={21} />
                  </div>
                  <Card.Title className="text-lg">{title}</Card.Title>
                  <Card.Description className="mt-3 leading-6">{description}</Card.Description>
                </Card.Header>
              </Card>
            </LandingReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LandingFinalCta() {
  return (
    <section className="px-5 pb-20 sm:px-6 lg:pb-28">
      <LandingReveal className="mx-auto max-w-7xl">
        <div className="relative overflow-hidden rounded-3xl border border-accent/20 bg-accent/8 px-6 py-12 text-center sm:px-12 sm:py-16">
          <div aria-hidden className="landing-cta-glow pointer-events-none absolute inset-0" />
          <div className="relative">
            <Chip color="accent" variant="soft">
              Start without setup
            </Chip>
            <h2 className="mx-auto mt-5 max-w-3xl text-3xl font-semibold leading-tight tracking-[-0.025em] text-foreground sm:text-4xl lg:text-5xl">
              Start with one image. Build a security workflow when you’re ready.
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-muted">
              Run a public scan without an account, then keep the result when it becomes part of
              your team’s release process.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <LandingButtonLink
                className="w-full sm:w-auto"
                href="/public/scan/image"
                label="Scan an image free"
                showArrow
                size="lg"
              />
              <LandingButtonLink
                className="w-full sm:w-auto"
                href="/login"
                label="Sign in"
                size="lg"
                variant="secondary"
              />
            </div>
          </div>
        </div>
      </LandingReveal>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="relative z-10 border-t border-divider/60 px-5 py-10 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <Logo size={26} />
          <div>
            <p className="text-sm font-semibold text-foreground">JustScan</p>
            <p className="mt-1 text-xs text-muted">Container security, kept actionable.</p>
          </div>
        </div>

        <nav aria-label="Footer navigation" className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link className="text-sm text-muted" href="#platform">
            Platform
          </Link>
          <Link className="text-sm text-muted" href="/public/scan/image">
            Image scan
          </Link>
          <Link className="text-sm text-muted" href="/public/scan/helm">
            Helm scan
          </Link>
          <Link className="text-sm text-muted" href="/login">
            Sign in
          </Link>
          <Link
            className="text-sm text-muted"
            href="https://github.com/JustLABv1/justscan"
            rel="noreferrer"
            target="_blank"
          >
            GitHub
            <ArrowUpRight01Icon aria-hidden size={14} />
          </Link>
        </nav>
      </div>
    </footer>
  );
}
