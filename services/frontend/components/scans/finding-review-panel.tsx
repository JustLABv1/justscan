'use client';

import { MessageSquareText, ShieldCheck, Trash2, Users } from 'lucide-react';
import { Badge } from '@/components/panelui/badge';
import { Card } from '@/components/panelui/card';
import { OwnershipBadge, SuppressionSourceBadge } from '@/components/ui/badges';
import { FormField } from '@/components/ui/form-field';
import { nativeFieldClassName } from '@/components/ui/form-styles';
import {
  Button,
  DateField,
  DatePicker,
  DatePickerCalendar,
  ListBox,
  Select,
  TextArea,
} from '@/components/ui';
import type { Suppression, Vulnerability } from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { CalendarDate } from '@internationalized/date';

type SuppressionScope = 'personal' | 'workspace' | 'global';

export interface FindingReviewPanelProps {
  vuln: Vulnerability;
  /** Suppressions are only recorded for scans that have an image digest. */
  showRiskDecision: boolean;
  canMutate: boolean;
  isPlatformAdmin: boolean;
  workScope: { kind: string; orgName?: string | null };
  orgNamesById: Record<string, string>;
  currentUserId?: string | null;
  decision: {
    status: Suppression['status'];
    onStatusChange: (value: Suppression['status']) => void;
    scope: SuppressionScope;
    onScopeChange: (value: SuppressionScope) => void;
    justification: string;
    onJustificationChange: (value: string) => void;
    expiry: CalendarDate | null;
    onExpiryChange: (value: CalendarDate | null) => void;
    saving: boolean;
    error: string;
    onSave: () => void;
    onLift: () => void;
    canManageAccess: (suppression: Suppression) => boolean;
    onManageAccess: (suppression: Suppression) => void;
  };
  notes: {
    text: string;
    onTextChange: (value: string) => void;
    saving: boolean;
    onAdd: () => void;
    onDelete: (commentId: string) => void;
  };
}

const SCOPE_HINT: Record<SuppressionScope, string> = {
  global: 'Visible in all workspaces.',
  workspace: 'Visible in the selected organization workspace.',
  personal: 'Visible only in your personal workspace unless shared later.',
};

function FieldLabel({ children }: { children: string }) {
  return <span className="text-xs font-medium text-muted-foreground">{children}</span>;
}

function SectionIcon({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
    >
      {children}
    </span>
  );
}

/**
 * The review area under an expanded finding: the risk decision (suppression)
 * and the team notes, side by side instead of two collapsed rows.
 */
export function FindingReviewPanel({
  vuln,
  showRiskDecision,
  canMutate,
  isPlatformAdmin,
  workScope,
  orgNamesById,
  currentUserId,
  decision,
  notes,
}: FindingReviewPanelProps) {
  const suppression = vuln.suppression;
  const comments = vuln.comments ?? [];
  const readOnlySuppression = Boolean(suppression?.read_only || suppression?.source === 'xray');
  const lockedBySystem = suppression?.owner_type === 'system' && !isPlatformAdmin;
  const canEdit = canMutate && !readOnlySuppression && !lockedBySystem;

  return (
    <div
      // The findings table can be wider than its scroll area; keep the panel
      // pinned to the visible width instead of running off the right edge.
      className={cn(
        'sticky left-4 grid w-[calc(100cqw-2rem)] items-start gap-4',
        showRiskDecision && 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'
      )}
    >
      {showRiskDecision && (
        <Card as="section" size="sm" aria-label="Risk decision" className="whitespace-normal">
          <Card.Header>
            <div className="flex items-start gap-3">
              <SectionIcon>
                <ShieldCheck className="size-4" />
              </SectionIcon>
              <div className="min-w-0">
                <Card.Title>Risk decision</Card.Title>
                <Card.Description>
                  {suppression
                    ? 'An exception is recorded for this finding.'
                    : 'No exception recorded.'}
                </Card.Description>
              </div>
            </div>
            <Card.Action>
              <Badge variant={suppression ? 'warning' : 'secondary'} dot={Boolean(suppression)}>
                {suppression ? suppression.status.replace(/_/g, ' ') : 'None'}
              </Badge>
            </Card.Action>
          </Card.Header>

          <Card.Content className="space-y-3">
            {suppression && (
              <div className="space-y-3 rounded-lg bg-muted/50 p-3">
                <p className="text-sm text-foreground">
                  {suppression.justification || 'No justification provided.'}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <SuppressionSourceBadge source={suppression.source} />
                    <OwnershipBadge
                      ownerType={suppression.owner_type}
                      ownerOrgId={suppression.owner_org_id}
                      orgNamesById={orgNamesById}
                    />
                    {suppression.read_only && <Badge variant="outline">Managed by Xray</Badge>}
                  </div>
                  {decision.canManageAccess(suppression) && (
                    <Button
                      onPress={() => decision.onManageAccess(suppression)}
                      size="sm"
                      className="inline-flex items-center gap-1.5"
                      type="button"
                      variant="secondary"
                    >
                      <Users className="size-3.5" />
                      Manage access
                    </Button>
                  )}
                </div>
                <dl className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                  {suppression.expires_at && (
                    <div className="flex gap-1.5">
                      <dt>Expires</dt>
                      <dd className="text-foreground">
                        {new Date(suppression.expires_at).toLocaleDateString()}
                      </dd>
                    </div>
                  )}
                  {suppression.username && (
                    <div className="flex gap-1.5">
                      <dt>By</dt>
                      <dd className="text-foreground">{suppression.username}</dd>
                    </div>
                  )}
                  {(suppression.xray_policy_name || suppression.xray_watch_name) && (
                    <div className="flex gap-1.5 sm:col-span-2">
                      <dt>Xray</dt>
                      <dd className="text-foreground">
                        {[suppression.xray_policy_name, suppression.xray_watch_name]
                          .filter(Boolean)
                          .join(' · ')}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            {canEdit ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel>Decision</FieldLabel>
                    <Select
                      aria-label="Decision"
                      value={decision.status}
                      onChange={(value: unknown) =>
                        decision.onStatusChange(value as Suppression['status'])
                      }
                      variant="secondary"
                    >
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="accepted">Accepted risk</ListBox.Item>
                          <ListBox.Item id="wont_fix">Won&apos;t fix</ListBox.Item>
                          <ListBox.Item id="false_positive">False positive</ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel>Applies to</FieldLabel>
                    <Select
                      aria-label="Applies to"
                      value={decision.scope}
                      onChange={(value: unknown) =>
                        decision.onScopeChange(
                          (value as SuppressionScope) ??
                            (workScope.kind === 'org' ? 'workspace' : 'personal')
                        )
                      }
                      variant="secondary"
                      isDisabled={Boolean(suppression)}
                    >
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="personal">Personal</ListBox.Item>
                          {(workScope.kind === 'org' || decision.scope === 'workspace') && (
                            <ListBox.Item id="workspace">
                              {workScope.kind === 'org' && workScope.orgName
                                ? `Workspace: ${workScope.orgName}`
                                : 'Organization workspace'}
                            </ListBox.Item>
                          )}
                          {isPlatformAdmin && (
                            <ListBox.Item id="global">Global (all workspaces)</ListBox.Item>
                          )}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel>Expires</FieldLabel>
                    <DatePicker
                      aria-label="Expiry date (optional)"
                      value={decision.expiry}
                      onChange={decision.onExpiryChange}
                      className="w-full"
                    >
                      <DateField.Group
                        className={`${nativeFieldClassName} flex min-h-10 items-center justify-between gap-1`}
                      >
                        <DateField.Input>
                          {(segment: Parameters<typeof DateField.Segment>[0]['segment']) => (
                            <DateField.Segment segment={segment} />
                          )}
                        </DateField.Input>
                        <DateField.Suffix>
                          <DatePicker.Trigger>
                            <DatePicker.TriggerIndicator />
                          </DatePicker.Trigger>
                        </DateField.Suffix>
                      </DateField.Group>
                      <DatePicker.Popover>
                        <DatePickerCalendar aria-label="Expiry date" />
                      </DatePicker.Popover>
                    </DatePicker>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <FieldLabel>Justification</FieldLabel>
                  <FormField
                    hideLabel
                    label="Justification"
                    type="text"
                    value={decision.justification}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      decision.onJustificationChange(event.target.value)
                    }
                    placeholder="Why is this acceptable?"
                    className="w-full"
                    containerClassName="w-full"
                  />
                </div>

                {decision.error && <p className="text-xs text-destructive">{decision.error}</p>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {!canMutate
                  ? 'Your role has read-only suppression access in this organization.'
                  : suppression?.owner_type === 'system'
                    ? 'This is a global suppression. Only platform admins can edit it here.'
                    : 'This suppression comes from Xray and cannot be edited here.'}
              </p>
            )}
          </Card.Content>

          {canEdit && (
            <Card.Footer variant="panel" className="justify-between gap-3">
              <span className="text-xs text-muted-foreground">{SCOPE_HINT[decision.scope]}</span>
              <div className="flex items-center gap-2">
                {suppression && (
                  <Button
                    onPress={decision.onLift}
                    isDisabled={decision.saving}
                    type="button"
                    variant="secondary"
                  >
                    Remove
                  </Button>
                )}
                <Button
                  onPress={decision.onSave}
                  isDisabled={decision.saving || !decision.justification.trim()}
                  type="button"
                  variant="primary"
                >
                  {suppression ? 'Update exception' : 'Suppress finding'}
                </Button>
              </div>
            </Card.Footer>
          )}
        </Card>
      )}

      <Card as="section" size="sm" aria-label="Notes" className="whitespace-normal">
        <Card.Header>
          <div className="flex items-start gap-3">
            <SectionIcon>
              <MessageSquareText className="size-4" />
            </SectionIcon>
            <div className="min-w-0">
              <Card.Title>Notes</Card.Title>
              <Card.Description>
                {comments.length > 0
                  ? `${comments.length} team note${comments.length === 1 ? '' : 's'}`
                  : 'Capture context for your team.'}
              </Card.Description>
            </div>
          </div>
          <Card.Action>
            <Badge variant="secondary">{comments.length}</Badge>
          </Card.Action>
        </Card.Header>

        <Card.Content className="space-y-3">
          {comments.length > 0 ? (
            <ul className="space-y-2">
              {comments.map((comment) => (
                <li key={comment.id} className="rounded-lg bg-muted/50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-xs font-semibold text-foreground">
                          {comment.username || 'You'}
                        </span>
                        <span
                          className="text-xs text-muted-foreground"
                          title={fullDate(comment.created_at)}
                        >
                          {timeAgo(comment.created_at)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm break-words text-foreground">{comment.content}</p>
                    </div>
                    {currentUserId === comment.user_id && (
                      <Button
                        aria-label="Delete note"
                        onPress={() => notes.onDelete(comment.id)}
                        className="shrink-0"
                        isIconOnly
                        size="sm"
                        variant="secondary"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No notes yet. Add context for teammates here.
            </p>
          )}

          <TextArea
            aria-label="Add a note"
            className="w-full"
            value={notes.text}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
              notes.onTextChange(event.target.value)
            }
            placeholder="Add a note…"
            rows={3}
          />
        </Card.Content>

        <Card.Footer variant="panel" className="justify-end">
          <Button
            onPress={notes.onAdd}
            isDisabled={notes.saving || !notes.text.trim()}
            type="button"
            variant="primary"
          >
            Add note
          </Button>
        </Card.Footer>
      </Card>
    </div>
  );
}
