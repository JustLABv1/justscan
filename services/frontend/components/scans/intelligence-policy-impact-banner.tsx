'use client';

import type { ScanIntelligencePolicyImpactResponse } from '@/lib/api';
import { Alert, Button, Chip, Link as HeroLink } from '@heroui/react';
import { Refresh01Icon, ShieldKeyIcon } from 'hugeicons-react';

interface IntelligencePolicyImpactBannerProps {
  impact: ScanIntelligencePolicyImpactResponse;
  canRescan: boolean;
  rescanPending?: boolean;
  rescanDisabledReason?: string;
  onRescan: () => void;
}

function impactPriority(impact: string) {
  switch (impact) {
    case 'needs_validation':
      return 3;
    case 'new_failure':
    case 'still_failed':
      return 2;
    case 'resolved':
      return 1;
    default:
      return 0;
  }
}

function bannerCopy(impact: string) {
  switch (impact) {
    case 'resolved':
      return {
        status: 'success' as const,
        title: 'Resolved by current intelligence — original scan remains failed',
        description:
          'Current CVE data no longer produces the historical policy violation. Run a new scan before treating the policy as passed.',
      };
    case 'new_failure':
      return {
        status: 'danger' as const,
        title: 'New policy failure caused by current intelligence',
        description:
          'A later CVE update now produces a policy violation. The scan result is unchanged, and a new scan is required to confirm the current state.',
      };
    case 'still_failed':
      return {
        status: 'danger' as const,
        title: 'Still failing under current intelligence',
        description:
          'CVE intelligence changed one or more policy inputs, but the affected policies still fail. Run a new scan to confirm the current result.',
      };
    default:
      return {
        status: 'warning' as const,
        title: 'Needs validation — rescan required',
        description:
          'The latest intelligence is disputed, incomplete, or conflicting. The original policy result is preserved until a new scan confirms the current state.',
      };
  }
}

function formatStatus(status: string) {
  switch (status) {
    case 'needs_validation':
      return 'Needs validation';
    case 'pass':
      return 'Pass';
    case 'fail':
      return 'Fail';
    default:
      return status.replaceAll('_', ' ');
  }
}

export function IntelligencePolicyImpactBanner({
  impact,
  canRescan,
  rescanPending = false,
  rescanDisabledReason,
  onRescan,
}: IntelligencePolicyImpactBannerProps) {
  if (!impact.has_impact || impact.policies.length === 0) {
    return null;
  }

  const primaryImpact = impact.policies.reduce<string>((current, policy) => {
    return impactPriority(policy.impact) > impactPriority(current) ? policy.impact : current;
  }, impact.policies[0]?.impact ?? 'needs_validation');
  const copy = bannerCopy(primaryImpact);
  const policyNames = Array.from(new Set(impact.policies.map((policy) => policy.policy_name)));
  const visiblePolicies = impact.policies.slice(0, 4);
  const remainingPolicies = Math.max(0, impact.policies.length - visiblePolicies.length);
  const cves = Array.from(
    new Set(impact.policies.flatMap((policy) => policy.changed_cves).filter(Boolean))
  );
  const visibleCVEs = cves.slice(0, 8);
  const remainingCVEs = Math.max(0, cves.length - visibleCVEs.length);

  return (
    <Alert className="items-start gap-3" status={copy.status}>
      <Alert.Indicator>
        <ShieldKeyIcon size={18} />
      </Alert.Indicator>
      <Alert.Content className="min-w-0 flex-1 gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Alert.Title>{copy.title}</Alert.Title>
            <Alert.Description className="mt-1 max-w-4xl">{copy.description}</Alert.Description>
          </div>
          {canRescan ? (
            <Button
              isDisabled={rescanPending}
              isPending={rescanPending}
              onPress={onRescan}
              size="sm"
              variant="secondary"
            >
              {!rescanPending ? <Refresh01Icon size={15} /> : null}
              {rescanPending ? 'Queueing…' : 'Rescan now'}
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>Policies:</span>
          {policyNames.map((policyName) => (
            <Chip key={policyName} color={copy.status} size="sm" variant="soft">
              {policyName}
            </Chip>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {visiblePolicies.map((policy) => (
            <div
              className="rounded-lg border border-divider/60 bg-surface/40 px-3 py-2"
              key={`${policy.org_id}-${policy.policy_id}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium text-foreground">{policy.policy_name}</span>
                <span className="text-muted">
                  {formatStatus(policy.historical_status)} → {formatStatus(policy.current_status)}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted">{policy.reason}</p>
            </div>
          ))}
          {remainingPolicies > 0 ? (
            <p className="self-center text-xs text-muted">
              +{remainingPolicies} more affected {remainingPolicies === 1 ? 'policy' : 'policies'}
            </p>
          ) : null}
        </div>

        {visibleCVEs.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>Changed CVEs:</span>
            {visibleCVEs.map((cve) => (
              <HeroLink
                key={cve}
                className="font-mono text-accent underline-offset-2"
                href={`/vulnkb/${encodeURIComponent(cve)}`}
              >
                {cve}
              </HeroLink>
            ))}
            {remainingCVEs > 0 ? <span>+{remainingCVEs} more</span> : null}
          </div>
        ) : null}

        {!canRescan && rescanDisabledReason ? (
          <p className="text-xs text-muted">{rescanDisabledReason}</p>
        ) : null}
      </Alert.Content>
    </Alert>
  );
}
