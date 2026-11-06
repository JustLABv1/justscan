'use client';

import { ChevronsUpDown } from 'lucide-react';
import { Avatar } from '@/components/panelui/avatar';
import { Menu } from '@/components/panelui/menu';
import { StatusDot } from '@/components/ui/status-dot';
import { cn } from '@/lib/utils';

type WorkspaceOption = { id: string; name: string };
type InviteOption = { id: string; org_name?: string | null };

/**
 * Shows the active workspace and lets you switch to another one, or review a
 * pending invitation. Built on PanelUI's Menu and Avatar.
 */
export function WorkspaceSwitcher({
  scopeLabel,
  scopeValue,
  orgs,
  invites,
  collapsed = false,
  onScopeChange,
  onReviewInvite,
  id,
  className,
}: {
  scopeLabel: string;
  /** `personal` or an organization id. */
  scopeValue: string;
  orgs: WorkspaceOption[];
  invites: InviteOption[];
  collapsed?: boolean;
  onScopeChange: (value: string) => void;
  onReviewInvite: () => void;
  id?: string;
  className?: string;
}) {
  const inviteLabel =
    invites.length > 0
      ? `, ${invites.length} pending organization invite${invites.length === 1 ? '' : 's'}`
      : '';

  return (
    <Menu>
      <Menu.Trigger
        id={id}
        aria-label={`Workspace: ${scopeLabel}${inviteLabel}`}
        title={collapsed ? `Workspace: ${scopeLabel}` : undefined}
        className={cn(
          'flex min-w-0 items-center rounded-lg text-left outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-ring',
          collapsed ? 'relative size-10 justify-center' : 'w-full gap-2.5 p-2',
          className
        )}
      >
        <Avatar name={scopeLabel} shape="square" size={collapsed ? 'md' : 'sm'} />
        {collapsed ? (
          invites.length > 0 ? (
            <StatusDot tone="warning" className="absolute right-1 top-1" />
          ) : null
        ) : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-muted-foreground">Workspace</span>
              <span className="block truncate text-sm font-medium text-foreground">
                {scopeLabel}
              </span>
            </span>
            {invites.length > 0 ? <StatusDot tone="warning" /> : null}
            <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </>
        )}
      </Menu.Trigger>
      <Menu.Content className="min-w-60">
        <Menu.RadioGroup value={scopeValue} onValueChange={(value) => onScopeChange(String(value))}>
          <Menu.RadioItem value="personal">
            <Avatar name="Personal workspace" shape="square" size="xs" />
            Personal workspace
          </Menu.RadioItem>
          {orgs.length > 0 ? <Menu.GroupLabel>Organizations</Menu.GroupLabel> : null}
          {orgs.map((org) => (
            <Menu.RadioItem key={org.id} value={org.id}>
              <Avatar name={org.name} shape="square" size="xs" />
              {org.name}
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
        {invites.length > 0 ? (
          <>
            <Menu.Separator />
            <Menu.GroupLabel>Pending invitations</Menu.GroupLabel>
            {invites.map((invite) => (
              <Menu.Item key={invite.id} onClick={onReviewInvite}>
                <Avatar name={invite.org_name || 'Organization'} shape="square" size="xs" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{invite.org_name || 'Organization'}</span>
                  <Menu.Description>Review and accept</Menu.Description>
                </span>
              </Menu.Item>
            ))}
          </>
        ) : null}
      </Menu.Content>
    </Menu>
  );
}
