'use client';

import { useEffect, useMemo, useRef } from 'react';

import { Button, Card, Chip, Label, ProgressBar, Typography } from '@heroui/react';
import {
  AiContentGenerator01Icon,
  Building04Icon,
  DashboardSquare01Icon,
  EyeIcon,
  GridTableIcon,
  PackageIcon,
  Search01Icon,
  ServerStack01Icon,
  Shield01Icon,
  ShieldKeyIcon,
  Tag01Icon,
} from 'hugeicons-react';
import {
  NextStep,
  NextStepProvider,
  useNextStep,
  type CardComponentProps,
  type Tour,
} from 'nextstepjs';

export const WORKSPACE_TOUR_NAME = 'justscan-workspace-tour';

const DEFAULT_STEP_SELECTOR = '#tour-page-header';
const ASSISTANT_STEP_SELECTOR = '#tour-assistant-root';

function buildWorkspaceTour(includeAssistant: boolean): Tour[] {
  const baseSteps = [
    {
      route: '/dashboard',
      icon: <Shield01Icon size={18} />,
      title: 'Welcome to JustScan',
      content:
        'Welcome aboard. This tour will walk you through the main areas of JustScan so you know where to scan images, investigate risk, and manage your workspace.',
    },
    {
      route: '/dashboard',
      selector: '#tour-workspace-section',
      side: 'bottom-left' as const,
      icon: <Building04Icon size={18} />,
      title: 'Workspaces',
      content:
        'At the top of the sidebar you can switch between your personal workspace and any organizations you belong to. Changing workspace updates the scope of the data you are working with throughout JustScan.',
    },
    {
      route: '/dashboard',
      selector: DEFAULT_STEP_SELECTOR,
      icon: <DashboardSquare01Icon size={18} />,
      title: 'Dashboard',
      content:
        'Start here for a quick view of your workspace. Use the dashboard to spot recent activity and jump into the areas that need attention first.',
    },
    ...(includeAssistant
      ? [
          {
            route: '/assistant',
            selector: ASSISTANT_STEP_SELECTOR,
            icon: <AiContentGenerator01Icon size={18} />,
            title: 'Assistant',
            content:
              'Use Assistant when you want guided help inside JustScan. It can explain findings, suggest next steps, and help you navigate the product with context.',
          },
        ]
      : []),
    {
      route: '/scans',
      selector: DEFAULT_STEP_SELECTOR,
      icon: <Shield01Icon size={18} />,
      title: 'Scans',
      content:
        'Scans is where you launch image scans and review their results. Most day-to-day triage starts here when you need to inspect an image or rerun a check.',
    },
    {
      route: '/helm',
      selector: DEFAULT_STEP_SELECTOR,
      icon: <PackageIcon size={18} />,
      title: 'Helm Scan',
      content:
        'Use Helm Scan to inspect Helm charts and release artifacts. This page is the place to submit a chart and review package-level risk before deployment.',
    },
    {
      route: '/watchlist',
      selector: DEFAULT_STEP_SELECTOR,
      icon: <Search01Icon size={18} />,
      title: 'Watchlist',
      content:
        'Watchlist keeps an eye on images you care about over time. Register recurring targets here so you can track change without starting every scan manually.',
    },
    {
      route: '/vulnkb',
      selector: DEFAULT_STEP_SELECTOR,
      icon: <ShieldKeyIcon size={18} />,
      title: 'Vuln KB',
      content:
        'Vuln KB is your research space for known vulnerabilities. Open it when you need background, affected packages, and remediation context for a CVE.',
    },
    {
      route: '/suppressions',
      selector: DEFAULT_STEP_SELECTOR,
      icon: <GridTableIcon size={18} />,
      title: 'Suppressions',
      content:
        'Suppressions is where you manage accepted risk and reduce noise. Use this page to document why a finding is being ignored and keep triage focused.',
    },
    {
      route: '/status',
      selector: DEFAULT_STEP_SELECTOR,
      icon: <EyeIcon size={18} />,
      title: 'Status Pages',
      content:
        'Status Pages lets you publish a shareable security view for other teams. It is useful when you need visibility without giving full app access.',
    },
    {
      route: '/registries',
      selector: DEFAULT_STEP_SELECTOR,
      icon: <ServerStack01Icon size={18} />,
      title: 'Registries',
      content:
        'Registries is where you connect image sources and scanning integrations. Most setup work for repositories, credentials, and registry health starts here.',
    },
    {
      route: '/tags',
      selector: DEFAULT_STEP_SELECTOR,
      icon: <Tag01Icon size={18} />,
      title: 'Tags',
      content:
        'Tags help you organize scans and assets by team, environment, or ownership. Use them to group work and make filtering easier across the product.',
    },
    {
      route: '/orgs',
      selector: DEFAULT_STEP_SELECTOR,
      icon: <Building04Icon size={18} />,
      title: 'Organizations',
      content:
        'Organizations is where you manage shared workspaces, members, and invites. Come here when you need to collaborate across teams or switch workspace context.',
    },
  ];

  return [
    {
      tour: WORKSPACE_TOUR_NAME,
      steps: baseSteps.map(({ route, side, ...step }, index) => {
        const nextRoute = baseSteps[index + 1]?.route;
        const prevRoute = baseSteps[index - 1]?.route;

        return {
          ...step,
          side: side ?? ('bottom' as const),
          showControls: true,
          showSkip: true,
          nextRoute: nextRoute && nextRoute !== route ? nextRoute : undefined,
          prevRoute: prevRoute && prevRoute !== route ? prevRoute : undefined,
        };
      }),
    },
  ];
}

function HeroTourCard({
  step,
  currentStep,
  totalSteps,
  nextStep,
  prevStep,
  skipTour,
  arrow,
}: CardComponentProps) {
  const progressValue = totalSteps > 0 ? ((currentStep + 1) / totalSteps) * 100 : 0;
  const isLastStep = currentStep === totalSteps - 1;
  const showControls = step.showControls !== false;
  const showSkip = step.showSkip !== false && currentStep < totalSteps - 1;

  return (
    <div className="flex w-[min(22rem,calc(100vw-1.5rem))] flex-col items-stretch gap-3">
      <Card
        className="max-h-[calc(100vh-1.5rem)] overflow-y-auto rounded-3xl border border-border/70 shadow-2xl shadow-black/10"
        variant="default"
      >
        <Card.Header className="flex flex-col items-start gap-4">
          <div className="flex w-full items-center gap-3">
            {step.icon ? (
              <div
                className="flex size-10 shrink-0 items-center justify-center rounded-2xl"
                style={{
                  background:
                    'linear-gradient(135deg, color-mix(in oklab, var(--accent) 18%, transparent) 0%, color-mix(in oklab, var(--accent) 10%, transparent) 100%)',
                  color: 'var(--accent-soft-foreground)',
                  border: '1px solid color-mix(in oklab, var(--accent) 20%, transparent)',
                }}
              >
                {step.icon}
              </div>
            ) : null}
            <div className="min-w-0 flex-1 space-y-1">
              <Chip color="accent" size="sm" variant="soft">
                Step {currentStep + 1} of {totalSteps}
              </Chip>
              <Card.Title>{step.title}</Card.Title>
            </div>
          </div>
        </Card.Header>

        <Card.Content className="space-y-5">
          <Typography.Paragraph color="muted" size="sm">
            {step.content}
          </Typography.Paragraph>

          <ProgressBar
            aria-label={`Tour progress: step ${currentStep + 1} of ${totalSteps}`}
            color="accent"
            size="sm"
            value={progressValue}
          >
            <div className="flex items-center justify-between gap-3">
              <Label className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                Tour progress
              </Label>
              <ProgressBar.Output className="text-xs text-muted" />
            </div>
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
        </Card.Content>

        {showControls || showSkip ? (
          <Card.Footer className="flex flex-col items-stretch gap-3">
            {showControls ? (
              <div className="flex items-center justify-between gap-3">
                <Button isDisabled={currentStep === 0} onPress={prevStep} variant="secondary">
                  Back
                </Button>
                <Button onPress={nextStep} variant="primary">
                  {isLastStep ? 'Finish' : 'Next'}
                </Button>
              </div>
            ) : null}

            {showSkip && skipTour ? (
              <Button className="w-full" onPress={skipTour} variant="tertiary">
                Skip tour
              </Button>
            ) : null}
          </Card.Footer>
        ) : null}
      </Card>
      {arrow}
    </div>
  );
}

function WorkspaceTourLauncher({ signal }: { signal: number }) {
  const { startNextStep } = useNextStep();
  const handledSignalRef = useRef(0);

  useEffect(() => {
    if (signal <= 0) {
      return;
    }
    if (handledSignalRef.current === signal) {
      return;
    }

    handledSignalRef.current = signal;
    const timeoutId = window.setTimeout(() => {
      startNextStep(WORKSPACE_TOUR_NAME);
    }, 120);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [signal, startNextStep]);

  return null;
}

interface WorkspaceTourProviderProps {
  children: React.ReactNode;
  includeAssistant: boolean;
  startSignal: number;
  onFinish: () => void;
}

export function WorkspaceTourProvider({
  children,
  includeAssistant,
  startSignal,
  onFinish,
}: WorkspaceTourProviderProps) {
  const steps = useMemo(() => buildWorkspaceTour(includeAssistant), [includeAssistant]);

  return (
    <NextStepProvider>
      <NextStep
        cardComponent={HeroTourCard}
        steps={steps}
        onComplete={(tourName) => {
          if (tourName === WORKSPACE_TOUR_NAME) {
            onFinish();
          }
        }}
        onSkip={(_, tourName) => {
          if (tourName === WORKSPACE_TOUR_NAME) {
            onFinish();
          }
        }}
      >
        <WorkspaceTourLauncher signal={startSignal} />
        {children}
      </NextStep>
    </NextStepProvider>
  );
}
