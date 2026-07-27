'use client';

import {
  Button,
  Card,
  Chip,
  Label,
  ListBox,
  Modal,
  Select,
  Switch,
  Table,
  TextArea,
  useOverlayState,
} from '@heroui/react';
import { Delete01Icon, GitBranchIcon, PencilEdit01Icon, PlayIcon, PlusSignIcon } from 'hugeicons-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { PageContainer, PageTitle } from '@/components/ui/page-header';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  createGitRepository,
  deleteGitRepository,
  listGitRepositories,
  runGitRepository,
  updateGitRepository,
  type GitRepository,
  type GitRepositoryInput,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { timeAgo } from '@/lib/time';

type Draft = Required<
  Pick<
    GitRepositoryInput,
    | 'name'
    | 'clone_url'
    | 'ref'
    | 'auth_type'
    | 'username'
    | 'schedule'
    | 'timezone'
    | 'enabled'
    | 'rescan_policy'
    | 'discovery_mode'
  >
> & { credential: string; entrypoints: string };
const initialDraft: Draft = {
  name: '',
  clone_url: '',
  ref: 'HEAD',
  auth_type: 'token',
  username: '',
  credential: '',
  schedule: '0 2 * * *',
  timezone: 'UTC',
  enabled: false,
  rescan_policy: 'changed',
  discovery_mode: 'auto',
  entrypoints: '',
};

export default function GitRepositoriesPage() {
  const [repositories, setRepositories] = useState<GitRepository[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [saving, setSaving] = useState(false);
  const [editingRepository, setEditingRepository] = useState<GitRepository | null>(null);
  const overlay = useOverlayState();
  const workScope = useWorkScope();
  const workspaceScope = workScope.kind === 'org' ? workScope.orgId : 'personal';
  const { success, error: showError } = useToast();
  const { confirm, dialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRepositories(await listGitRepositories(workspaceScope));
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Could not load Git repositories.');
    } finally {
      setLoading(false);
    }
  }, [showError, workspaceScope]);
  useEffect(
    () =>
      deferEffect(() => {
        void load();
      }),
    [load]
  );

  async function save() {
    setSaving(true);
    try {
      const input: GitRepositoryInput = {
        ...draft,
        entrypoints: draft.entrypoints.split('\n').map((value) => value.trim()).filter(Boolean),
      };
      if (editingRepository) {
        await updateGitRepository(editingRepository.id, input);
      } else {
        await createGitRepository({
          ...input,
          ...(workScope.kind === 'org' ? { org_id: workScope.orgId } : {}),
        });
      }
      overlay.close();
      setDraft(initialDraft);
      setEditingRepository(null);
      await load();
      success(editingRepository ? 'Git repository updated.' : 'Git repository connected. You can run it now or enable its schedule.');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Could not save Git repository.');
    } finally {
      setSaving(false);
    }
  }
  function connect() {
    setEditingRepository(null);
    setDraft(initialDraft);
    overlay.open();
  }
  function edit(repository: GitRepository) {
    setEditingRepository(repository);
    setDraft({
      name: repository.name,
      clone_url: repository.clone_url,
      ref: repository.ref,
      auth_type: repository.auth_type,
      username: repository.username,
      credential: '',
      schedule: repository.schedule,
      timezone: repository.timezone,
      enabled: repository.enabled,
      rescan_policy: repository.rescan_policy,
      discovery_mode: repository.discovery_mode ?? 'auto',
      entrypoints: repository.entrypoints?.join('\n') ?? '',
    });
    overlay.open();
  }
  async function run(
    repository: GitRepository,
    policy: 'changed' | 'all' = repository.rescan_policy
  ) {
    try {
      await runGitRepository(repository.id, { policy });
      success(`${repository.name} scan queued.`);
      await load();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Could not queue repository scan.');
    }
  }
  async function remove(repository: GitRepository) {
    const confirmed = await confirm({
      title: 'Delete Git repository?',
      message: `This removes ${repository.name} and its schedule. Existing image scans stay available.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteGitRepository(repository.id);
      await load();
      success('Git repository deleted.');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Could not delete Git repository.');
    }
  }

  return (
    <PageContainer>
      <PageTitle
        title="Git repositories"
        icon={<GitBranchIcon />}
        description="Discover images declared in GitOps repositories, then scan them now or on a schedule."
        actions={
          <Button onPress={connect}>
            <PlusSignIcon size={16} /> Connect repository
          </Button>
        }
      />
      {loading ? (
        <Card>
          <Card.Content className="py-12 text-sm text-foreground/60">
            Loading Git repositories…
          </Card.Content>
        </Card>
      ) : repositories.length === 0 ? (
        <EmptyState
          icon={<GitBranchIcon />}
          title="No Git repositories connected"
          description="Connect a GitOps repository to discover its declared container images."
          action={{ label: 'Connect repository', onClick: connect }}
        />
      ) : (
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="Git repositories">
              <Table.Header>
                <Table.Column>Repository</Table.Column>
                <Table.Column>Ref</Table.Column>
                <Table.Column>Schedule</Table.Column>
                <Table.Column>Last run</Table.Column>
                <Table.Column>Actions</Table.Column>
              </Table.Header>
              <Table.Body>
                {repositories.map((repository) => (
                  <Table.Row key={repository.id}>
                    <Table.Cell>
                      <div className="space-y-1">
                        <Link className="font-medium text-foreground hover:text-accent" href={`/git-repositories/${repository.id}`}>
                          {repository.name}
                        </Link>
                        <p className="max-w-sm truncate text-xs text-foreground/60">
                          {repository.clone_url}
                        </p>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <code className="text-xs">{repository.ref}</code>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip
                        color={repository.enabled ? 'success' : 'default'}
                        size="sm"
                        variant="soft"
                      >
                        {repository.enabled ? repository.schedule : 'Manual'}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      {repository.last_run_at ? timeAgo(repository.last_run_at) : 'Never'}
                    </Table.Cell>
                    <Table.Cell>
                      <RowActionsMenu
                        label={`Actions for ${repository.name}`}
                        items={[
                          {
                            id: 'run',
                            label: 'Run scan',
                            icon: <PlayIcon size={15} />,
                            onAction: () => void run(repository),
                          },
                          {
                            id: 'full',
                            label: 'Full rescan',
                            icon: <PlayIcon size={15} />,
                            onAction: () => void run(repository, 'all'),
                          },
                          {
                            id: 'edit',
                            label: 'Edit settings',
                            icon: <PencilEdit01Icon size={15} />,
                            onAction: () => edit(repository),
                          },
                          {
                            id: 'delete',
                            label: 'Delete',
                            icon: <Delete01Icon size={15} />,
                            variant: 'danger',
                            onAction: () => void remove(repository),
                          },
                        ]}
                      />
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      )}
      {dialog}
      <Modal>
        <Modal.Backdrop isOpen={overlay.isOpen} onOpenChange={overlay.setOpen}>
          <Modal.Container size="lg">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>{editingRepository ? 'Edit Git repository' : 'Connect Git repository'}</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="grid gap-4">
                <FormField
                  label="Name"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Platform GitOps"
                />
                <FormField
                  label="HTTPS clone URL"
                  required
                  value={draft.clone_url}
                  onChange={(event) => setDraft({ ...draft, clone_url: event.target.value })}
                  placeholder="https://git.example.com/group/repository.git"
                />
                <FormField
                  label="Branch or tag"
                  value={draft.ref}
                  onChange={(event) => setDraft({ ...draft, ref: event.target.value })}
                />
                <Select
                  aria-label="Discovery method"
                  value={draft.discovery_mode}
                  onChange={(value) =>
                    setDraft({ ...draft, discovery_mode: String(value) as Draft['discovery_mode'] })
                  }
                  variant="secondary"
                >
                  <Label>Discovery method</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="auto">Auto — rendered Kustomize, otherwise manifests</ListBox.Item>
                      <ListBox.Item id="kustomize">Kustomize entrypoints</ListBox.Item>
                      <ListBox.Item id="manifests">Plain Kubernetes manifests</ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
                {draft.discovery_mode === 'kustomize' ? (
                  <div className="grid gap-2">
                    <Label htmlFor="kustomize-entrypoints">Kustomize entrypoints</Label>
                    <TextArea
                      id="kustomize-entrypoints"
                      value={draft.entrypoints}
                      onChange={(event) => setDraft({ ...draft, entrypoints: event.target.value })}
                      placeholder={'envs/demo/dev/qdrant\nenvs/demo/dev/n8n'}
                      rows={3}
                      variant="secondary"
                    />
                    <p className="text-xs text-foreground/60">One relative repository path per line.</p>
                  </div>
                ) : null}
                <Select
                  aria-label="Authentication"
                  value={draft.auth_type}
                  onChange={(value) =>
                    setDraft({ ...draft, auth_type: String(value) as Draft['auth_type'] })
                  }
                  variant="secondary"
                >
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="none">No authentication</ListBox.Item>
                      <ListBox.Item id="token">Access token</ListBox.Item>
                      <ListBox.Item id="basic">Username and password</ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
                {draft.auth_type !== 'none' ? (
                  <>
                    <FormField
                      label="Username"
                      autoComplete="off"
                      name="git-connector-username"
                      required
                      value={draft.username}
                      onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                      description="Use the Git provider’s token username when required."
                    />
                    <FormField
                      label="Token or password"
                      autoComplete="new-password"
                      description={
                        draft.credential
                          ? `${draft.credential.length} characters entered.`
                          : editingRepository
                            ? 'Leave blank to keep the currently stored credential.'
                            : 'Required. The credential is encrypted before it is stored.'
                      }
                      name="git-connector-credential"
                      required={!editingRepository}
                      type="password"
                      value={draft.credential}
                      onChange={(event) => setDraft({ ...draft, credential: event.target.value })}
                    />
                  </>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    label="Cron schedule"
                    value={draft.schedule}
                    onChange={(event) => setDraft({ ...draft, schedule: event.target.value })}
                  />
                  <FormField
                    label="Timezone"
                    value={draft.timezone}
                    onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
                  />
                </div>
                <Select
                  aria-label="Scheduled scan policy"
                  value={draft.rescan_policy}
                  onChange={(value) =>
                    setDraft({ ...draft, rescan_policy: String(value) as Draft['rescan_policy'] })
                  }
                  variant="secondary"
                >
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="changed">Changed images only</ListBox.Item>
                      <ListBox.Item id="all">All discovered images</ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
                <Switch
                  isSelected={draft.enabled}
                  onChange={(enabled) => setDraft({ ...draft, enabled })}
                >
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    <Label>Enable scheduled scans</Label>
                  </Switch.Content>
                </Switch>
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="tertiary">
                  Cancel
                </Button>
                <Button isPending={saving} onPress={() => void save()}>
                  {editingRepository ? 'Save changes' : 'Connect repository'}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </PageContainer>
  );
}
