import type { Org, OrgPolicy } from '@/lib/api';
import { Button, Card } from '@heroui/react';
import { Delete01Icon, PencilEdit01Icon, PlusSignIcon } from 'hugeicons-react';

import { RulePill } from './shared';

interface OrgAutomationTabProps {
  org: Org;
  canManageOrgSettings: boolean;
  onCreatePolicy: () => void;
  onEditPolicy: (policy: OrgPolicy) => void;
  onDeletePolicy: (policyId: string) => void | Promise<void>;
}

export function OrgAutomationTab({
  org,
  canManageOrgSettings,
  onCreatePolicy,
  onEditPolicy,
  onDeletePolicy,
}: OrgAutomationTabProps) {
  const policies = org.policies ?? [];

  return (
    <Card>
      <Card.Header className="flex-row items-start justify-between gap-4">
        <div>
          <Card.Title>Compliance policies</Card.Title>
          <Card.Description>
            Rules are evaluated whenever a scan is explicitly in this organization&apos;s scope.
          </Card.Description>
        </div>
        <Button onPress={onCreatePolicy} isDisabled={!canManageOrgSettings}>
          <PlusSignIcon size={14} />
          Add policy
        </Button>
      </Card.Header>
      <Card.Content>
        {policies.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-divider p-8 text-center">
            <p className="text-sm font-medium">No compliance policies yet</p>
            <p className="mt-1 text-sm text-muted">Create a policy to evaluate scans in scope.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {policies.map((policy) => (
              <Card key={policy.id} variant="secondary">
                <Card.Content className="flex-row items-center justify-between gap-4">
                  <div className="min-w-0 space-y-2">
                    <p className="text-sm font-medium">{policy.name}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {policy.rules.map((rule, index) => (
                        <RulePill key={index} rule={rule} />
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      aria-label={`Edit ${policy.name}`}
                      isIconOnly
                      variant="secondary"
                      isDisabled={!canManageOrgSettings}
                      onPress={() => onEditPolicy(policy)}
                    >
                      <PencilEdit01Icon size={15} />
                    </Button>
                    <Button
                      aria-label={`Delete ${policy.name}`}
                      isIconOnly
                      variant="danger-soft"
                      isDisabled={!canManageOrgSettings}
                      onPress={() => void onDeletePolicy(policy.id)}
                    >
                      <Delete01Icon size={15} />
                    </Button>
                  </div>
                </Card.Content>
              </Card>
            ))}
          </div>
        )}
      </Card.Content>
    </Card>
  );
}
