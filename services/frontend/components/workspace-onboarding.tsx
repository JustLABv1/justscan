'use client';

import type { Org, WorkScope } from '@/lib/api';
import { Logo } from '@/components/logo';
import {
  ArrowRight01Icon,
  Building04Icon,
  DashboardSquare01Icon,
  Shield01Icon,
  Tag01Icon,
} from 'hugeicons-react';
import { useEffect, useState } from 'react';

type WorkspaceOnboardingUser = {
  username?: string;
  email?: string;
} | null;

interface WorkspaceOnboardingProps {
  user: WorkspaceOnboardingUser;
  orgs: Org[];
  orgsReady: boolean;
  initialScope: WorkScope;
  onComplete: (scope: WorkScope) => void;
  onSkip: () => void;
}

const steps = [
  {
    eyebrow: 'Welcome',
    title: 'Welcome to JustScan.',
    description:
      'Container security, watchlists, dashboards, and shared team visibility all start from one place. This short introduction shows how JustScan is organized before you enter the app.',
  },
  {
    eyebrow: 'Introduction 2 of 4',
    title: 'Workspaces organize who can see and manage security work.',
    description:
      'In JustScan, every scan, registry, tag, suppression, and watchlist item belongs to a workspace. Personal workspaces are yours. Organization workspaces are shared team contexts.',
  },
  {
    eyebrow: 'Introduction 3 of 4',
    title: 'Changing workspace changes the dashboard and lists you are looking at.',
    description:
      'When you switch workspace, you are changing the ownership context for the data you browse. Shared items can appear inside a workspace without changing who actually owns them.',
  },
  {
    eyebrow: 'Introduction 4 of 4',
    title: 'Choose your starting workspace.',
    description:
      'Pick the workspace you want to enter first. You can switch again later from the workspace selector in the app shell.',
  },
];

function ProductIntroAnimation() {
  const items = [
    { label: 'Scan', delay: 0, color: '#a78bfa' },
    { label: 'Registry', delay: 1.2, color: '#38bdf8' },
    { label: 'Watchlist', delay: 2.4, color: '#f59e0b' },
  ];

  return (
    <div
      className="workspace-onboarding-intro-animation relative h-[300px] w-full overflow-hidden rounded-[40px] md:h-[340px] xl:h-[380px]"
    >
      <style>{`
        .workspace-onboarding-intro-animation {
          background:
            radial-gradient(circle at 16% 16%, rgba(124,58,237,0.14) 0%, transparent 24%),
            radial-gradient(circle at 84% 78%, rgba(56,189,248,0.14) 0%, transparent 24%),
            linear-gradient(145deg, rgba(255,255,255,0.68) 0%, rgba(255,255,255,0.24) 56%, rgba(186,230,253,0.12) 100%);
          border: 1px solid var(--glass-border);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.48), 0 26px 60px rgba(24,24,27,0.08);
        }

        .dark .workspace-onboarding-intro-animation {
          background:
            radial-gradient(circle at 14% 14%, rgba(124,58,237,0.24) 0%, transparent 24%),
            radial-gradient(circle at 84% 78%, rgba(56,189,248,0.2) 0%, transparent 26%),
            linear-gradient(145deg, rgba(30,27,45,0.94) 0%, rgba(17,17,21,0.92) 58%, rgba(8,12,18,0.98) 100%);
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 30px 70px rgba(0,0,0,0.42);
        }

        .workspace-onboarding-intro-track {
          background: linear-gradient(90deg, transparent, rgba(124,58,237,0.2), rgba(124,58,237,0.28), transparent);
        }

        .dark .workspace-onboarding-intro-track {
          background: linear-gradient(90deg, transparent, rgba(167,139,250,0.28), rgba(56,189,248,0.28), transparent);
        }

        .workspace-onboarding-intro-pill {
          background: rgba(255,255,255,0.78);
          border: 1px solid rgba(255,255,255,0.82);
          box-shadow: 0 12px 28px rgba(24,24,27,0.08);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }

        .dark .workspace-onboarding-intro-pill {
          background: rgba(24,24,27,0.76);
          border: 1px solid rgba(255,255,255,0.1);
          box-shadow: 0 20px 38px rgba(0,0,0,0.3);
        }

        .workspace-onboarding-intro-panel {
          background: rgba(124,58,237,0.06);
          border: 1px solid rgba(167,139,250,0.24);
        }

        .dark .workspace-onboarding-intro-panel {
          background: rgba(91,33,182,0.16);
          border: 1px solid rgba(167,139,250,0.22);
        }

        .workspace-onboarding-intro-dashboard {
          background: rgba(255,255,255,0.72);
          border: 1px solid rgba(255,255,255,0.78);
          box-shadow: 0 18px 34px rgba(24,24,27,0.08);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
        }

        .dark .workspace-onboarding-intro-dashboard {
          background: rgba(20,20,24,0.84);
          border: 1px solid rgba(255,255,255,0.12);
          box-shadow: 0 24px 40px rgba(0,0,0,0.34);
        }

        .workspace-onboarding-intro-dashboard-track {
          background: rgba(24,24,27,0.08);
        }

        .dark .workspace-onboarding-intro-dashboard-track {
          background: rgba(255,255,255,0.08);
        }

        @keyframes onboarding-item-travel {
          0% { transform: translateX(-120px); opacity: 0; }
          10% { opacity: 1; }
          40% { transform: translateX(0px); opacity: 1; }
          65% { transform: translateX(clamp(240px, 27vw, 460px)); opacity: 1; }
          100% { transform: translateX(clamp(520px, 56vw, 920px)); opacity: 0; }
        }

        @keyframes onboarding-scan-beam {
          0%, 100% { transform: translateY(-86px); opacity: 0.55; }
          50% { transform: translateY(86px); opacity: 1; }
        }

        @keyframes onboarding-panel-pulse {
          0%, 100% { box-shadow: 0 0 0 1px rgba(167,139,250,0.18), 0 14px 28px rgba(124,58,237,0.08); }
          50% { box-shadow: 0 0 0 1px rgba(167,139,250,0.3), 0 22px 36px rgba(124,58,237,0.14); }
        }

        @keyframes onboarding-bar-glow {
          0%, 100% { opacity: 0.45; transform: scaleX(0.92); }
          50% { opacity: 1; transform: scaleX(1); }
        }
      `}</style>

      <div
        className="pointer-events-none absolute left-[-8%] top-[-16%] h-64 w-64 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 72%)' }}
      />
      <div
        className="pointer-events-none absolute bottom-[-14%] right-[-7%] h-72 w-72 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.16) 0%, transparent 72%)' }}
      />
      <div className="pointer-events-none absolute inset-x-16 bottom-6 h-16 rounded-full bg-violet-500/10 blur-3xl dark:bg-violet-500/15" />

      <div
        className="workspace-onboarding-intro-track absolute left-10 right-10 top-1/2 h-px -translate-y-1/2 md:left-16 md:right-16 xl:left-20 xl:right-20"
      />

      {items.map((item) => (
        <div
          key={item.label}
          className="workspace-onboarding-intro-pill absolute left-8 top-[136px] z-10 flex w-[156px] items-center gap-2 rounded-2xl px-3 py-2 md:left-16 md:top-[156px] xl:left-24 xl:top-[176px]"
          style={{
            animation: 'onboarding-item-travel 4.6s ease-in-out infinite',
            animationDelay: `${item.delay}s`,
          }}
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} aria-hidden />
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-700">{item.label}</span>
        </div>
      ))}

      <div
        className="workspace-onboarding-intro-panel absolute left-1/2 top-6 h-[232px] w-[98px] -translate-x-1/2 rounded-[34px] md:top-8 md:h-[268px] xl:h-[304px]"
        style={{
          animation: 'onboarding-panel-pulse 2.8s ease-in-out infinite',
        }}
      >
        <div className="absolute inset-x-3 top-4 h-px rounded-full" style={{ background: 'rgba(167,139,250,0.36)' }} />
        <div className="absolute inset-x-3 bottom-4 h-px rounded-full" style={{ background: 'rgba(167,139,250,0.36)' }} />
        <div
          className="absolute inset-x-0 top-1/2 h-0.5"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(124,58,237,0.86), transparent)',
            boxShadow: '0 0 14px rgba(124,58,237,0.5)',
            animation: 'onboarding-scan-beam 2.2s ease-in-out infinite',
          }}
        />
      </div>

      <div
        className="workspace-onboarding-intro-dashboard absolute right-4 top-5 z-20 w-[228px] rounded-[28px] p-4 md:right-8 md:top-6 md:w-[256px] xl:right-12 xl:top-8 xl:w-[286px]"
      >
        <div className="flex items-center gap-2">
          <DashboardSquare01Icon size={16} className="text-violet-500" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-600 dark:text-zinc-300">Live dashboard</p>
        </div>
        <div className="mt-4 space-y-3">
          {[70, 54, 86].map((width, index) => (
            <div key={width} className="space-y-1.5">
              <div className="workspace-onboarding-intro-dashboard-track h-1.5 rounded-full" />
              <div
                className="h-2 rounded-full origin-left"
                style={{
                  width: `${width}%`,
                  background: index === 0
                    ? 'linear-gradient(90deg, rgba(124,58,237,0.82), rgba(167,139,250,0.95))'
                    : index === 1
                      ? 'linear-gradient(90deg, rgba(56,189,248,0.82), rgba(125,211,252,0.92))'
                      : 'linear-gradient(90deg, rgba(245,158,11,0.82), rgba(251,191,36,0.92))',
                  animation: 'onboarding-bar-glow 2.2s ease-in-out infinite',
                  animationDelay: `${index * 0.25}s`,
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function WorkspaceOnboarding({
  user,
  orgs,
  orgsReady,
  initialScope,
  onComplete,
  onSkip,
}: WorkspaceOnboardingProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedScope, setSelectedScope] = useState<WorkScope>(initialScope.kind === 'org'
    ? initialScope
    : { kind: 'personal' });

  useEffect(() => {
    if (selectedScope.kind !== 'org') return;
    if (orgs.some((org) => org.id === selectedScope.orgId)) return;
    setSelectedScope({ kind: 'personal' });
  }, [orgs, selectedScope]);

  const currentStep = steps[stepIndex]!;
  const displayName = user?.username ?? user?.email ?? null;
  const canFinish = stepIndex < 2 || orgsReady;

  function handleContinue() {
    if (stepIndex < steps.length - 1) {
      setStepIndex((current) => current + 1);
      return;
    }

    onComplete(selectedScope);
  }

  function renderScopeCard(scope: WorkScope, title: string, description: string) {
    const selected = selectedScope.kind === scope.kind
      && (scope.kind === 'personal' || selectedScope.kind === 'org' && selectedScope.orgId === scope.orgId);

    return (
      <button
        key={scope.kind === 'org' ? scope.orgId : 'personal'}
        type="button"
        aria-pressed={selected}
        onClick={() => setSelectedScope(scope)}
        className="rounded-2xl p-4 text-left transition-all duration-150"
        style={{
          background: selected ? 'linear-gradient(145deg, rgba(124,58,237,0.18) 0%, rgba(124,58,237,0.08) 100%)' : 'var(--row-hover)',
          border: selected ? '1px solid rgba(167,139,250,0.38)' : '1px solid var(--glass-border)',
          boxShadow: selected ? '0 12px 30px rgba(124,58,237,0.12)' : 'none',
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">{title}</p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{description}</p>
          </div>
          <span
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
            style={{
              background: selected ? 'rgba(124,58,237,0.2)' : 'rgba(148,163,184,0.12)',
              color: selected ? '#a78bfa' : '#94a3b8',
              border: selected ? '1px solid rgba(167,139,250,0.32)' : '1px solid rgba(148,163,184,0.18)',
            }}
          >
            {selected ? '✓' : ''}
          </span>
        </div>
      </button>
    );
  }

  return (
    <div className="app-bg relative min-h-dvh overflow-hidden px-3 py-3 md:px-5 md:py-5">
      <div
        className="pointer-events-none absolute left-[-10%] top-[-8%] h-[32rem] w-[32rem] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.16) 0%, transparent 72%)' }}
      />
      <div
        className="pointer-events-none absolute bottom-[-18%] right-[-8%] h-[34rem] w-[34rem] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.14) 0%, transparent 72%)' }}
      />

      <div className="glass-panel relative mx-auto flex min-h-[calc(100dvh-1.5rem)] max-w-[1600px] flex-col overflow-hidden rounded-[36px]">
        <header className="relative z-10 flex items-center justify-between gap-4 border-b px-5 py-4 md:px-8 md:py-5" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-2xl"
              style={{
                background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                boxShadow: '0 0 20px rgba(124,58,237,0.28), inset 0 1px 0 rgba(255,255,255,0.18)',
              }}
            >
              <Logo size={20} className="text-white" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">JustScan</p>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Workspace onboarding</p>
            </div>
          </div>
          <button type="button" className="text-sm text-zinc-500 transition-colors hover:text-zinc-800 dark:hover:text-zinc-200" onClick={onSkip}>
            Skip for now
          </button>
        </header>

        <main className="relative z-10 flex-1 overflow-y-auto px-5 py-6 md:px-8 md:py-8 xl:px-12 xl:py-10">
          <div className={stepIndex === 0 ? 'space-y-8' : 'grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] xl:gap-10'}>
            <section className={stepIndex === 0 ? 'space-y-8 xl:pr-0' : 'space-y-8'}>
              {stepIndex === 0 ? (
                <div className="space-y-8">
                  <div className="space-y-6">
                    <p className="text-xs uppercase tracking-[0.2em] text-violet-500">{currentStep.eyebrow}</p>
                    {displayName && (
                      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                        Good to see you, <span className="text-zinc-900 dark:text-white">{displayName}</span>.
                      </p>
                    )}
                    <h1 className="max-w-[36rem] text-4xl font-semibold tracking-tight text-zinc-950 dark:text-white md:text-5xl md:leading-[1.02] xl:text-[4.2rem]">
                      {currentStep.title}
                    </h1>
                    <p className="max-w-[44rem] text-base leading-8 text-zinc-600 dark:text-zinc-300 md:text-lg">
                      {currentStep.description}
                    </p>
                    <div className="flex flex-wrap gap-3 pt-2">
                      {['Scan artifacts', 'Track exposure', 'Organize by workspace'].map((item) => (
                        <span
                          key={item}
                          className="rounded-full px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200"
                          style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="pt-1">
                    <ProductIntroAnimation />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-violet-500">{currentStep.eyebrow}</p>
                  <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-zinc-950 dark:text-white md:text-5xl md:leading-[1.02] xl:text-[3.7rem]">
                    {currentStep.title}
                  </h1>
                  <p className="max-w-3xl text-base leading-8 text-zinc-600 dark:text-zinc-300 md:text-lg">
                    {currentStep.description}
                  </p>
                </div>
              )}

              {stepIndex === 1 && (
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-[28px] p-6" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                    <p className="text-lg font-semibold text-zinc-900 dark:text-white">Personal workspace</p>
                    <p className="mt-3 text-sm leading-7 text-zinc-600 dark:text-zinc-300">Your own scans, registries, tags, suppressions, and watchlist items live here.</p>
                  </div>
                  <div className="rounded-[28px] p-6" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                    <p className="text-lg font-semibold text-zinc-900 dark:text-white">Organization workspace</p>
                    <p className="mt-3 text-sm leading-7 text-zinc-600 dark:text-zinc-300">A shared team context where visibility and management depend on org membership and role.</p>
                  </div>
                  <div className="rounded-[28px] p-6 lg:col-span-2 xl:col-span-1" style={{ background: 'linear-gradient(145deg, rgba(124,58,237,0.12) 0%, rgba(14,165,233,0.08) 100%)', border: '1px solid rgba(124,58,237,0.18)' }}>
                    <p className="text-lg font-semibold text-zinc-900 dark:text-white">What is scoped</p>
                    <p className="mt-3 text-sm leading-7 text-zinc-600 dark:text-zinc-300">Scans, registries, tags, suppressions, watchlist items, and the dashboard views built on top of them.</p>
                  </div>
                </div>
              )}

              {stepIndex === 2 && (
                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="rounded-[28px] p-6" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                    <DashboardSquare01Icon size={22} className="text-violet-500" />
                    <p className="mt-4 text-lg font-semibold text-zinc-900 dark:text-white">Dashboards follow scope</p>
                    <p className="mt-3 text-sm leading-7 text-zinc-600 dark:text-zinc-300">Counts, trends, and recent activity reflect the workspace you are currently viewing.</p>
                  </div>
                  <div className="rounded-[28px] p-6" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                    <Shield01Icon size={22} className="text-sky-500" />
                    <p className="mt-4 text-lg font-semibold text-zinc-900 dark:text-white">Resources stay owned</p>
                    <p className="mt-3 text-sm leading-7 text-zinc-600 dark:text-zinc-300">A shared scan can appear in your current workspace while still being owned somewhere else.</p>
                  </div>
                  <div className="rounded-[28px] p-6" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                    <Tag01Icon size={22} className="text-amber-500" />
                    <p className="mt-4 text-lg font-semibold text-zinc-900 dark:text-white">Labels explain access</p>
                    <p className="mt-3 text-sm leading-7 text-zinc-600 dark:text-zinc-300">Personal, org, and shared badges tell you how an item is owned and why you can see it.</p>
                  </div>
                </div>
              )}

              {stepIndex === 3 && (
                <div className="space-y-4">
                  {renderScopeCard(
                    { kind: 'personal' },
                    'Personal workspace',
                    'Start with your own workspace and view resources that belong to you personally.',
                  )}
                  {orgsReady ? (
                    orgs.length > 0 ? (
                      <div className="grid gap-4 lg:grid-cols-2">
                        {orgs.map((org) => renderScopeCard(
                          { kind: 'org', orgId: org.id, orgName: org.name },
                          org.name,
                          org.description?.trim() || 'Enter the shared organization workspace for this team context.',
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-[28px] p-6 text-sm leading-7 text-zinc-600 dark:text-zinc-300" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                        You do not have organization access yet. Start in your personal workspace. If you are invited later, organization workspaces will appear in the workspace switcher.
                      </div>
                    )
                  ) : (
                    <div className="rounded-[28px] p-6 text-sm leading-7 text-zinc-600 dark:text-zinc-300" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                      Checking your organization access...
                    </div>
                  )}
                </div>
              )}
            </section>

            {stepIndex > 0 && (
              <aside className="space-y-4 xl:pt-2">
                <div className="rounded-[28px] p-6" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Product introduction</p>
                  <p className="mt-4 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-white">JustScan ties scanning, triage, and ownership together.</p>
                  <p className="mt-3 text-sm leading-7 text-zinc-600 dark:text-zinc-300">The product view only makes sense once users understand what belongs to them personally, what belongs to a team, and what they are only seeing through shared access.</p>
                </div>
                <div className="space-y-3">
                  <div className="rounded-[28px] p-5" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white">Scan and monitor</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">Run scans, track vulnerabilities, and keep watchlist signals visible where the right people can act on them.</p>
                  </div>
                  <div className="rounded-[28px] p-5" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white">Organize by workspace</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">Workspaces keep dashboards, tags, suppressions, and access boundaries aligned with how teams actually operate.</p>
                  </div>
                </div>
              </aside>
            )}
          </div>
        </main>

        <footer className="relative z-10 flex flex-col gap-4 border-t px-5 py-4 md:px-8 md:py-5 lg:flex-row lg:items-center lg:justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-2">
            {steps.map((step, index) => (
              <span
                key={step.eyebrow}
                className="h-2.5 rounded-full transition-all duration-200"
                style={{
                  width: index === stepIndex ? 30 : 10,
                  background: index <= stepIndex ? 'linear-gradient(90deg, #a78bfa, #7c3aed)' : 'rgba(161,161,170,0.25)',
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 self-end lg:self-auto">
            {stepIndex > 0 && (
              <button type="button" className="btn-secondary" onClick={() => setStepIndex((current) => current - 1)}>
                Back
              </button>
            )}
            <button type="button" className="btn-primary" onClick={handleContinue} disabled={!canFinish}>
              {stepIndex === 0 ? 'Start guide' : stepIndex === steps.length - 1 ? 'Open dashboard' : 'Continue'}
              <ArrowRight01Icon size={16} />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}