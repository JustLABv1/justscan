'use client';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { OwnershipTransfer } from '@/components/ownership-transfer';
import { useToast } from '@/components/toast';
import { OwnershipBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusAlert } from '@/components/ui/form-alert';
import {
  fieldLabelClassName,
  heroFieldClassName,
  heroSelectTriggerClassName,
  heroTextAreaClassName,
} from '@/components/ui/form-styles';
import { PageHeader } from '@/components/ui/page-header';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { useOrgDirectory } from '@/hooks/use-org-name-map';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  checkStatusPageSlugAvailability,
  createStatusPage,
  deleteStatusPage,
  getGitRepositoryRun,
  getStatusPage,
  getTokenType,
  getUser,
  getWorkScope,
  GitRepository,
  GitRepositoryRunImage,
  listGitRepositories,
  listGitRepositoryRuns,
  listStatusPages,
  listStatusPageShares,
  listStatusPageTargetOptions,
  ResourceShare,
  shareStatusPage,
  StatusPage,
  StatusPagePayload,
  StatusPageTarget,
  StatusPageTargetOption,
  transferStatusPageOwnership,
  unshareStatusPage,
  updateStatusPage,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { canManageOrg, canMutateOrg } from '@/lib/org-permissions';
import { timeAgo } from '@/lib/time';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Chip,
  Description,
  Input,
  Label,
  ListBox,
  Modal,
  Radio,
  RadioGroup,
  SearchField,
  Select,
  Spinner,
  Table,
  TextArea,
  useOverlayState,
} from '@heroui/react';
import {
  Delete01Icon,
  EyeIcon,
  PencilEdit01Icon,
  PlusSignIcon,
  Shield01Icon,
  Tick02Icon,
} from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

const fieldCls = heroFieldClassName;
const textareaCls = heroTextAreaClassName;
const selectTriggerCls = heroSelectTriggerClassName;
const fieldLabelCls = fieldLabelClassName;

const visibilityOptions = [
  {
    id: 'private',
    label: 'Private',
    description: 'Only the page owner and members of its organization can view it.',
  },
  {
    id: 'authenticated',
    label: 'Authenticated',
    description: 'Any signed-in JustScan user can view it.',
  },
  {
    id: 'public',
    label: 'Public',
    description: 'Anyone with the link can view it without signing in.',
  },
] as const satisfies ReadonlyArray<{
  id: StatusPage['visibility'];
  label: string;
  description: string;
}>;
const updateLevelOptions = ['info', 'maintenance', 'incident'] as const;
const statusPageSteps = ['Details', 'Sources', 'Configure', 'Review'] as const;
type TrackingMode = 'git' | 'images' | 'mixed';
type ImageScopeMode = 'all' | 'exact' | 'pattern';
type DetailsErrors = Partial<Record<'name' | 'slug' | 'staleAfterHours', string>>;
const exactSelectionBadgeStyle = {
  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
  border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)',
  color: 'color-mix(in srgb, var(--accent) 62%, white)',
};

type ParsedImagePattern = {
  pattern: string;
  regex: RegExp | null;
  error: string;
};

function splitImagePatterns(value: string) {
  const seen = new Set<string>();
  return value
    .split(/\r?\n/)
    .map((pattern) => pattern.trim())
    .filter((pattern) => {
      if (!pattern || seen.has(pattern)) {
        return false;
      }
      seen.add(pattern);
      return true;
    });
}

function matchesPattern(regex: RegExp, option: StatusPageTargetOption) {
  return regex.test(option.label) || regex.test(option.image_name) || regex.test(option.image_tag);
}

function normalizeStatusPageSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function describeScope(page: StatusPage) {
  const gitSourceCount = page.git_repository_sources?.length ?? 0;
  if (gitSourceCount > 0) {
    const gitScope = `${gitSourceCount} Git ${gitSourceCount === 1 ? 'repository' : 'repositories'}`;
    if (
      page.include_all_tags ||
      (page.image_patterns ?? []).length > 0 ||
      (page.targets ?? []).length > 0
    ) {
      return `${gitScope} + image scope`;
    }
    return gitScope;
  }
  if (page.include_all_tags) {
    return 'All image tags';
  }
  if ((page.image_patterns ?? []).length > 0) {
    return 'Exact tags + regex';
  }
  return 'Curated tags';
}

function visibilityTone(visibility: StatusPage['visibility']): 'default' | 'accent' | 'success' {
  if (visibility === 'public') return 'success';
  if (visibility === 'authenticated') return 'accent';
  return 'default';
}

export default function StatusPagesPage() {
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const { orgs, orgNamesById } = useOrgDirectory();
  const [pages, setPages] = useState<StatusPage[]>([]);
  const [targetOptions, setTargetOptions] = useState<StatusPageTargetOption[]>([]);
  const [gitRepositories, setGitRepositories] = useState<GitRepository[]>([]);
  const [selectedGitRepositoryIds, setSelectedGitRepositoryIds] = useState<string[]>([]);
  const [gitRepositoryImages, setGitRepositoryImages] = useState<
    Record<string, GitRepositoryRunImage[]>
  >({});
  const [selectedGitImageNames, setSelectedGitImageNames] = useState<Record<string, string[]>>({});
  const [gitImageSelectionEnabled, setGitImageSelectionEnabled] = useState<Record<string, boolean>>(
    {}
  );
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<StatusPage | null>(null);
  const [saving, setSaving] = useState(false);
  const [formStep, setFormStep] = useState(0);
  const [trackingMode, setTrackingMode] = useState<TrackingMode>('images');
  const [imageScopeMode, setImageScopeMode] = useState<ImageScopeMode>('exact');
  const [formError, setFormError] = useState('');
  const [detailsErrors, setDetailsErrors] = useState<DetailsErrors>({});
  const [validatingDetails, setValidatingDetails] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<StatusPage['visibility']>('private');
  const [staleAfterHours, setStaleAfterHours] = useState('72');
  const [selectedTargetKeys, setSelectedTargetKeys] = useState<Set<string>>(new Set());
  const [targetQuery, setTargetQuery] = useState('');
  const [gitRepositoryQuery, setGitRepositoryQuery] = useState('');
  const [imagePatternText, setImagePatternText] = useState('');
  const [updateTitle, setUpdateTitle] = useState('');
  const [updateBody, setUpdateBody] = useState('');
  const [updateLevel, setUpdateLevel] = useState<(typeof updateLevelOptions)[number]>('info');
  const [shareTarget, setShareTarget] = useState<StatusPage | null>(null);
  const [shares, setShares] = useState<ResourceShare[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | StatusPage['visibility']>('all');
  const [shareOrgId, setShareOrgId] = useState('');
  const [transferOrgId, setTransferOrgId] = useState('');
  const [shareError, setShareError] = useState('');
  const [shareSaving, setShareSaving] = useState(false);
  const [sharesLoading, setSharesLoading] = useState(false);
  const modal = useOverlayState();
  const shareModal = useOverlayState();
  const toast = useToast();
  const { confirm, dialog } = useConfirmDialog();
  const isPlatformAdmin = getTokenType() === 'admin';
  const currentUserId = getUser()?.id as string | undefined;
  const orgRoleById = useMemo(
    () => new Map(orgs.map((org) => [org.id, org.current_user_role] as const)),
    [orgs]
  );
  const canMutateActiveScope =
    isPlatformAdmin || workScope.kind !== 'org' || canMutateOrg(orgRoleById.get(workScope.orgId));
  const manageableOrgIds = new Set(
    orgs.filter((org) => canManageOrg(org.current_user_role)).map((org) => org.id)
  );
  const filteredPages = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return pages.filter((page) => {
      const visibilityMatches = visibilityFilter === 'all' || page.visibility === visibilityFilter;
      if (!visibilityMatches) return false;
      if (!query) return true;
      return [page.name, page.description, page.slug]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [pages, searchQuery, visibilityFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPages(await listStatusPages());
      setError('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load status pages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    return deferEffect(load);
  }, [load, scopeKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      setLoadingOptions(true);
      try {
        const options = await listStatusPageTargetOptions();
        if (!cancelled) {
          setTargetOptions(options);
        }
      } catch {
        if (!cancelled) {
          setTargetOptions([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingOptions(false);
        }
      }
    }

    loadOptions();
    return () => {
      cancelled = true;
    };
  }, [scopeKey]);

  useEffect(() => {
    let cancelled = false;
    const repositoryIds = selectedGitRepositoryIds;
    if (repositoryIds.length === 0) {
      return;
    }

    void Promise.all(
      repositoryIds.map(async (repositoryId) => {
        const runs = await listGitRepositoryRuns(repositoryId);
        const latestSnapshot = runs.find(
          (run) => run.status === 'completed' || run.status === 'partial'
        );
        if (!latestSnapshot) return [repositoryId, []] as const;
        const result = await getGitRepositoryRun(repositoryId, latestSnapshot.id);
        return [repositoryId, result.images.filter((image) => image.state !== 'excluded')] as const;
      })
    )
      .then((entries) => {
        if (!cancelled) setGitRepositoryImages(Object.fromEntries(entries));
      })
      .catch(() => {
        if (!cancelled) setGitRepositoryImages({});
      });

    return () => {
      cancelled = true;
    };
  }, [selectedGitRepositoryIds]);

  useEffect(() => {
    let cancelled = false;
    void listGitRepositories()
      .then((repositories) => {
        if (!cancelled) setGitRepositories(repositories);
      })
      .catch(() => {
        if (!cancelled) setGitRepositories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [scopeKey]);

  const selectedTargets = useMemo(() => {
    const keys = Array.from(selectedTargetKeys).map(String);
    return keys
      .map((key, index) => {
        const option = targetOptions.find((candidate) => candidate.id === key);
        if (!option) return null;
        return {
          image_name: option.image_name,
          image_tag: option.image_tag,
          display_order: index + 1,
        } satisfies StatusPageTarget;
      })
      .filter((target): target is StatusPageTarget => Boolean(target));
  }, [selectedTargetKeys, targetOptions]);

  const parsedImagePatterns = useMemo<ParsedImagePattern[]>(() => {
    return splitImagePatterns(imagePatternText).map((pattern) => {
      try {
        return {
          pattern,
          regex: new RegExp(pattern),
          error: '',
        };
      } catch (error) {
        return {
          pattern,
          regex: null,
          error: error instanceof Error ? error.message : 'Invalid regex pattern',
        };
      }
    });
  }, [imagePatternText]);

  const imagePatterns = useMemo(
    () => parsedImagePatterns.filter((pattern) => !pattern.error).map((pattern) => pattern.pattern),
    [parsedImagePatterns]
  );

  const invalidImagePatterns = useMemo(
    () => parsedImagePatterns.filter((pattern) => Boolean(pattern.error)),
    [parsedImagePatterns]
  );

  const filteredTargetOptions = useMemo(() => {
    const query = targetQuery.trim().toLowerCase();
    if (!query) {
      return targetOptions;
    }
    return targetOptions.filter(
      (option) =>
        option.label.toLowerCase().includes(query) ||
        option.image_name.toLowerCase().includes(query) ||
        option.image_tag.toLowerCase().includes(query) ||
        option.latest_status.toLowerCase().includes(query)
    );
  }, [targetOptions, targetQuery]);

  const regexMatchedOptions = useMemo(() => {
    const regexes = parsedImagePatterns.flatMap((pattern) =>
      pattern.regex ? [pattern.regex] : []
    );
    if (imageScopeMode === 'all' || regexes.length === 0) {
      return [];
    }

    return targetOptions.filter((option) => {
      if (selectedTargetKeys.has(option.id)) {
        return false;
      }
      return regexes.some((regex) => matchesPattern(regex, option));
    });
  }, [imageScopeMode, parsedImagePatterns, selectedTargetKeys, targetOptions]);

  const filteredGitRepositories = useMemo(() => {
    const query = gitRepositoryQuery.trim().toLowerCase();
    return gitRepositories.filter(
      (repository) =>
        !query ||
        repository.name.toLowerCase().includes(query) ||
        repository.clone_url.toLowerCase().includes(query)
    );
  }, [gitRepositories, gitRepositoryQuery]);

  const selectedGitRepositoryIdSet = useMemo(
    () => new Set(selectedGitRepositoryIds),
    [selectedGitRepositoryIds]
  );

  const includesGitSources = trackingMode === 'git' || trackingMode === 'mixed';
  const includesImageScope = trackingMode === 'images' || trackingMode === 'mixed';
  const hasIncompleteGitImageSelection = selectedGitRepositoryIds.some(
    (repositoryId) =>
      gitImageSelectionEnabled[repositoryId] &&
      (selectedGitImageNames[repositoryId] ?? []).length === 0
  );
  const scopeIsValid =
    (includesGitSources &&
      selectedGitRepositoryIds.length > 0 &&
      !hasIncompleteGitImageSelection) ||
    (includesImageScope &&
      (imageScopeMode === 'all' ||
        (imageScopeMode === 'exact' && selectedTargets.length > 0) ||
        (imageScopeMode === 'pattern' && imagePatterns.length > 0)));
  const canAdvanceStatusPageStep =
    formStep === 0
      ? !validatingDetails
      : formStep === 2
        ? scopeIsValid && invalidImagePatterns.length === 0
        : true;

  function canManageStatusPage(page: StatusPage) {
    if (isPlatformAdmin) return true;
    if (page.owner_type === 'org' && page.owner_org_id) {
      return canManageOrg(orgRoleById.get(page.owner_org_id));
    }
    return !page.owner_user_id || page.owner_user_id === currentUserId;
  }

  async function loadShares(pageId: string) {
    setSharesLoading(true);
    setShareError('');
    try {
      setShares(await listStatusPageShares(pageId));
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to load access grants');
    } finally {
      setSharesLoading(false);
    }
  }

  function openShareModal(page: StatusPage) {
    if (!canManageStatusPage(page)) return;
    setShareTarget(page);
    setShareOrgId('');
    setTransferOrgId('');
    setShareError('');
    setShares([]);
    shareModal.open();
    void loadShares(page.id);
  }

  async function handleGrantShare() {
    if (!shareTarget || !shareOrgId || !canManageStatusPage(shareTarget)) return;
    setShareSaving(true);
    setShareError('');
    try {
      await shareStatusPage(shareTarget.id, shareOrgId);
      toast.success('Status page access granted');
      setShareOrgId('');
      await loadShares(shareTarget.id);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to grant access');
    } finally {
      setShareSaving(false);
    }
  }

  async function handleRevokeShare(orgId: string) {
    if (!shareTarget || !canManageStatusPage(shareTarget)) return;
    setShareSaving(true);
    setShareError('');
    try {
      await unshareStatusPage(shareTarget.id, orgId);
      toast.success('Status page access revoked');
      await loadShares(shareTarget.id);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to revoke access');
    } finally {
      setShareSaving(false);
    }
  }

  async function handleTransferOwnership() {
    if (
      !shareTarget ||
      !transferOrgId ||
      shareTarget.owner_type !== 'org' ||
      !canManageStatusPage(shareTarget)
    )
      return;
    const destination =
      orgs.find((org) => org.id === transferOrgId)?.name ?? 'the selected organization';
    const ok = await confirm({
      title: `Transfer status page ownership to ${destination}?`,
      message:
        'The current owner will retain shared access. The status page will begin showing the destination organization’s scans and policy results.',
      confirmLabel: 'Transfer',
      variant: 'danger',
    });
    if (!ok) return;
    setShareSaving(true);
    setShareError('');
    try {
      await transferStatusPageOwnership(shareTarget.id, transferOrgId);
      toast.success('Status page ownership transferred');
      shareModal.close();
      await load();
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to transfer ownership');
    } finally {
      setShareSaving(false);
    }
  }

  const availableShareTargets = shareTarget
    ? orgs.filter(
        (org) =>
          (isPlatformAdmin || manageableOrgIds.has(org.id)) &&
          org.id !== shareTarget.owner_org_id &&
          !shares.some((share) => share.org_id === org.id)
      )
    : [];
  const transferTargets =
    shareTarget?.owner_type === 'org'
      ? orgs.filter(
          (org) =>
            (isPlatformAdmin || manageableOrgIds.has(org.id)) && org.id !== shareTarget.owner_org_id
        )
      : [];

  function resetForm() {
    setEditing(null);
    setFormStep(0);
    setTrackingMode('images');
    setImageScopeMode('exact');
    setName('');
    setSlug('');
    setDescription('');
    setVisibility('private');
    setStaleAfterHours('72');
    setSelectedTargetKeys(new Set());
    setSelectedGitRepositoryIds([]);
    setSelectedGitImageNames({});
    setGitImageSelectionEnabled({});
    setGitRepositoryQuery('');
    setTargetQuery('');
    setImagePatternText('');
    setUpdateTitle('');
    setUpdateBody('');
    setUpdateLevel('info');
    setFormError('');
    setDetailsErrors({});
    setValidatingDetails(false);
  }

  async function validateDetailsStep() {
    const nextErrors: DetailsErrors = {};
    const trimmedName = name.trim();
    const normalizedSlug = normalizeStatusPageSlug(slug || trimmedName);
    const staleHours = Number(staleAfterHours);

    if (!trimmedName) nextErrors.name = 'Enter a status page name.';
    if (!normalizedSlug) nextErrors.slug = 'Enter a slug with at least one letter or number.';
    if (!Number.isInteger(staleHours) || staleHours < 1) {
      nextErrors.staleAfterHours = 'Enter a whole number of at least 1 hour.';
    }
    if (Object.keys(nextErrors).length > 0) {
      setDetailsErrors(nextErrors);
      return false;
    }

    setValidatingDetails(true);
    try {
      const result = await checkStatusPageSlugAvailability(normalizedSlug, editing?.id);
      if (!result.available) {
        setDetailsErrors({ slug: 'This slug is already in use. Choose another one.' });
        return false;
      }
      setSlug(normalizedSlug);
      setDetailsErrors({});
      return true;
    } catch (error: unknown) {
      setDetailsErrors({
        slug: error instanceof Error ? error.message : 'Could not validate this slug. Try again.',
      });
      return false;
    } finally {
      setValidatingDetails(false);
    }
  }

  async function advanceStatusPageStep() {
    if (formStep === 0 && !(await validateDetailsStep())) return;
    if (formStep === 2 && (!scopeIsValid || invalidImagePatterns.length > 0)) return;
    setFormStep((step) => step + 1);
  }

  function openCreate() {
    if (!canMutateActiveScope) return;
    resetForm();
    modal.open();
  }

  async function openEdit(page: StatusPage) {
    setFormError('');
    try {
      const full = await getStatusPage(page.id);
      setEditing(full.page);
      setName(full.page.name);
      setSlug(full.page.slug);
      setDescription(full.page.description ?? '');
      setVisibility(full.page.visibility);
      const hasGitSources = (full.page.git_repository_sources?.length ?? 0) > 0;
      const hasImageScope =
        full.page.include_all_tags ||
        (full.page.targets?.length ?? 0) > 0 ||
        (full.page.image_patterns?.length ?? 0) > 0;
      setTrackingMode(hasGitSources && hasImageScope ? 'mixed' : hasGitSources ? 'git' : 'images');
      setImageScopeMode(
        full.page.include_all_tags
          ? 'all'
          : (full.page.image_patterns?.length ?? 0) > 0
            ? 'pattern'
            : 'exact'
      );
      setFormStep(0);
      setStaleAfterHours(String(full.page.stale_after_hours));
      setSelectedTargetKeys(
        new Set(
          (full.page.targets ?? []).map((target) => `${target.image_name}:${target.image_tag}`)
        )
      );
      setSelectedGitRepositoryIds(
        (full.page.git_repository_sources ?? [])
          .sort((a, b) => a.display_order - b.display_order)
          .map((source) => source.repository_id)
      );
      setSelectedGitImageNames(
        Object.fromEntries(
          (full.page.git_repository_sources ?? []).map((source) => [
            source.repository_id,
            source.image_names ?? [],
          ])
        )
      );
      setGitImageSelectionEnabled(
        Object.fromEntries(
          (full.page.git_repository_sources ?? []).map((source) => [
            source.repository_id,
            (source.image_names ?? []).length > 0,
          ])
        )
      );
      setTargetQuery('');
      setImagePatternText((full.page.image_patterns ?? []).join('\n'));
      const firstUpdate = full.page.updates?.[0];
      setUpdateTitle(firstUpdate?.title ?? '');
      setUpdateBody(firstUpdate?.body ?? '');
      setUpdateLevel(firstUpdate?.level ?? 'info');
      modal.open();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load status page');
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: 'Delete status page?',
      message: 'The page URL will stop working immediately and all manual updates will be removed.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      await deleteStatusPage(id);
      toast.success('Status page deleted');
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete status page');
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formStep !== statusPageSteps.length - 1) return;
    if (editing ? !canManageStatusPage(editing) : !canMutateActiveScope) return;
    setSaving(true);
    setFormError('');

    const trimmedUpdateTitle = updateTitle.trim();
    const trimmedUpdateBody = updateBody.trim();

    const payload: StatusPagePayload = {
      name,
      slug: slug || undefined,
      description,
      visibility,
      ...(editing
        ? {}
        : (() => {
            const currentScope = getWorkScope();
            return currentScope.kind === 'org' ? { org_id: currentScope.orgId } : {};
          })()),
      include_all_tags: includesImageScope && imageScopeMode === 'all',
      image_patterns: includesImageScope && imageScopeMode === 'pattern' ? imagePatterns : [],
      stale_after_hours: Number(staleAfterHours) || 72,
      targets: includesImageScope && imageScopeMode === 'exact' ? selectedTargets : [],
      git_repository_sources: includesGitSources
        ? selectedGitRepositoryIds.map((repository_id, index) => ({
            repository_id,
            image_names: selectedGitImageNames[repository_id] ?? [],
            display_order: index + 1,
          }))
        : [],
      updates:
        trimmedUpdateTitle || trimmedUpdateBody
          ? [{ title: trimmedUpdateTitle, body: trimmedUpdateBody, level: updateLevel }]
          : [],
    };

    try {
      if (editing) {
        await updateStatusPage(editing.id, payload);
        toast.success('Status page updated');
      } else {
        await createStatusPage(payload);
        toast.success('Status page created');
      }
      modal.close();
      resetForm();
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to save status page');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Status Pages"
        description="Publish current image-tag health internally or externally."
        actions={
          <Button onPress={openCreate} isDisabled={!canMutateActiveScope}>
            <PlusSignIcon size={15} /> New Status Page
          </Button>
        }
      />

      {error ? (
        <StatusAlert status="danger" title="Status pages failed to load" description={error} />
      ) : null}

      <div className="space-y-4">
        <Card className="p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchField
              name="status-pages-search"
              variant="secondary"
              className="w-full sm:w-[22rem]"
            >
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search name, slug, or description..."
                />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <Select
              value={visibilityFilter}
              onChange={(value) =>
                setVisibilityFilter(
                  value === 'private' || value === 'authenticated' || value === 'public'
                    ? value
                    : 'all'
                )
              }
              className="w-full sm:w-44"
              variant="secondary"
            >
              <Label className="sr-only">Visibility</Label>
              <Select.Trigger className="h-10">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="all">All visibility</ListBox.Item>
                  <ListBox.Item id="private">Private</ListBox.Item>
                  <ListBox.Item id="authenticated">Authenticated</ListBox.Item>
                  <ListBox.Item id="public">Public</ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
        </Card>

        {loading ? (
          <div className="surface-card flex justify-center rounded-3xl border border-divider/70 py-16">
            <Spinner size="lg" />
          </div>
        ) : filteredPages.length === 0 ? (
          <EmptyState
            action={
              pages.length > 0 || !canMutateActiveScope
                ? undefined
                : { label: 'Create status page', onClick: openCreate }
            }
            description={
              pages.length > 0
                ? 'No status pages match the current filters. Adjust visibility or search terms to widen the results.'
                : 'No status pages exist yet. Create one to publish current image-tag health for a curated or global set of workloads.'
            }
            eyebrow="Status pages"
            icon={<EyeIcon size={28} />}
            title={pages.length > 0 ? 'No matching pages' : 'No status pages yet'}
          />
        ) : (
          <Card className="surface-card overflow-hidden rounded-3xl border border-divider/70">
            <Card.Content className="p-0">
              <Table variant="secondary">
                <Table.ScrollContainer>
                  <Table.Content aria-label="Status pages" className="min-w-[920px]">
                    <Table.Header>
                      <Table.Column isRowHeader>Name</Table.Column>
                      <Table.Column>Visibility</Table.Column>
                      <Table.Column>Scope</Table.Column>
                      <Table.Column>Slug</Table.Column>
                      <Table.Column>Access</Table.Column>
                      <Table.Column>Updated</Table.Column>
                      <Table.Column className="text-right">Actions</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {filteredPages.map((page) => (
                        <Table.Row
                          key={page.id}
                          id={page.id}
                          className="hover:bg-[var(--row-hover)]"
                        >
                          <Table.Cell>
                            <div>
                              <p className="font-medium text-zinc-800 dark:text-zinc-100">
                                {page.name}
                              </p>
                              <p className="text-xs text-zinc-500 mt-0.5 line-clamp-1">
                                {page.description || 'No description'}
                              </p>
                            </div>
                          </Table.Cell>
                          <Table.Cell>
                            <Chip
                              className="capitalize"
                              color={visibilityTone(page.visibility)}
                              size="sm"
                              variant="soft"
                            >
                              {page.visibility}
                            </Chip>
                          </Table.Cell>
                          <Table.Cell className="text-xs text-zinc-500">
                            {describeScope(page)}
                          </Table.Cell>
                          <Table.Cell className="font-mono text-xs text-zinc-600 dark:text-zinc-300">
                            /status/{page.slug}
                          </Table.Cell>
                          <Table.Cell>
                            <div className="mt-1.5">
                              <OwnershipBadge
                                ownerType={page.owner_type}
                                ownerOrgId={page.owner_org_id}
                                orgNamesById={orgNamesById}
                              />
                            </div>
                          </Table.Cell>
                          <Table.Cell className="text-xs text-zinc-500">
                            {timeAgo(page.updated_at)}
                          </Table.Cell>
                          <Table.Cell>
                            <div className="flex justify-end">
                              <RowActionsMenu
                                label={`Open actions menu for ${page.name}`}
                                items={[
                                  {
                                    id: 'open',
                                    label: 'Open page',
                                    icon: <EyeIcon size={15} />,
                                    onAction: () => window.open(`/status/${page.slug}`, '_blank'),
                                  },
                                  ...(canManageStatusPage(page)
                                    ? [
                                        {
                                          id: 'share',
                                          label: 'Manage access',
                                          icon: <Shield01Icon size={15} />,
                                          onAction: () => openShareModal(page),
                                        },
                                        {
                                          id: 'edit',
                                          label: 'Edit status page',
                                          icon: <PencilEdit01Icon size={15} />,
                                          onAction: () => openEdit(page),
                                        },
                                        {
                                          id: 'delete',
                                          label: 'Delete status page',
                                          icon: <Delete01Icon size={15} />,
                                          variant: 'danger' as const,
                                          onAction: () => {
                                            void handleDelete(page.id);
                                          },
                                        },
                                      ]
                                    : []),
                                ]}
                              />
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            </Card.Content>
          </Card>
        )}
      </div>

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="lg" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">
                  {editing ? 'Edit Status Page' : 'Create Status Page'}
                </Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>

              <Modal.Body className="min-h-0 overflow-y-auto overscroll-contain py-6">
                <form id="status-page-form" onSubmit={handleSubmit} className="space-y-6">
                  {formError && (
                    <Alert status="danger">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>{formError}</Alert.Title>
                      </Alert.Content>
                    </Alert>
                  )}
                  <div
                    className="space-y-4"
                    aria-label={`Step ${formStep + 1} of ${statusPageSteps.length}`}
                  >
                    <div className="text-xs">
                      <span className="font-medium text-muted">
                        Step {formStep + 1} of {statusPageSteps.length}
                      </span>
                    </div>
                    <ol className="relative grid grid-cols-4">
                      <span
                        aria-hidden
                        className="absolute left-[12.5%] right-[12.5%] top-3 h-px"
                        style={{ backgroundColor: 'var(--divider)' }}
                      />
                      <span
                        aria-hidden
                        className="absolute left-[12.5%] top-3 h-0.5"
                        style={{
                          width: `${(formStep / (statusPageSteps.length - 1)) * 75}%`,
                          backgroundColor: 'var(--accent)',
                        }}
                      />
                      {statusPageSteps.map((step, index) => (
                        <li key={step} className="relative min-w-0 text-center">
                          <span
                            className={`mx-auto flex size-6 items-center justify-center rounded-full border-2 text-xs font-semibold ${index > formStep ? 'border-default-300 bg-surface text-default-500' : ''}`}
                            style={
                              index < formStep
                                ? {
                                    borderColor: 'var(--accent)',
                                    backgroundColor: 'var(--accent)',
                                    color: 'white',
                                  }
                                : index === formStep
                                  ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
                                  : undefined
                            }
                          >
                            {index < formStep ? (
                              <Tick02Icon size={14} strokeWidth={2.5} aria-hidden />
                            ) : (
                              index + 1
                            )}
                          </span>
                          <span
                            className={`mt-1 block truncate text-[11px] ${index === formStep ? 'font-semibold text-foreground' : 'text-muted'}`}
                          >
                            {step}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  {formStep === 0 && (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                        <div className="space-y-1.5">
                          <Label className={fieldLabelCls}>Name</Label>
                          <Input
                            className={`${fieldCls} bg-surface-secondary${detailsErrors.name ? ' border-danger' : ''}`}
                            placeholder="Production Containers"
                            value={name}
                            onChange={(event) => {
                              setName(event.target.value);
                              setDetailsErrors((current) => ({ ...current, name: undefined }));
                            }}
                            aria-invalid={Boolean(detailsErrors.name)}
                            required
                          />
                          {detailsErrors.name && (
                            <p className="text-xs text-danger" role="alert">
                              {detailsErrors.name}
                            </p>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <Label className={fieldLabelCls}>Slug</Label>
                          <Input
                            className={`${fieldCls} bg-surface-secondary${detailsErrors.slug ? ' border-danger' : ''}`}
                            placeholder="production-containers"
                            value={slug}
                            onChange={(event) => {
                              setSlug(event.target.value);
                              setDetailsErrors((current) => ({ ...current, slug: undefined }));
                            }}
                            aria-invalid={Boolean(detailsErrors.slug)}
                          />
                          {detailsErrors.slug && (
                            <p className="text-xs text-danger" role="alert">
                              {detailsErrors.slug}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className={fieldLabelCls}>Description</Label>
                        <TextArea
                          className={textareaCls + ' bg-surface-secondary'}
                          placeholder="Share current security and scan freshness for externally visible workloads."
                          value={description}
                          onChange={(event) => setDescription(event.target.value)}
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                        <Select
                          value={visibility}
                          onChange={(value) =>
                            setVisibility(String(value) as StatusPage['visibility'])
                          }
                          className="w-full"
                          placeholder="Select visibility"
                        >
                          <Label className={fieldLabelCls}>Visibility</Label>
                          <Select.Trigger className={selectTriggerCls + ' bg-surface-secondary'}>
                            <Select.Value>
                              {({ defaultChildren, isPlaceholder, state }) => {
                                if (isPlaceholder || state.selectedItems.length === 0) {
                                  return defaultChildren;
                                }
                                const selectedOption = visibilityOptions.find(
                                  (option) => option.id === state.selectedItems[0]?.key
                                );
                                return selectedOption?.label ?? defaultChildren;
                              }}
                            </Select.Value>
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              {visibilityOptions.map((option) => (
                                <ListBox.Item
                                  id={option.id}
                                  key={option.id}
                                  textValue={option.label}
                                >
                                  <div className="flex min-w-0 flex-col">
                                    <Label>{option.label}</Label>
                                    <Description>{option.description}</Description>
                                  </div>
                                  <ListBox.ItemIndicator />
                                </ListBox.Item>
                              ))}
                            </ListBox>
                          </Select.Popover>
                        </Select>
                        <div className="space-y-1.5">
                          <Label className={fieldLabelCls}>Stale After Hours</Label>
                          <Input
                            className={`${fieldCls} bg-surface-secondary${detailsErrors.staleAfterHours ? ' border-danger' : ''}`}
                            value={staleAfterHours}
                            onChange={(event) => {
                              setStaleAfterHours(event.target.value);
                              setDetailsErrors((current) => ({
                                ...current,
                                staleAfterHours: undefined,
                              }));
                            }}
                            type="number"
                            min={1}
                            step={1}
                            inputMode="numeric"
                            aria-invalid={Boolean(detailsErrors.staleAfterHours)}
                          />
                          {detailsErrors.staleAfterHours && (
                            <p className="text-xs text-danger" role="alert">
                              {detailsErrors.staleAfterHours}
                            </p>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {formStep === 1 && (
                    <div className="space-y-6">
                      <div className="space-y-1.5">
                        <p className="text-base font-semibold text-foreground">
                          What should this page follow?
                        </p>
                        <p className="mt-1 text-sm text-muted">
                          Choose the source first. You’ll only see the configuration it needs next.
                        </p>
                      </div>
                      <RadioGroup
                        aria-label="Status page source type"
                        value={trackingMode}
                        onChange={(value) => setTrackingMode(String(value) as TrackingMode)}
                        variant="secondary"
                      >
                        <div className="grid gap-3 md:grid-cols-3">
                          {(
                            [
                              [
                                'git',
                                'Git repositories',
                                'Yes — follow the current images discovered in Git.',
                              ],
                              [
                                'images',
                                'Specific image scope',
                                'No — choose image tags, a pattern, or all tracked images.',
                              ],
                              [
                                'mixed',
                                'Both',
                                'Combine Git discovery with a small fixed image scope.',
                              ],
                            ] as const
                          ).map(([mode, title, detail]) => (
                            <Radio
                              key={mode}
                              value={mode}
                              className="group relative flex h-full min-h-28 min-w-0 cursor-pointer flex-col items-stretch rounded-xl border border-divider bg-surface-secondary p-4 transition-colors hover:bg-surface-hovered data-[selected=true]:border-accent data-[selected=true]:bg-accent/5"
                            >
                              <Radio.Control className="absolute right-3 top-3">
                                <Radio.Indicator />
                              </Radio.Control>
                              <Radio.Content className="flex min-w-0 flex-col items-start gap-1 pr-7">
                                <Label className="block text-sm font-semibold text-foreground">
                                  {title}
                                </Label>
                                <Description className="mt-1 block break-words text-xs leading-5 text-muted">
                                  {detail}
                                </Description>
                              </Radio.Content>
                            </Radio>
                          ))}
                        </div>
                      </RadioGroup>
                      {(trackingMode === 'images' || trackingMode === 'mixed') && (
                        <div className="space-y-4 border-t border-divider pt-6">
                          <p className="text-sm font-semibold text-foreground">
                            Do you want to manually choose every image?
                          </p>
                          <RadioGroup
                            aria-label="Image selection method"
                            value={imageScopeMode}
                            onChange={(value) => setImageScopeMode(String(value) as ImageScopeMode)}
                            variant="secondary"
                          >
                            <div className="grid gap-3 md:grid-cols-3">
                              {(
                                [
                                  ['exact', 'Yes, select tags', 'Pick individual image tags.'],
                                  ['pattern', 'No, use a pattern', 'Match tags with a regex.'],
                                  ['all', 'No, include all', 'Publish every tracked image tag.'],
                                ] as const
                              ).map(([mode, title, detail]) => (
                                <Radio
                                  key={mode}
                                  value={mode}
                                  className="group relative flex h-full min-h-24 min-w-0 cursor-pointer flex-col items-stretch rounded-xl border border-divider bg-surface-secondary p-4 transition-colors hover:bg-surface-hovered data-[selected=true]:border-accent data-[selected=true]:bg-accent/5"
                                >
                                  <Radio.Control className="absolute right-3 top-3">
                                    <Radio.Indicator />
                                  </Radio.Control>
                                  <Radio.Content className="flex min-w-0 flex-col items-start gap-1 pr-7">
                                    <Label className="block text-sm font-semibold text-foreground">
                                      {title}
                                    </Label>
                                    <Description className="mt-1 block break-words text-xs leading-5 text-muted">
                                      {detail}
                                    </Description>
                                  </Radio.Content>
                                </Radio>
                              ))}
                            </div>
                          </RadioGroup>
                        </div>
                      )}
                    </div>
                  )}

                  {formStep === 2 && includesGitSources && (
                    <section className="space-y-3" aria-labelledby="git-repository-sources-heading">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p
                            id="git-repository-sources-heading"
                            className="text-sm font-semibold text-foreground"
                          >
                            Repositories to follow
                          </p>
                          <p className="mt-1 text-xs text-muted">
                            Use the latest completed discovery from each repository.
                          </p>
                        </div>
                        <Chip
                          color={selectedGitRepositoryIds.length > 0 ? 'accent' : 'default'}
                          variant="soft"
                        >
                          {selectedGitRepositoryIds.length} selected
                        </Chip>
                      </div>

                      <SearchField className={fieldCls} variant="secondary">
                        <SearchField.Group>
                          <SearchField.SearchIcon />
                          <SearchField.Input
                            value={gitRepositoryQuery}
                            onChange={(event) => setGitRepositoryQuery(event.target.value)}
                            placeholder="Search repositories"
                          />
                          <SearchField.ClearButton />
                        </SearchField.Group>
                      </SearchField>

                      <div className="max-h-52 divide-y divide-divider overflow-y-auto rounded-xl border border-divider bg-surface">
                        {filteredGitRepositories.length === 0 ? (
                          <p className="p-4 text-sm text-muted">
                            No accessible Git repositories match this search.
                          </p>
                        ) : (
                          filteredGitRepositories.map((repository) => {
                            const selected = selectedGitRepositoryIdSet.has(repository.id);
                            const checkboxId = `git-repository-${repository.id}`;

                            return (
                              <Checkbox
                                id={checkboxId}
                                key={repository.id}
                                isSelected={selected}
                                onChange={(checked) =>
                                  setSelectedGitRepositoryIds((current) =>
                                    checked
                                      ? [...current, repository.id]
                                      : current.filter((id) => id !== repository.id)
                                  )
                                }
                                variant="secondary"
                                className="w-full gap-0 bg-surface transition-colors data-[selected=true]:bg-accent/5"
                              >
                                <Checkbox.Content className="flex w-full min-w-0 items-start justify-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hovered">
                                  <Checkbox.Control className="mt-0.5">
                                    <Checkbox.Indicator />
                                  </Checkbox.Control>
                                  <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                                    <Label
                                      htmlFor={checkboxId}
                                      className="block w-full truncate text-sm font-medium text-foreground"
                                    >
                                      {repository.name}
                                    </Label>
                                    <Description className="block w-full truncate text-xs text-muted">
                                      {repository.ref}
                                    </Description>
                                  </span>
                                </Checkbox.Content>
                              </Checkbox>
                            );
                          })
                        )}
                      </div>

                      {selectedGitRepositoryIds.map((repositoryId) => {
                        const repository = gitRepositories.find(
                          (candidate) => candidate.id === repositoryId
                        );
                        const images = Array.from(
                          new Map(
                            (gitRepositoryImages[repositoryId] ?? []).map((image) => [
                              image.image_name,
                              image,
                            ])
                          ).values()
                        );
                        const selectedImageNames = new Set(
                          selectedGitImageNames[repositoryId] ?? []
                        );
                        const isPickingImages = gitImageSelectionEnabled[repositoryId] ?? false;

                        return (
                          <Card key={repositoryId} className="space-y-3 bg-surface-secondary p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-foreground">
                                  {repository?.name ?? 'Selected repository'} images
                                </p>
                                <p className="mt-1 text-xs leading-5 text-muted">
                                  Choose whether to follow every discovered image or curate the
                                  image names this page publishes.
                                </p>
                              </div>
                              <Checkbox
                                aria-label={`Follow all images from ${repository?.name ?? 'this repository'}`}
                                isSelected={!isPickingImages}
                                onChange={(checked) => {
                                  setGitImageSelectionEnabled((current) => ({
                                    ...current,
                                    [repositoryId]: !checked,
                                  }));
                                  if (checked) {
                                    setSelectedGitImageNames((current) => ({
                                      ...current,
                                      [repositoryId]: [],
                                    }));
                                  }
                                }}
                                variant="primary"
                              >
                                <Checkbox.Content className="items-center gap-2">
                                  <Checkbox.Control>
                                    <Checkbox.Indicator />
                                  </Checkbox.Control>
                                  <span className="text-xs font-medium text-foreground">
                                    All images
                                  </span>
                                </Checkbox.Content>
                              </Checkbox>
                            </div>

                            {!isPickingImages ? (
                              <p className="text-xs text-muted">
                                Following every image from the latest completed discovery.
                              </p>
                            ) : gitRepositoryImages[repositoryId] === undefined ? (
                              <div className="flex items-center gap-2 text-xs text-muted">
                                <Spinner size="sm" /> Loading the latest discovery…
                              </div>
                            ) : images.length === 0 ? (
                              <p className="text-xs text-muted">
                                No completed discovery images are available yet. The page will
                                follow this repository once a discovery run completes.
                              </p>
                            ) : (
                              <div className="max-h-52 divide-y divide-divider overflow-y-auto rounded-xl border border-divider bg-surface">
                                {images.map((image) => {
                                  const selected = selectedImageNames.has(image.image_name);
                                  const checkboxId = `git-status-image-${repositoryId}-${image.image_name}`;
                                  return (
                                    <Checkbox
                                      id={checkboxId}
                                      key={image.image_name}
                                      isSelected={selected}
                                      onChange={(checked) =>
                                        setSelectedGitImageNames((current) => {
                                          const next = new Set(current[repositoryId] ?? []);
                                          if (checked) next.add(image.image_name);
                                          else next.delete(image.image_name);
                                          return { ...current, [repositoryId]: Array.from(next) };
                                        })
                                      }
                                      variant="secondary"
                                      className="w-full bg-surface"
                                    >
                                      <Checkbox.Content className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left hover:bg-surface-hovered">
                                        <Checkbox.Control>
                                          <Checkbox.Indicator />
                                        </Checkbox.Control>
                                        <span className="min-w-0 flex-1">
                                          <Label
                                            htmlFor={checkboxId}
                                            className="block truncate font-mono text-xs text-foreground"
                                          >
                                            {image.image_name}
                                          </Label>
                                          <Description className="mt-0.5 block text-xs text-muted">
                                            Latest tag: {image.image_tag}
                                          </Description>
                                        </span>
                                      </Checkbox.Content>
                                    </Checkbox>
                                  );
                                })}
                              </div>
                            )}
                            {isPickingImages && selectedImageNames.size === 0 && (
                              <p className="text-xs text-danger">
                                Select at least one image, or check All images.
                              </p>
                            )}
                          </Card>
                        );
                      })}
                    </section>
                  )}

                  {formStep === 2 && includesImageScope && (
                    <>
                      {imageScopeMode === 'all' ? (
                        <Card className="bg-surface-secondary p-4">
                          <p className="text-sm font-semibold text-foreground">
                            All tracked image tags
                          </p>
                          <p className="mt-1 text-xs text-muted">
                            New tracked images will appear on this page automatically.
                          </p>
                        </Card>
                      ) : (
                        <div className="w-full">
                          <Card
                            className={`space-y-3 bg-surface-secondary p-4${imageScopeMode !== 'exact' ? ' hidden' : ''}`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                                  Exact Image Tags
                                </p>
                                <p className="mt-1 text-xs leading-5 text-zinc-500">
                                  Pick individual `image:tag` entries for a tightly curated page.
                                </p>
                              </div>
                              <Chip color="accent" variant="soft">
                                {selectedTargets.length} selected
                              </Chip>
                            </div>

                            <Input
                              className={`${fieldCls} font-mono`}
                              placeholder="Filter by image, tag, or status"
                              value={targetQuery}
                              onChange={(event) => setTargetQuery(event.target.value)}
                            />

                            <Card className="overflow-hidden">
                              {loadingOptions ? (
                                <p className="p-4 text-sm text-zinc-500">Loading image tags…</p>
                              ) : filteredTargetOptions.length === 0 ? (
                                <p className="px-4 py-8 text-sm text-zinc-500">
                                  {targetQuery.trim()
                                    ? 'No image tags match the current filter.'
                                    : 'No tracked image tags are available yet.'}
                                </p>
                              ) : (
                                <div className="max-h-80 overflow-y-auto divide-y">
                                  {filteredTargetOptions.map((option) => {
                                    const isSelected = selectedTargetKeys.has(option.id);
                                    return (
                                      <label
                                        key={option.id}
                                        className="flex items-start gap-3 p-3 cursor-pointer transition-colors"
                                        style={
                                          isSelected
                                            ? {
                                                background:
                                                  'color-mix(in srgb, var(--accent) 9%, transparent)',
                                              }
                                            : undefined
                                        }
                                      >
                                        <span
                                          className="relative mt-1 flex size-4 shrink-0 items-center justify-center rounded border transition-colors"
                                          style={
                                            isSelected
                                              ? {
                                                  borderColor: 'var(--accent)',
                                                  background: 'var(--accent)',
                                                }
                                              : { borderColor: 'rgba(113,113,122,0.4)' }
                                          }
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isSelected}
                                            className="absolute inset-0 cursor-pointer opacity-0"
                                            onChange={(e) => {
                                              const checked = e.target.checked;
                                              setSelectedTargetKeys((current) => {
                                                const next = new Set(current);
                                                if (checked) {
                                                  next.add(option.id);
                                                } else {
                                                  next.delete(option.id);
                                                }
                                                return next;
                                              });
                                            }}
                                          />
                                          {isSelected && (
                                            <svg
                                              className="size-3 text-white pointer-events-none"
                                              viewBox="0 0 12 12"
                                              fill="none"
                                            >
                                              <path
                                                d="M2.5 6l2.5 2.5 4.5-5"
                                                stroke="currentColor"
                                                strokeWidth="1.5"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                              />
                                            </svg>
                                          )}
                                        </span>

                                        <span className="min-w-0 flex-1 text-left">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-mono text-sm break-all text-zinc-800 dark:text-zinc-100">
                                              {option.label}
                                            </p>
                                            <span
                                              className="rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize"
                                              style={
                                                option.latest_status === 'failed'
                                                  ? {
                                                      background: 'rgba(239,68,68,0.12)',
                                                      color: '#f87171',
                                                    }
                                                  : option.latest_status === 'completed'
                                                    ? {
                                                        background: 'rgba(34,197,94,0.12)',
                                                        color: '#4ade80',
                                                      }
                                                    : {
                                                        background: 'rgba(59,130,246,0.12)',
                                                        color: '#93c5fd',
                                                      }
                                              }
                                            >
                                              {option.latest_status}
                                            </span>
                                          </div>
                                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                                            <span>Seen {timeAgo(option.observed_at)}</span>
                                            <span
                                              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                                              style={{
                                                background: 'rgba(239,68,68,0.1)',
                                                color: '#f87171',
                                              }}
                                            >
                                              C {option.critical_count}
                                            </span>
                                            <span
                                              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                                              style={{
                                                background: 'rgba(249,115,22,0.1)',
                                                color: '#fb923c',
                                              }}
                                            >
                                              H {option.high_count}
                                            </span>
                                          </div>
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                            </Card>
                          </Card>

                          <Card
                            className={`space-y-3 bg-surface-secondary p-4${imageScopeMode !== 'pattern' ? ' hidden' : ''}`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                                  Regex Include Patterns
                                </p>
                                <p className="mt-1 text-xs leading-5 text-zinc-500">
                                  One RE2-compatible regex per line. Patterns match against
                                  `image:tag`, image name, and tag.
                                </p>
                              </div>
                              <Chip color="accent" variant="soft">
                                {imagePatterns.length} active
                              </Chip>
                            </div>

                            <TextArea
                              className={`${textareaCls} min-h-40 font-mono`}
                              placeholder={`^ghcr\\.io/acme/.+:prod-.*$\n^nginx$\n^.*:stable$`}
                              value={imagePatternText}
                              onChange={(event) => setImagePatternText(event.target.value)}
                            />

                            <p className="text-xs leading-5 text-zinc-500">
                              Use regex when the scope is tag-driven or too large to maintain
                              manually. Invalid patterns block save.
                            </p>

                            {invalidImagePatterns.length > 0 && (
                              <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">
                                {invalidImagePatterns.map((pattern) => (
                                  <p key={pattern.pattern} className="font-mono break-all">
                                    {pattern.pattern}: {pattern.error}
                                  </p>
                                ))}
                              </div>
                            )}

                            <Card>
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                                  Preview
                                </p>
                                <Chip color="accent" variant="soft">
                                  {regexMatchedOptions.length} matching
                                </Chip>
                              </div>

                              {imagePatterns.length === 0 ? (
                                <p className="mt-3 text-xs leading-5 text-zinc-500">
                                  Add a pattern to preview the tracked tags it would include.
                                </p>
                              ) : regexMatchedOptions.length === 0 ? (
                                <p className="mt-3 text-xs leading-5 text-zinc-500">
                                  Current patterns do not match any tracked image tags outside your
                                  exact selections.
                                </p>
                              ) : (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {regexMatchedOptions.slice(0, 10).map((option) => (
                                    <span
                                      key={option.id}
                                      className="rounded-full px-2.5 py-1 text-xs font-mono"
                                      style={{
                                        background: 'rgba(59,130,246,0.12)',
                                        border: '1px solid rgba(59,130,246,0.2)',
                                        color: '#93c5fd',
                                      }}
                                    >
                                      {option.label}
                                    </span>
                                  ))}
                                  {regexMatchedOptions.length > 10 && (
                                    <span
                                      className="rounded-full px-2.5 py-1 text-xs font-semibold text-zinc-500"
                                      style={{
                                        background: 'var(--status-pill-bg)',
                                        border: '1px solid var(--surface-border)',
                                      }}
                                    >
                                      +{regexMatchedOptions.length - 10} more
                                    </span>
                                  )}
                                </div>
                              )}
                            </Card>
                          </Card>
                        </div>
                      )}
                    </>
                  )}

                  {formStep === 3 && (
                    <>
                      <Card className="bg-surface-secondary p-4">
                        <p className="text-base font-semibold text-foreground">Ready to publish?</p>
                        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                          <div>
                            <dt className="text-muted">Visibility</dt>
                            <dd className="mt-1 font-medium capitalize">{visibility}</dd>
                          </div>
                          <div>
                            <dt className="text-muted">Freshness</dt>
                            <dd className="mt-1 font-medium">{staleAfterHours || 72} hours</dd>
                          </div>
                          <div>
                            <dt className="text-muted">Git sources</dt>
                            <dd className="mt-1 font-medium">
                              {includesGitSources
                                ? selectedGitRepositoryIds.length
                                : 'Not included'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted">Image scope</dt>
                            <dd className="mt-1 font-medium">
                              {includesImageScope
                                ? imageScopeMode === 'all'
                                  ? 'All tracked tags'
                                  : imageScopeMode === 'exact'
                                    ? `${selectedTargets.length} selected tags`
                                    : `${imagePatterns.length} regex patterns`
                                : 'Not included'}
                            </dd>
                          </div>
                        </dl>
                      </Card>
                      <p className="text-xs text-zinc-500">
                        Choose one or more exact `image:tag` entries, add regex include patterns, or
                        enable “Include all image tags”.
                      </p>

                      {includesImageScope && imageScopeMode !== 'all' && (
                        <Card className="bg-surface-secondary">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                                Publish Scope
                              </p>
                              <p className="mt-1 text-xs text-zinc-500">
                                {selectedTargets.length} exact tag
                                {selectedTargets.length === 1 ? '' : 's'} and {imagePatterns.length}{' '}
                                regex pattern{imagePatterns.length === 1 ? '' : 's'} configured.
                              </p>
                            </div>
                          </div>

                          {selectedTargets.length > 0 && (
                            <div className="max-h-24 overflow-y-auto [overflow-anchor:none]">
                              <div className="flex flex-wrap gap-2">
                                {selectedTargets.slice(0, 12).map((target) => (
                                  <Chip
                                    key={`${target.image_name}:${target.image_tag}`}
                                    color="accent"
                                    variant="soft"
                                  >
                                    {target.image_name}:{target.image_tag}
                                  </Chip>
                                ))}
                                {selectedTargets.length > 12 && (
                                  <span
                                    className="rounded-full px-2.5 py-1 text-xs font-semibold text-zinc-500"
                                    style={{
                                      background: 'var(--status-pill-bg)',
                                      border: '1px solid var(--surface-border)',
                                    }}
                                  >
                                    +{selectedTargets.length - 12} more exact tags
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {imagePatterns.length > 0 && (
                            <div className="max-h-24 overflow-y-auto [overflow-anchor:none]">
                              <div className="flex flex-wrap gap-2">
                                {imagePatterns.map((pattern) => (
                                  <span
                                    key={pattern}
                                    className="rounded-full px-2.5 py-1 text-xs font-mono"
                                    style={{
                                      background: 'rgba(59,130,246,0.12)',
                                      border: '1px solid rgba(59,130,246,0.2)',
                                      color: '#93c5fd',
                                    }}
                                  >
                                    {pattern}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {selectedTargets.length === 0 && imagePatterns.length === 0 && (
                            <p className="text-xs leading-5 text-zinc-500">
                              Selections and regex matches will appear here without changing the
                              modal height.
                            </p>
                          )}
                        </Card>
                      )}

                      {includesImageScope &&
                        imageScopeMode !== 'all' &&
                        !loadingOptions &&
                        !scopeIsValid && (
                          <p className="text-xs text-red-400">
                            Select at least one exact image tag or add a regex include pattern.
                          </p>
                        )}

                      <div className="grid grid-cols-1 p-2 md:grid-cols-2 gap-4 items-start">
                        <div className="space-y-1.5">
                          <Label className={fieldLabelCls}>Active Banner Title (optional)</Label>
                          <Input
                            className={fieldCls + ' bg-surface-secondary'}
                            value={updateTitle}
                            onChange={(event) => setUpdateTitle(event.target.value)}
                            placeholder="Database refresh in progress"
                          />
                        </div>
                        <Select
                          value={updateLevel}
                          onChange={(value) =>
                            setUpdateLevel(String(value) as (typeof updateLevelOptions)[number])
                          }
                          className="w-full"
                          placeholder="Select a banner level"
                        >
                          <Label className={fieldLabelCls}>Banner Level</Label>
                          <Select.Trigger className={selectTriggerCls + ' bg-surface-secondary'}>
                            <Select.Value />
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              {updateLevelOptions.map((option) => (
                                <ListBox.Item id={option} key={option} textValue={option}>
                                  {option}
                                  <ListBox.ItemIndicator />
                                </ListBox.Item>
                              ))}
                            </ListBox>
                          </Select.Popover>
                        </Select>
                      </div>

                      <div className="space-y-1.5 p-2">
                        <Label className={fieldLabelCls}>Active Banner Message</Label>
                        <TextArea
                          className={textareaCls + ' bg-surface-secondary'}
                          value={updateBody}
                          onChange={(event) => setUpdateBody(event.target.value)}
                          placeholder="We are re-scanning images after a registry credential rotation. Short-lived stale states are expected."
                        />
                      </div>
                    </>
                  )}
                </form>
              </Modal.Body>

              <Modal.Footer
                className="flex items-center justify-between gap-3 px-6 py-4"
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                <Button
                  type="button"
                  variant="tertiary"
                  className="text-muted"
                  onPress={modal.close}
                >
                  Cancel
                </Button>
                <div className="flex items-center gap-2">
                  {formStep > 0 ? (
                    <Button
                      type="button"
                      variant="tertiary"
                      className="text-foreground"
                      onPress={() => setFormStep((step) => step - 1)}
                    >
                      Back
                    </Button>
                  ) : null}
                  {formStep < statusPageSteps.length - 1 ? (
                    <Button
                      type="button"
                      isDisabled={!canAdvanceStatusPageStep}
                      onPress={() => void advanceStatusPageStep()}
                    >
                      Continue
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      form="status-page-form"
                      isDisabled={
                        saving ||
                        !scopeIsValid ||
                        (editing ? !canManageStatusPage(editing) : !canMutateActiveScope)
                      }
                      className="btn-primary"
                    >
                      {saving && (
                        <div className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      )}
                      {editing ? 'Save status page' : 'Create status page'}
                    </Button>
                  )}
                </div>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal state={shareModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">
                  Manage Status Page Access
                </Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="py-5 space-y-4">
                {shareError && (
                  <Alert status="danger">
                    <Alert.Indicator />
                    <Alert.Title>{shareError}</Alert.Title>
                  </Alert>
                )}
                {shareTarget ? (
                  <Card className="py-3 bg-surface-secondary">
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {shareTarget.name}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 font-mono">
                      /status/{shareTarget.slug}
                    </p>
                    <div className="mt-2">
                      <OwnershipBadge
                        ownerType={shareTarget.owner_type}
                        ownerOrgId={shareTarget.owner_org_id}
                        orgNamesById={orgNamesById}
                      />
                    </div>
                  </Card>
                ) : null}

                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                      Current access
                    </h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Organizations listed here can open and manage this status page.
                    </p>
                  </div>
                  {sharesLoading ? (
                    <div className="flex justify-center py-6">
                      <div className="size-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-accent-500 animate-spin" />
                    </div>
                  ) : shares.length === 0 ? (
                    <p className="text-sm text-zinc-500">No organization grants yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {shares.map((share) => (
                        <Card
                          key={share.org_id}
                          className="flex flex-col items-start justify-between gap-3 px-4 py-3 bg-surface-secondary"
                        >
                          <div>
                            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                              {share.org_name}
                            </p>
                            <p className="text-xs text-zinc-500 mt-0.5">
                              {share.is_owner ? 'Owner workspace' : 'Shared access'}
                            </p>
                          </div>
                          <div>
                            {share.is_owner ? (
                              <span className="text-xs font-medium text-zinc-500">Locked</span>
                            ) : (
                              <Button
                                onClick={() => {
                                  void handleRevokeShare(share.org_id);
                                }}
                                isDisabled={shareSaving}
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
                      Share this status page with another organization you manage.
                    </p>
                  </div>
                  {availableShareTargets.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                      No additional organizations are available for sharing.
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        placeholder="Select an organization"
                        value={shareOrgId}
                        onChange={(value) => setShareOrgId(String(value))}
                      >
                        <Select.Trigger
                          className={`${heroFieldClassName} flex-1 bg-surface-secondary`}
                        >
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {availableShareTargets.map((org) => (
                              <ListBox.Item key={org.id} id={org.id} textValue={org.name}>
                                {org.name}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      <Button
                        type="button"
                        onPress={() => {
                          void handleGrantShare();
                        }}
                        isDisabled={!shareOrgId || shareSaving}
                        className="btn-primary"
                      >
                        Grant
                      </Button>
                    </div>
                  )}
                </div>
                <OwnershipTransfer
                  ownerOrgId={shareTarget?.owner_type === 'org' ? shareTarget.owner_org_id : null}
                  organizations={transferTargets}
                  selectedOrgId={transferOrgId}
                  onSelectedOrgIdChange={setTransferOrgId}
                  onTransfer={() => void handleTransferOwnership()}
                  isSaving={shareSaving}
                  warning="Displayed scans and policy results will use the destination organization."
                />
              </Modal.Body>
              <Modal.Footer
                className="px-6 py-4 flex justify-end"
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                <Button className="btn-secondary" onPress={shareModal.close}>
                  Close
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {dialog}
    </div>
  );
}
