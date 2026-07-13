import {
  LandingDecisionSection,
  LandingEnterpriseSection,
  LandingFinalCta,
  LandingFooter,
  LandingHeader,
  LandingHeroSection,
  LandingMonitoringSection,
  LandingPlatformSection,
  LandingProofStrip,
  LandingWorkflowSection,
} from '@/components/landing/landing-sections';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'JustScan | Container Security Platform',
  description:
    'Scan container images and Helm charts, prioritize fixable vulnerabilities, export SBOM evidence, and govern security workflows on infrastructure you control.',
  openGraph: {
    title: 'JustScan | Container Security Platform',
    description:
      'Container scanning, prioritized remediation, SBOM evidence, and governed team workflows on infrastructure you control.',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'JustScan | Container Security Platform',
    description:
      'Container scanning, prioritized remediation, and enterprise workflows on infrastructure you control.',
  },
};

export default function Page() {
  return (
    <div className="landing-page relative min-h-screen overflow-hidden bg-background text-foreground">
      <a
        className="sr-only z-[60] rounded-md bg-background px-3 py-2 text-sm font-medium text-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        href="#main-content"
      >
        Skip to content
      </a>
      <div
        aria-hidden
        className="landing-page-glow pointer-events-none absolute inset-x-0 top-0 h-[760px]"
      />

      <LandingHeader />
      <main id="main-content" className="relative z-10">
        <LandingHeroSection />
        <LandingProofStrip />
        <LandingPlatformSection />
        <LandingDecisionSection />
        <LandingMonitoringSection />
        <LandingEnterpriseSection />
        <LandingWorkflowSection />
        <LandingFinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
