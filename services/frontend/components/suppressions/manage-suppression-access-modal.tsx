'use client';

import { OwnershipBadge } from '@/components/ui/badges';
import { FormAlert } from '@/components/ui/form-alert';
import type { ResourceShare, Suppression } from '@/lib/api';
import { Button, Card, ListBox, Modal, Select, useOverlayState } from '@heroui/react';
import { Delete01Icon } from 'hugeicons-react';

type OrgOption = {
  id: string;
  name: string;
};

type ManageSuppressionAccessModalProps = {
  state: ReturnType<typeof useOverlayState>;
  target: Suppression | null;
  shares: ResourceShare[];
  loading: boolean;
  error: string;
  saving: boolean;
  selectedOrgId: string;
  onSelectedOrgIdChange: (value: string) => void;
  onGrant: () => void;
  onRevoke: (orgId: string) => void;
  availableOrgTargets: OrgOption[];
  orgNamesById: Record<string, string>;
  selectTriggerClassName?: string;
};

export function ManageSuppressionAccessModal({
  state,
  target,
  shares,
  loading,
  error,
  saving,
  selectedOrgId,
  onSelectedOrgIdChange,
  onGrant,
  onRevoke,
  availableOrgTargets,
  orgNamesById,
  selectTriggerClassName,
}: ManageSuppressionAccessModalProps) {
  return (
    <Modal state={state}>
      <Modal.Backdrop isDismissable>
        <Modal.Container size="md" placement="center">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">
                Manage Suppression Access
              </Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="py-5 space-y-4">
              {error ? <FormAlert description={error} title="Access update failed" /> : null}
              {target ? (
                <Card className="py-3" variant="secondary">
                  <div className="flex flex-wrap gap-2">
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {target.vuln_id}
                    </p>
                    <OwnershipBadge
                      ownerType={target.owner_type}
                      ownerOrgId={target.owner_org_id}
                      orgNamesById={orgNamesById}
                    />
                  </div>
                  <p className="font-mono text-xs text-zinc-500" title={target.image_digest}>
                    {target.image_digest.length > 48
                      ? `${target.image_digest.slice(0, 48)}…`
                      : target.image_digest}
                  </p>
                </Card>
              ) : null}

              <div className="space-y-2">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                    Current access
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Organizations listed here can use this suppression.
                  </p>
                </div>
                {loading ? (
                  <div className="flex justify-center py-6">
                    <div className="size-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-accent-500 animate-spin" />
                  </div>
                ) : shares.length === 0 ? (
                  <p className="text-sm text-zinc-500">No organization grants yet.</p>
                ) : (
                  <div className="space-y-2">
                    {shares.map((share) => (
                      <Card key={share.org_id} variant="secondary">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                              {share.org_name}
                            </p>
                            <p className="text-xs text-zinc-500">
                              {share.is_owner ? 'Owner workspace' : 'Shared access'}
                            </p>
                          </div>
                          {share.is_owner ? (
                            <span className="text-xs font-medium text-zinc-500">Locked</span>
                          ) : (
                            <Button
                              onPress={() => onRevoke(share.org_id)}
                              isDisabled={saving}
                              isIconOnly
                              variant="danger-soft"
                            >
                              <Delete01Icon size={15} />
                            </Button>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                    Grant access
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Share this suppression with another organization you manage.
                  </p>
                </div>
                {availableOrgTargets.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    No additional organizations are available for sharing.
                  </p>
                ) : (
                  <div className="flex gap-2">
                    <Select
                      value={selectedOrgId || '__none__'}
                      onChange={(value) =>
                        onSelectedOrgIdChange(String(value === '__none__' ? '' : (value ?? '')))
                      }
                      className="flex-1"
                      variant="secondary"
                    >
                      <Select.Trigger className={selectTriggerClassName}>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="__none__">Select an organization</ListBox.Item>
                          {availableOrgTargets.map((org) => (
                            <ListBox.Item key={org.id} id={org.id}>
                              {org.name}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <Button
                      type="button"
                      onPress={onGrant}
                      isDisabled={!selectedOrgId || saving}
                      className="btn-primary disabled:opacity-60"
                      variant="primary"
                    >
                      Grant
                    </Button>
                  </div>
                )}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button onPress={state.close} className="btn-secondary" type="button" variant="secondary">
                Close
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
