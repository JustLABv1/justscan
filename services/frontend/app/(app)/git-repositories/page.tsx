'use client';

import {
  Button,
  Card,
  Chip,
  Description,
  Label,
  ListBox,
  Modal,
  Select,
  Switch,
  Table,
  TextArea,
  useOverlayState,
} from '@heroui/react';
import {
  Delete01Icon,
  GitBranchIcon,
  PencilEdit01Icon,
  PlayIcon,
  PlusSignIcon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { LoadableCollectionState } from '@/components/ui/loadable-collection-state';
import { PageContainer, PageTitle } from '@/components/ui/page-header';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  createGitRepository,
  deleteGitRepository,
  listGitRepositories,
  listRegistries,
  runGitRepository,
  updateGitRepository,
  type GitRepository,
  type GitRepositoryDiscoveryMode,
  type GitRepositoryInput,
  type Registry,
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
> & {
  credential: string;
  entrypoints: string;
  discovery_registry_id: string;
  discovery_registry: string;
  registry_source: string;
};
const CUSTOM_REGISTRY_VALUE = '__custom_registry__';
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
  discovery_registry_id: '',
  discovery_registry: '',
  registry_source: '',
};

export default function GitRepositoriesPage() {
  const [repositories, setRepositories] = useState<GitRepository[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [registries, setRegistries] = useState<Registry[]>([]);
  const [registriesLoading, setRegistriesLoading] = useState(false);
  const [registryLoadError, setRegistryLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [editingRepository, setEditingRepository] = useState<GitRepository | null>(null);
  const overlay = useOverlayState();
  const workScope = useWorkScope();
  const workspaceScope = workScope.kind === 'org' ? workScope.orgId : 'personal';
  const { success, error: showError } = useToast();
  const { confirm, dialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setRegistriesLoading(true);
    setRegistryLoadError('');
    try {
      const [repositoryResult, registryResult] = await Promise.allSettled([
        listGitRepositories(workspaceScope),
        listRegistries(),
      ]);
      if (repositoryResult.status === 'rejected') throw repositoryResult.reason;
      setRepositories(repositoryResult.value);
      if (registryResult.status === 'fulfilled') {
        setRegistries(registryResult.value);
      } else {
        setRegistries([]);
        setRegistryLoadError(
          registryResult.reason instanceof Error
            ? registryResult.reason.message
            : 'Could not load configured registries.'
        );
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load Git repositories.');
    } finally {
      setLoading(false);
      setRegistriesLoading(false);
    }
  }, [workspaceScope]);
  useEffect(
    () =>
      deferEffect(() => {
        void load();
      }),
    [load]
  );

  async function save() {
    if (saving) return;
    if (draft.discovery_mode === 'registry') {
      if (draft.registry_source === CUSTOM_REGISTRY_VALUE) {
        if (!draft.discovery_registry.trim()) {
          showError('Enter a custom registry host or path.');
          return;
        }
      } else if (draft.registry_source) {
        if (!registries.some((registry) => registry.id === draft.registry_source)) {
          showError(
            'That configured registry is no longer available in this workspace. Select another registry or use a custom host or path.'
          );
          return;
        }
      } else {
        showError('Select a configured registry or enter a custom registry host or path.');
        return;
      }
    }
    setSaving(true);
    try {
      const usesEntrypoints =
        draft.discovery_mode === 'kustomize' || draft.discovery_mode === 'gitlab_ci';
      const usesRegistry = draft.discovery_mode === 'registry';
      const input: GitRepositoryInput = {
        name: draft.name,
        clone_url: draft.clone_url,
        ref: draft.ref,
        auth_type: draft.auth_type,
        username: draft.username,
        credential: draft.credential,
        schedule: draft.schedule,
        timezone: draft.timezone,
        enabled: draft.enabled,
        rescan_policy: draft.rescan_policy,
        discovery_mode: draft.discovery_mode,
        entrypoints: usesEntrypoints
          ? draft.entrypoints
              .split('\n')
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
        discovery_registry_id:
          usesRegistry && draft.registry_source && draft.registry_source !== CUSTOM_REGISTRY_VALUE
            ? draft.registry_source
            : null,
        discovery_registry:
          usesRegistry && draft.registry_source === CUSTOM_REGISTRY_VALUE
            ? draft.discovery_registry.trim()
            : '',
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
      success(
        editingRepository
          ? 'Git repository updated.'
          : 'Git repository connected. You can run it now or enable its schedule.'
      );
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
      discovery_registry_id: repository.discovery_registry_id ?? '',
      discovery_registry: repository.discovery_registry ?? '',
      registry_source:
        repository.discovery_registry_id ??
        (repository.discovery_registry ? CUSTOM_REGISTRY_VALUE : ''),
    });
    overlay.open();
  }

  function updateDiscoveryMode(value: string) {
    const nextMode = value as GitRepositoryDiscoveryMode;
    setDraft((current) => ({
      ...current,
      discovery_mode: nextMode,
      // Keep only fields that apply to the selected mode so switching modes
      // cannot submit stale CI paths or registry settings.
      entrypoints: nextMode === 'kustomize' || nextMode === 'gitlab_ci' ? current.entrypoints : '',
      discovery_registry_id: nextMode === 'registry' ? current.discovery_registry_id : '',
      discovery_registry: nextMode === 'registry' ? current.discovery_registry : '',
      registry_source: nextMode === 'registry' ? current.registry_source : '',
    }));
  }
  async function run(
    repository: GitRepository,
    policy: 'changed' | 'all' = repository.rescan_policy
  ) {
    const actionKey = `run:${repository.id}:${policy}`;
    if (pendingAction) return;
    setPendingAction(actionKey);
    try {
      await runGitRepository(repository.id, { policy });
      success(`${repository.name} scan queued.`);
      await load();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Could not queue repository scan.');
    } finally {
      setPendingAction(null);
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
    if (pendingAction) return;
    setPendingAction(`delete:${repository.id}`);
    try {
      await deleteGitRepository(repository.id);
      await load();
      success('Git repository deleted.');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Could not delete Git repository.');
    } finally {
      setPendingAction(null);
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
      <LoadableCollectionState
        emptyState={
          <EmptyState
            icon={<GitBranchIcon />}
            title="No Git repositories connected"
            description="Connect a GitOps repository to discover its declared container images."
            action={{ label: 'Connect repository', onClick: connect }}
          />
        }
        error={loadError || undefined}
        errorTitle="Git repositories failed to load"
        isEmpty={repositories.length === 0}
        loading={loading}
        loadingFallback={
          <Card>
            <Card.Content className="py-12 text-sm text-foreground/60" role="status">
              Loading Git repositories…
            </Card.Content>
          </Card>
        }
        retry={() => void load()}
      >
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="Git repositories" className="md:min-w-[720px]">
              <Table.Header>
                <Table.Column>Repository</Table.Column>
                <Table.Column className="hidden md:table-cell">Ref</Table.Column>
                <Table.Column className="hidden md:table-cell">Schedule</Table.Column>
                <Table.Column className="hidden md:table-cell">Last run</Table.Column>
                <Table.Column>Actions</Table.Column>
              </Table.Header>
              <Table.Body>
                {repositories.map((repository) => (
                  <Table.Row key={repository.id}>
                    <Table.Cell>
                      <div className="space-y-1">
                        <Link
                          className="font-medium text-foreground hover:text-accent"
                          href={`/git-repositories/${repository.id}`}
                        >
                          {repository.name}
                        </Link>
                        <p className="max-w-sm truncate text-xs text-foreground/60">
                          {repository.clone_url}
                        </p>
                        <div className="flex flex-wrap gap-x-2 text-xs text-foreground/60 md:hidden">
                          <span>{repository.ref}</span>
                          <span aria-hidden="true">·</span>
                          <span>{repository.enabled ? repository.schedule : 'Manual'}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {repository.last_run_at ? timeAgo(repository.last_run_at) : 'Never'}
                          </span>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell className="hidden md:table-cell">
                      <code className="text-xs">{repository.ref}</code>
                    </Table.Cell>
                    <Table.Cell className="hidden md:table-cell">
                      <Chip
                        color={repository.enabled ? 'success' : 'default'}
                        size="sm"
                        variant="soft"
                      >
                        {repository.enabled ? repository.schedule : 'Manual'}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell className="hidden md:table-cell">
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
                            pending: pendingAction === `run:${repository.id}:changed`,
                            disabled:
                              pendingAction !== null &&
                              pendingAction !== `run:${repository.id}:changed`,
                            onAction: () => void run(repository),
                          },
                          {
                            id: 'full',
                            label: 'Full rescan',
                            icon: <PlayIcon size={15} />,
                            pending: pendingAction === `run:${repository.id}:all`,
                            disabled:
                              pendingAction !== null &&
                              pendingAction !== `run:${repository.id}:all`,
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
                            pending: pendingAction === `delete:${repository.id}`,
                            disabled:
                              pendingAction !== null && pendingAction !== `delete:${repository.id}`,
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
      </LoadableCollectionState>
      {dialog}
      <Modal>
        <Modal.Backdrop isOpen={overlay.isOpen} onOpenChange={overlay.setOpen}>
          <Modal.Container size="lg">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>
                  {editingRepository ? 'Edit Git repository' : 'Connect Git repository'}
                </Modal.Heading>
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
                  onChange={(value) => updateDiscoveryMode(String(value))}
                  variant="secondary"
                >
                  <Label>Discovery method</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="auto">
                        Auto — rendered Kustomize, otherwise manifests
                      </ListBox.Item>
                      <ListBox.Item id="kustomize">Kustomize entrypoints</ListBox.Item>
                      <ListBox.Item id="manifests">Plain Kubernetes manifests</ListBox.Item>
                      <ListBox.Item id="registry">Registry references</ListBox.Item>
                      <ListBox.Item id="gitlab_ci">GitLab CI configuration</ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                  <Description>
                    {draft.discovery_mode === 'gitlab_ci'
                      ? 'Discover image and service declarations from GitLab CI YAML. Paths are optional and default to CI config files in the repository.'
                      : draft.discovery_mode === 'registry'
                        ? 'Find concrete image references under one configured registry or a custom host/path. Registry discovery does not need CI or manifest paths.'
                        : draft.discovery_mode === 'kustomize'
                          ? 'Render only the Kustomize entrypoints listed below.'
                          : draft.discovery_mode === 'manifests'
                            ? 'Read image declarations from plain Kubernetes manifests.'
                            : 'Render detected Kustomize roots, then fall back to plain manifests.'}
                  </Description>
                </Select>
                {draft.discovery_mode === 'registry' ? (
                  <div className="grid gap-3 rounded-xl border border-divider/70 bg-surface-secondary p-3">
                    <Select
                      aria-label="Registry reference source"
                      className="w-full"
                      value={draft.registry_source || null}
                      onChange={(value) => {
                        const selection = String(value ?? '');
                        setDraft((current) => ({
                          ...current,
                          registry_source: selection,
                          discovery_registry_id:
                            selection && selection !== CUSTOM_REGISTRY_VALUE ? selection : '',
                          discovery_registry:
                            selection === CUSTOM_REGISTRY_VALUE ? current.discovery_registry : '',
                        }));
                      }}
                      variant="secondary"
                    >
                      <Label>Registry reference source</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {draft.discovery_registry_id &&
                          !registries.some(
                            (registry) => registry.id === draft.discovery_registry_id
                          ) ? (
                            <ListBox.Item
                              id={draft.discovery_registry_id}
                              isDisabled
                              textValue="Unavailable configured registry"
                            >
                              <div className="flex min-w-0 flex-col items-start gap-0.5">
                                <Label>Unavailable configured registry</Label>
                                <Description className="!block">
                                  This registry is no longer accessible in the current workspace.
                                </Description>
                              </div>
                            </ListBox.Item>
                          ) : null}
                          {registries.map((registry) => (
                            <ListBox.Item
                              id={registry.id}
                              key={registry.id}
                              textValue={`${registry.name} ${registry.url}`}
                            >
                              <div className="flex min-w-0 flex-col items-start gap-0.5">
                                <Label>{registry.name}</Label>
                                <Description className="!block break-all">
                                  {registry.url} ·{' '}
                                  {registry.scan_provider === 'artifactory_xray' ? 'Xray' : 'Trivy'}
                                </Description>
                              </div>
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                          <ListBox.Item
                            id={CUSTOM_REGISTRY_VALUE}
                            textValue="Custom registry host or path"
                          >
                            <div className="flex min-w-0 flex-col items-start gap-0.5">
                              <Label>Custom registry host or path</Label>
                              <Description className="!block">
                                Enter a registry host or path prefix manually.
                              </Description>
                            </div>
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                      <Description>
                        {registryLoadError
                          ? 'Configured registries could not be loaded. You can still use a custom host or path.'
                          : registriesLoading
                            ? 'Loading registries available in this workspace…'
                            : 'Choose a registry configured for this workspace, or use a custom host/path when the reference is not backed by a saved credential.'}
                      </Description>
                    </Select>
                    {draft.registry_source === CUSTOM_REGISTRY_VALUE ? (
                      <FormField
                        id="discovery-registry"
                        label="Custom registry host or path"
                        required
                        value={draft.discovery_registry}
                        onChange={(event) =>
                          setDraft({ ...draft, discovery_registry: event.target.value })
                        }
                        placeholder="registry.example.com/team"
                        description="Use the host or path prefix exactly as it appears in image references."
                      />
                    ) : null}
                  </div>
                ) : null}
                {draft.discovery_mode === 'kustomize' || draft.discovery_mode === 'gitlab_ci' ? (
                  <div className="grid gap-2">
                    <Label htmlFor="discovery-entrypoints">
                      {draft.discovery_mode === 'gitlab_ci'
                        ? 'GitLab CI config paths'
                        : 'Kustomize entrypoints'}
                    </Label>
                    <TextArea
                      id="discovery-entrypoints"
                      value={draft.entrypoints}
                      onChange={(event) => setDraft({ ...draft, entrypoints: event.target.value })}
                      placeholder={
                        draft.discovery_mode === 'gitlab_ci'
                          ? '.gitlab-ci.yml\nci/release.yml'
                          : 'envs/demo/dev/qdrant\nenvs/demo/dev/n8n'
                      }
                      rows={3}
                      variant="secondary"
                    />
                    <p className="text-xs text-foreground/60">
                      {draft.discovery_mode === 'gitlab_ci'
                        ? 'Optional. Leave blank to inspect GitLab CI config files in the repository; otherwise use one relative path or glob per line.'
                        : 'One relative repository path per line.'}
                    </p>
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
