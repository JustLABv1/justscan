'use client';

import type { ScanIntelligencePolicyImpactResponse } from '@/lib/api';
import { Accordion, Alert, Button, Chip, Link as HeroLink } from '@heroui/react';
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

function impactMeta(impact: string) {
  switch (impact) {
    case 'resolved':
      return {
        status: 'success' as const,
        label: 'Would resolve',
        description:
          'Current CVE data no longer produces the historical policy violation. Run a confirmation scan before treating the policy as passed.',
      };
    case 'new_failure':
      return {
        status: 'danger' as const,
        label: 'Would fail',
        description:
          'A later CVE update now produces a policy violation. The stored result is unchanged until a confirmation scan completes.',
      };
    case 'still_failed':
      return {
        status: 'danger' as const,
        label: 'Still failing',
        description:
          'CVE intelligence changed one or more policy inputs, but the affected policies still fail. Run a confirmation scan to verify the result.',
      };
    default:
      return {
        status: 'warning' as const,
        label: 'Needs validation',
        description:
          'The latest intelligence is disputed, incomplete, or conflicting. The stored policy result is preserved until a confirmation scan runs.',
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
  const meta = impactMeta(primaryImpact);
  const policyNames = Array.from(new Set(impact.policies.map((policy) => policy.policy_name)));
  const cves = Array.from(
    new Set(impact.policies.flatMap((policy) => policy.changed_cves).filter(Boolean))
  );
  const changedFindingCount = impact.policies.reduce(
    (total, policy) => total + policy.changed_finding_count,
    0
  );

  return (
    <Alert className="items-start gap-3 py-4" status={meta.status}>
      <Alert.Indicator>
        <ShieldKeyIcon size={18} />
      </Alert.Indicator>
      <Alert.Content className="min-w-0 flex-1 gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <Alert.Title>Policy result pending confirmation</Alert.Title>
            <Alert.Description className="mt-1 max-w-4xl">{meta.description}</Alert.Description>
          </div>
          {canRescan ? (
            <Button
              className="shrink-0 self-start"
              isDisabled={rescanPending}
              isPending={rescanPending}
              onPress={onRescan}
              size="sm"
              variant="secondary"
            >
              {!rescanPending ? <Refresh01Icon size={15} /> : null}
              {rescanPending ? 'Queueing…' : 'Run confirmation scan'}
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Chip color={meta.status} size="sm" variant="soft">
            {meta.label}
          </Chip>
          <Chip color="warning" size="sm" variant="soft">
            {cves.length} CVE{cves.length === 1 ? '' : 's'} changed
          </Chip>
          <Chip color="default" size="sm" variant="soft">
            {changedFindingCount} finding{changedFindingCount === 1 ? '' : 's'} affected
          </Chip>
          <span className="text-xs text-muted">Stored result preserved</span>
        </div>

        <Accordion className="w-full overflow-hidden rounded-lg border border-divider/70 bg-surface/40" hideSeparator>
          <Accordion.Item id="policy-impact">
            <Accordion.Heading>
              <Accordion.Trigger className="group flex min-h-10 w-full items-center gap-3 px-3 text-left hover:bg-surface-secondary/70">
                <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                  Review policy impact
                </span>
                <span className="hidden text-xs text-muted sm:inline">
                  {policyNames.length} {policyNames.length === 1 ? 'policy' : 'policies'} affected
                </span>
                <Accordion.Indicator className="shrink-0 text-muted group-hover:text-foreground [&>svg]:size-4" />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel className="border-t border-divider/70">
              <Accordion.Body className="space-y-3 px-3 pb-3 pt-3">
                <div className="space-y-2">
                  {impact.policies.map((policy) => (
                    <div
                      className="border-l-2 border-divider pl-3"
                      key={`${policy.org_id}-${policy.policy_id}`}
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span className="font-medium text-foreground">{policy.policy_name}</span>
                        <span className="text-muted">
                          {formatStatus(policy.historical_status)} →{' '}
                          {formatStatus(policy.current_status)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted">{policy.reason}</p>
                    </div>
                  ))}
                </div>

                {cves.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <span>Changed CVEs:</span>
                    {cves.map((cve) => (
                      <HeroLink
                        key={cve}
                        className="font-mono text-accent underline-offset-2"
                        href={`/vulnkb/${encodeURIComponent(cve)}`}
                      >
                        {cve}
                      </HeroLink>
                    ))}
                  </div>
                ) : null}

                <p className="text-xs text-muted">Policies: {policyNames.join(', ')}</p>
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>

        {!canRescan && rescanDisabledReason ? (
          <p className="text-xs text-muted">{rescanDisabledReason}</p>
        ) : null}
      </Alert.Content>
    </Alert>
  );
}
