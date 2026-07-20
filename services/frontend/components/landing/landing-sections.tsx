import { Logo } from '@/components/logo';
import { LandingButtonLink, LandingThemeToggle } from '@/components/landing/landing-controls';
import { LandingGlitchHero } from '@/components/landing/landing-glitch-hero';
import { LandingHeroIntro, LandingReveal } from '@/components/landing/landing-motion';
import { FindingPreview, WatchlistPreview } from '@/components/landing/product-visuals';
import { Chip, Link, Separator, Surface } from '@heroui/react';
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

const CAPABILITIES: Array<{ title: string; description: string; Icon: IconComponent }> = [
  {
    title: 'Identity that fits',
    description: 'Connect OIDC identity providers and map access into JustScan.',
    Icon: Building04Icon,
  },
  {
    title: 'Protected registry access',
    description: 'Keep credentials for private registry workflows encrypted at rest.',
    Icon: Shield01Icon,
  },
  {
    title: 'Deployment control',
    description: 'Run with Docker Compose or Helm on infrastructure you control.',
    Icon: ServerStack01Icon,
  },
  {
    title: 'Automation ready',
    description: 'Use the API and CI/CD workflows to scan before release.',
    Icon: GridTableIcon,
  },
];

const WORKFLOW_STEPS = [
  {
    number: '01',
    title: 'Connect the source',
    description: 'Use an image, chart, private registry, Xray route, or archive.',
    Icon: PackageIcon,
  },
  {
    number: '02',
    title: 'Scan and prioritize',
    description: 'Review severity, package, fix, and policy context together.',
    Icon: Search01Icon,
  },
  {
    number: '03',
    title: 'Monitor and share',
    description: 'Carry results into watchlists, reports, SBOMs, and team workflows.',
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
    <div className={centered ? 'mx-auto max-w-3xl text-center' : 'max-w-2xl'}>
      <Chip color="accent" size="sm" variant="soft">
        {eyebrow}
      </Chip>
      <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.035em] text-foreground sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      <p className={`mt-5 text-base leading-7 text-muted ${centered ? 'mx-auto max-w-2xl' : ''}`}>
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
    <header className="sticky top-0 z-50 border-b border-divider/50 bg-background/72 backdrop-blur-xl">
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
          <Link className="text-sm text-muted" href="#product">
            Product
          </Link>
          <Link className="text-sm text-muted" href="#capabilities">
            Capabilities
          </Link>
          <Link className="text-sm text-muted" href="#workflow">
            Workflow
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
    <section className="relative isolate flex min-h-[calc(100svh-4rem)] items-center justify-center overflow-hidden px-5 py-24 sm:px-6 sm:py-28">
      <LandingGlitchHero />
      <div aria-hidden className="landing-hero-scrim pointer-events-none absolute inset-0 z-10" />
      <div
        aria-hidden
        className="landing-hero-fade pointer-events-none absolute inset-x-0 bottom-0 z-10 h-40"
      />

      <LandingHeroIntro className="relative z-20 mx-auto flex w-full max-w-3xl flex-col items-center space-y-7 text-center">
        <Chip color="accent" variant="soft">
          Self-hosted container security
        </Chip>
        <div>
          <h1 className="text-5xl font-semibold leading-[1.01] tracking-[-0.055em] text-foreground sm:text-6xl lg:text-7xl">
            Find what matters. Fix it before it ships.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-muted sm:text-lg sm:leading-8">
            Scan images and Helm charts, prioritize what is fixable, and keep evidence and team
            context in one security workflow you control.
          </p>
        </div>
        <div className="flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
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
            label="Get started"
            size="lg"
            variant="secondary"
          />
        </div>
        <p className="flex items-center gap-2 text-sm text-muted">
          <span aria-hidden className="size-1.5 rounded-full bg-success" />
          No account required for your first public image scan.
        </p>
      </LandingHeroIntro>
    </section>
  );
}

export function LandingProofStrip() {
  return (
    <section aria-label="Platform capabilities" className="relative px-5 pb-8 sm:px-6 sm:pb-12">
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

export function LandingProductStorySection() {
  return (
    <section id="product" className="scroll-mt-24 px-5 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-7xl space-y-24 lg:space-y-32">
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <LandingReveal className="lg:col-span-5">
            <Chip color="accent" size="sm" variant="soft">
              Make decisions faster
            </Chip>
            <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.035em] text-foreground sm:text-4xl">
              A scan result built for action.
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
                Keep organization and Xray policy signals in the decision flow.
              </DetailPoint>
            </ul>
          </LandingReveal>
          <LandingReveal className="lg:col-span-7" delay={0.06}>
            <FindingPreview />
          </LandingReveal>
        </div>

        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <LandingReveal className="order-2 lg:order-1 lg:col-span-7" delay={0.06}>
            <WatchlistPreview />
          </LandingReveal>
          <LandingReveal className="order-1 lg:order-2 lg:col-span-5">
            <Chip color="accent" size="sm" variant="soft">
              Stay ahead
            </Chip>
            <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.035em] text-foreground sm:text-4xl">
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
      </div>
    </section>
  );
}

export function LandingCapabilitiesSection() {
  return (
    <section id="capabilities" className="scroll-mt-24 px-5 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <LandingReveal>
          <SectionHeading
            centered
            description="Bring a polished security workflow into the environment, identity model, and delivery process your organization already operates."
            eyebrow="Built for your environment"
            title="Control the workflow without adding friction."
          />
        </LandingReveal>

        <LandingReveal className="mt-12" delay={0.06}>
          <Surface
            className="overflow-hidden rounded-2xl border border-divider/70"
            variant="secondary"
          >
            <div className="grid sm:grid-cols-2 lg:grid-cols-4">
              {CAPABILITIES.map(({ title, description, Icon }, index) => (
                <div
                  key={title}
                  className={`px-6 py-7 ${index > 0 ? 'lg:border-l lg:border-divider/60' : ''}`}
                >
                  <div className="flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
                    <Icon aria-hidden size={20} />
                  </div>
                  <h3 className="mt-5 text-base font-semibold text-foreground">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
                </div>
              ))}
            </div>
            <Separator variant="tertiary" />
            <div
              id="workflow"
              className="scroll-mt-24 grid gap-6 px-6 py-7 md:grid-cols-3 md:gap-0"
            >
              {WORKFLOW_STEPS.map(({ number, title, description, Icon }, index) => (
                <div
                  key={title}
                  className={`relative ${index > 0 ? 'md:border-l md:border-divider/60 md:pl-7' : 'md:pr-7'}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold tracking-[0.18em] text-accent">
                      {number}
                    </span>
                    <Icon aria-hidden className="text-muted" size={18} />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
                </div>
              ))}
            </div>
          </Surface>
        </LandingReveal>
      </div>
    </section>
  );
}

export function LandingFinalCta() {
  return (
    <section className="relative overflow-hidden px-5 py-20 sm:px-6 lg:py-28">
      <div aria-hidden className="landing-final-glow pointer-events-none absolute inset-0" />
      <LandingReveal className="relative mx-auto max-w-3xl text-center">
        <Chip color="accent" variant="soft">
          Start without setup
        </Chip>
        <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-[-0.035em] text-foreground sm:text-4xl lg:text-5xl">
          Start with one image. Build the workflow when you’re ready.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-muted">
          Run a public scan without an account, then keep the result when it becomes part of your
          team’s release process.
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
            label="Get started"
            size="lg"
            variant="secondary"
          />
        </div>
      </LandingReveal>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="relative border-t border-divider/60 px-5 py-10 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <Logo size={26} />
          <div>
            <p className="text-sm font-semibold text-foreground">JustScan</p>
            <p className="mt-1 text-xs text-muted">Container security, kept actionable.</p>
          </div>
        </div>

        <nav aria-label="Footer navigation" className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link className="text-sm text-muted" href="#product">
            Product
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
