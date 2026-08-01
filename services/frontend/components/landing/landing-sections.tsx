'use client';

import { Logo } from '@/components/logo';
import { LandingButtonLink, LandingThemeToggle } from '@/components/landing/landing-controls';
import { LandingGlitchHero } from '@/components/landing/landing-glitch-hero';
import { LandingHeroIntro, LandingReveal } from '@/components/landing/landing-motion';
import { Chip, Link, Separator } from '@heroui/react';
import { ArrowUpRight01Icon } from 'hugeicons-react';
import NextLink from 'next/link';
import { getToken } from '@/lib/api';
import { useEffect, useState } from 'react';

export function LandingHeader({ initialIsLoggedIn = false }: { initialIsLoggedIn?: boolean }) {
  const [isLoggedIn, setIsLoggedIn] = useState(initialIsLoggedIn);

  useEffect(() => {
    if (getToken()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoggedIn(true);
    }

    const syncAuthState = () => setIsLoggedIn(Boolean(getToken()));
    window.addEventListener('storage', syncAuthState);
    return () => window.removeEventListener('storage', syncAuthState);
  }, []);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-4 z-50 px-4 sm:px-6">
      <div className="pointer-events-auto mx-auto flex h-12 max-w-5xl items-center justify-between gap-3 rounded-2xl border border-foreground/10 bg-background/78 px-3 shadow-lg shadow-foreground/5 backdrop-blur-xl sm:rounded-full sm:px-4">
        <NextLink aria-label="JustScan home" className="flex shrink-0 items-center gap-2" href="/">
          <Logo size={24} />
          <span className="text-sm font-semibold text-foreground">JustScan</span>
        </NextLink>

        <nav aria-label="Primary navigation" className="hidden items-center gap-5 md:flex">
          <Link className="text-sm text-muted" href="#features">
            Features
          </Link>
          <Link className="text-sm text-muted" href="#intelligence">
            Intelligence
          </Link>
          <Link className="text-sm text-muted" href="#cli">
            CLI
          </Link>
          <Link className="text-sm text-muted" href="#gitops">
            GitOps
          </Link>
          <Link className="text-sm text-muted" href="#faq">
            FAQ
          </Link>
          <Link className="text-sm text-muted" href="/docs">
            Docs
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <LandingThemeToggle />
          <Separator className="hidden h-6 lg:block" orientation="vertical" variant="tertiary" />
          <LandingButtonLink
            className="inline-flex shrink-0"
            href={isLoggedIn ? '/scans' : '/login'}
            label={isLoggedIn ? 'Dashboard' : 'Sign in'}
            size="sm"
            variant="outline"
          />
          <LandingButtonLink href="/public/scan/image" label="Scan free" size="sm" />
        </div>
      </div>
    </header>
  );
}

export function LandingHeroSection() {
  return (
    <section className="relative isolate flex min-h-svh items-center justify-center overflow-hidden px-5 py-24 sm:px-6 sm:py-28">
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
    <section
      aria-label="Platform capabilities"
      className="relative px-5 pb-12 pt-2 sm:px-6 sm:pb-16"
    >
      <LandingReveal className="mx-auto max-w-5xl text-center">
        <p className="text-sm font-medium text-foreground">A scanner that fits the way you ship.</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-sm text-muted">
          {[
            ['Trivy + Xray', 'Flexible scan engines'],
            ['Self-hosted by design', 'Your environment and data'],
            ['OIDC-ready', 'Existing identity providers'],
            ['Built for CI/CD', 'Release workflow automation'],
          ].map(([title, description], index) => (
            <div key={title} className="flex items-center gap-2">
              {index > 0 ? <span aria-hidden className="size-1 rounded-full bg-accent" /> : null}
              <span className="font-medium text-foreground">{title}</span>
              <span className="hidden text-muted sm:inline">{description}</span>
            </div>
          ))}
        </div>
      </LandingReveal>
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
          <Link className="text-sm text-muted" href="#features">
            Features
          </Link>
          <Link className="text-sm text-muted" href="#intelligence">
            Intelligence
          </Link>
          <Link className="text-sm text-muted" href="#cli">
            CLI
          </Link>
          <Link className="text-sm text-muted" href="#gitops">
            GitOps
          </Link>
          <Link className="text-sm text-muted" href="#faq">
            FAQ
          </Link>
          <Link className="text-sm text-muted" href="/docs">
            Docs
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
