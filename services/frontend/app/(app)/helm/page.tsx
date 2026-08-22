'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { PageHeader } from '@/components/ui/page-header';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { StatusAlert } from '@/components/ui/form-alert';
import { useWorkScope } from '@/hooks/use-work-scope';
import type { Key } from '@heroui/react';
import {
  createHelmScans,
  createShare,
  deleteHelmScanRun,
  extractHelmImages,
  getDefaultScannerCapabilities,
  getHelmScanRun,
  getTokenType,
  getWorkScope,
  HelmExtractResponse,
  HelmScanRunSummary,
  listHelmScanRuns,
  listHelmRegistryCredentials,
  listOrgs,
  Org,
  listRegistriesWithCapabilities,
  listTags,
  RegistryWithHealth,
  HelmRegistryCredential,
  ScannerCapabilities,
  Tag,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import {
  createEditableHelmImages,
  EditableHelmImage,
  getHelmImageSourceLabel,
  parseHelmImageRef,
} from '@/lib/helm-image-overrides';
import { timeAgo } from '@/lib/time';
import {
  Alert,
  Button,
  buttonVariants,
  Card,
  Checkbox,
  Chip,
  Description,
  Input,
  Label,
  ListBox,
  Pagination,
  SearchField,
  Select,
  Switch,
  Table,
  TextField,
  type SortDescriptor,
} from '@heroui/react';
import {
  ArrowLeft01Icon,
  CopyLinkIcon,
  Delete01Icon,
  EyeIcon,
  FileValidationIcon,
  PackageIcon,
  Refresh01Icon,
  Share01Icon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Step = 'input' | 'images' | 'configure';

const HELM_CREATION_STEPS: { key: Step; label: string }[] = [
  { key: 'input', label: 'Chart' },
  { key: 'images', label: 'Review images' },
  { key: 'configure', label: 'Configure & queue' },
];

const PLATFORMS = [
  { id: '__auto__', label: 'Auto-detect' },
  { id: 'linux/amd64', label: 'linux/amd64' },
  { id: 'linux/arm64', label: 'linux/arm64' },
  { id: 'linux/arm/v7', label: 'linux/arm/v7' },
  { id: 'linux/arm/v6', label: 'linux/arm/v6' },
  { id: 'linux/386', label: 'linux/386' },
  { id: 'linux/s390x', label: 'linux/s390x' },
  { id: 'linux/ppc64le', label: 'linux/ppc64le' },
  { id: 'windows/amd64', label: 'windows/amd64' },
];

const PROVIDER_LABEL: Record<string, string> = {
  trivy: 'Trivy',
  artifactory_xray: 'Artifactory Xray',
};

function credentialMatchesChart(
  credential: HelmRegistryCredential,
  rawChartURL: string,
  isOCI: boolean
): boolean {
  if (!rawChartURL.trim()) return true;
  if (credential.protocol !== (isOCI ? 'oci' : 'http')) return false;
  try {
    const normalize = (value: string) => value.replace(/^oci:\/\//, 'https://');
    const credentialURL = new URL(normalize(credential.url));
    const chartURL = new URL(normalize(rawChartURL.trim()));
    if (credentialURL.host.toLowerCase() !== chartURL.host.toLowerCase()) return false;
    const credentialPath = credentialURL.pathname.replace(/^\/+|\/+$/g, '');
    const chartPath = chartURL.pathname.replace(/^\/+|\/+$/g, '');
    return (
      !credentialPath || chartPath === credentialPath || chartPath.startsWith(`${credentialPath}/`)
    );
  } catch {
    return false;
  }
}

type HelmRunHistoryStatus = 'all' | 'running' | 'completed' | 'failed';
type HelmRunHistorySortKey =
  | 'chart'
  | 'status'
  | 'images'
  | 'completed'
  | 'failed'
  | 'high'
  | 'critical'
  | 'started'
  | 'owner';

const HELM_RUN_HISTORY_PAGE_SIZE = 10;

export function HelmWorkspace({ mode = 'history' }: { mode?: 'history' | 'new' }) {
  const router = useRouter();
  const toast = useToast();
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const [step, setStep] = useState<Step>('input');
  const [chartURL, setChartURL] = useState('');
  const [chartName, setChartName] = useState('');
  const [chartVersion, setChartVersion] = useState('');
  const [helmRegistryCredentialId, setHelmRegistryCredentialId] = useState('');
  const [helmRegistryCredentials, setHelmRegistryCredentials] = useState<HelmRegistryCredential[]>(
    []
  );
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');

  const [extracted, setExtracted] = useState<HelmExtractResponse | null>(null);
  const [editableImages, setEditableImages] = useState<EditableHelmImage[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [platform, setPlatform] = useState('');
  const [registryId, setRegistryId] = useState('');
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [registries, setRegistries] = useState<RegistryWithHealth[]>([]);
  const [capabilities, setCapabilities] = useState<ScannerCapabilities>(() =>
    getDefaultScannerCapabilities()
  );
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [makePublic, setMakePublic] = useState(false);
  const [scopedOrgPolicy, setScopedOrgPolicy] = useState<Org | null>(null);

  const [helmRuns, setHelmRuns] = useState<HelmScanRunSummary[]>([]);
  const [isAdmin] = useState(() => getTokenType() === 'admin');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [tagError, setTagError] = useState('');
  const [credentialsError, setCredentialsError] = useState('');
  const [registryError, setRegistryError] = useState('');
  const [scopedOrgPolicyError, setScopedOrgPolicyError] = useState('');
  const [historyActionRunId, setHistoryActionRunId] = useState<string | null>(null);

  const isOCI = chartURL.trim().startsWith('oci://');
  const matchingHelmCredentials = useMemo(
    () =>
      helmRegistryCredentials.filter((credential) =>
        credentialMatchesChart(credential, chartURL, isOCI)
      ),
    [chartURL, helmRegistryCredentials, isOCI]
  );
  const selectedImages = editableImages.filter((img) => selected.has(img.id));
  const hasInvalidSelection = selectedImages.some((img) => img.edited_ref.trim() === '');
  const selectableRegistries = registries.filter(
    (registry) => registry.scan_provider === 'artifactory_xray' || capabilities.enable_trivy
  );
  const xrayOnlyWithoutRegistries = !capabilities.enable_trivy && selectableRegistries.length === 0;

  const loadTags = useCallback(async () => {
    setTagError('');
    try {
      setAvailableTags(await listTags());
    } catch (reason: unknown) {
      setTagError(reason instanceof Error ? reason.message : 'Failed to load tags');
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const { data } = await listHelmScanRuns(1, 24);
      setHelmRuns(Array.isArray(data) ? data : []);
    } catch (reason: unknown) {
      setHistoryError(reason instanceof Error ? reason.message : 'Failed to load Helm runs');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadCredentials = useCallback(async () => {
    setCredentialsError('');
    try {
      setHelmRegistryCredentials(await listHelmRegistryCredentials());
    } catch (reason: unknown) {
      setCredentialsError(
        reason instanceof Error ? reason.message : 'Failed to load Helm credentials'
      );
    }
  }, []);

  const loadRegistries = useCallback(async () => {
    setRegistryError('');
    try {
      const response = await listRegistriesWithCapabilities();
      setRegistries(response.data);
      setCapabilities(response.capabilities);
    } catch (reason: unknown) {
      setRegistryError(
        reason instanceof Error ? reason.message : 'Failed to load scanner registries'
      );
    }
  }, []);

  useEffect(() => {
    return deferEffect(() => {
      void loadTags();
      void loadHistory();
      void loadCredentials();
      void loadRegistries();
    });
  }, [loadCredentials, loadHistory, loadRegistries, loadTags, scopeKey]);

  useEffect(() => {
    let cancelled = false;
    const loadScopedOrgPolicy = async () => {
      if (workScope.kind !== 'org') {
        await Promise.resolve();
        if (!cancelled) {
          setScopedOrgPolicy(null);
          setScopedOrgPolicyError('');
        }
        return;
      }
      listOrgs()
        .then((orgs) => {
          if (cancelled) return;
          setScopedOrgPolicy(orgs.find((org) => org.id === workScope.orgId) ?? null);
          setScopedOrgPolicyError('');
        })
        .catch(() => {
          if (cancelled) return;
          setScopedOrgPolicy(null);
          setScopedOrgPolicyError('Failed to load organization scan policy');
        });
    };
    void loadScopedOrgPolicy();
    return () => {
      cancelled = true;
    };
  }, [scopeKey, workScope]);

  const orgFeatureBlockMessage =
    workScope.kind !== 'org' || !scopedOrgPolicy
      ? ''
      : !scopedOrgPolicy.is_active
        ? 'Organization is suspended. Helm scan creation is disabled.'
        : scopedOrgPolicy.allow_helm_scans
          ? ''
          : 'Helm scans are disabled for this organization.';

  async function handleExtract(e: React.FormEvent) {
    e.preventDefault();
    setExtractError('');

    const url = chartURL.trim();
    if (!url) return;
    if (!isOCI && !chartName.trim()) {
      setExtractError('Chart name is required for HTTP repository URLs.');
      return;
    }

    setExtracting(true);
    try {
      const result = await extractHelmImages(
        url,
        chartName.trim() || undefined,
        chartVersion.trim() || undefined,
        helmRegistryCredentialId || undefined
      );
      const images = Array.isArray(result.images) ? result.images : [];
      const nextImages = createEditableHelmImages(images);
      setExtracted({ ...result, images });
      setEditableImages(nextImages);
      setSelected(new Set(nextImages.map((img) => img.id)));
      setStep('images');
    } catch (err: unknown) {
      setExtractError(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  }

  async function handleScan() {
    if (!extracted || selected.size === 0) return;
    if (hasInvalidSelection) {
      toast.error('Each selected image needs a non-empty image reference');
      return;
    }
    if (xrayOnlyWithoutRegistries) {
      toast.error('No Artifactory Xray registry is configured yet.');
      return;
    }
    if (orgFeatureBlockMessage) {
      toast.error(orgFeatureBlockMessage);
      return;
    }

    setScanning(true);
    try {
      const currentScope = getWorkScope();
      const images = editableImages
        .filter((img) => selected.has(img.id))
        .map((img) => ({
          full_ref: img.edited_ref.trim(),
          source_path: getHelmImageSourceLabel(img),
        }));

      const result = await createHelmScans(
        chartURL.trim(),
        images,
        platform || undefined,
        selectedTagIds.size > 0 ? Array.from(selectedTagIds) : undefined,
        extracted.chart_name,
        extracted.chart_version,
        registryId || undefined,
        currentScope.kind === 'org' ? currentScope.orgId : undefined
      );

      if (makePublic && (result.scans?.length ?? 0) > 0) {
        const shareResults = await Promise.allSettled(
          result.scans.map((scan) => createShare(scan.id, 'public'))
        );
        const sharedCount = shareResults.filter((share) => share.status === 'fulfilled').length;
        const failedCount = shareResults.length - sharedCount;
        if (failedCount > 0) {
          toast.error(
            `${sharedCount} scan${sharedCount === 1 ? '' : 's'} shared, but ${failedCount} public link${failedCount === 1 ? '' : 's'} could not be created. You can retry sharing from the run history.`
          );
        }
      }

      await loadHistory();
      toast.success(
        `${result.scans.length} image${result.scans.length === 1 ? '' : 's'} queued in Helm run ${result.run.id.slice(0, 8)}`
      );
      router.push(`/helm/runs/${result.run.id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create scans');
    } finally {
      setScanning(false);
    }
  }

  function toggleAll() {
    if (editableImages.length === 0) return;
    if (selected.size === editableImages.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(editableImages.map((image) => image.id)));
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateEditedRef(id: string, value: string) {
    setEditableImages((prev) =>
      prev.map((image) => (image.id === id ? { ...image, edited_ref: value } : image))
    );
  }

  function handleChartURLChange(value: string) {
    setChartURL(value);
    if (
      value.trim() &&
      helmRegistryCredentialId &&
      !helmRegistryCredentials.some(
        (credential) =>
          credential.id === helmRegistryCredentialId &&
          credentialMatchesChart(credential, value, value.trim().startsWith('oci://'))
      )
    ) {
      setHelmRegistryCredentialId('');
    }
  }

  async function shareHelmRun(run: HelmScanRunSummary, copyLink = false) {
    setHistoryActionRunId(run.id);
    try {
      const detail = await getHelmScanRun(run.id);
      const scans = detail.items
        .map((item) => item.latest_scan)
        .filter((scan) => scan.status === 'completed' || scan.status === 'failed');
      if (scans.length === 0) {
        toast.error('No completed or failed scans are available to share yet.');
        return;
      }

      const shareResults = await Promise.allSettled(
        scans.map(async (scan) => {
          if (scan.share_token) return scan.share_token;
          const share = await createShare(scan.id, 'public');
          return share.share_token;
        })
      );
      const tokens = shareResults.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : []
      );
      const failedCount = shareResults.length - tokens.length;
      if (tokens.length === 0) {
        throw new Error('No public links could be created for this Helm run');
      }

      await loadHistory();
      if (failedCount > 0) {
        toast.error(
          `${tokens.length} scan${tokens.length === 1 ? '' : 's'} shared, but ${failedCount} public link${failedCount === 1 ? '' : 's'} failed. Retry to share the remaining scans.`
        );
      } else {
        toast.success(`Shared ${scans.length} scan${scans.length === 1 ? '' : 's'}`);
      }

      if (copyLink && tokens.length > 0) {
        const [first, ...rest] = tokens;
        const base = `${window.location.origin}/shared/helm/${first}`;
        const url = rest.length > 0 ? `${base}?tokens=${rest.join(',')}` : base;
        await navigator.clipboard.writeText(url);
        toast.success('Share link copied');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to share Helm run');
    } finally {
      setHistoryActionRunId(null);
    }
  }

  async function deleteHelmRun(run: HelmScanRunSummary) {
    const ok = await confirm({
      title: 'Delete Helm run?',
      message: `This will delete ${run.total_images} scan${run.total_images === 1 ? '' : 's'} from this Helm run in the current workspace.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;

    setHistoryActionRunId(run.id);
    try {
      await deleteHelmScanRun(run.id);
      toast.success('Helm run deleted');
      await loadHistory();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete Helm run');
    } finally {
      setHistoryActionRunId(null);
    }
  }

  return (
    <div className="space-y-5 px-4 py-6 md:px-6 xl:py-7">
      <PageHeader
        title={mode === 'new' ? 'New Helm scan' : 'Helm runs'}
        description={
          mode === 'new'
            ? 'Extract images from a chart, review them, then configure and queue the run.'
            : 'Review chart scan runs, investigate results, and return to the exact set of images that was queued.'
        }
        breadcrumbs={
          mode === 'new' ? [{ label: 'Helm', href: '/helm' }, { label: 'New scan' }] : undefined
        }
        actions={
          mode === 'new' ? (
            <Link className={buttonVariants({ variant: 'secondary' })} href="/helm">
              <ArrowLeft01Icon size={14} />
              Back to runs
            </Link>
          ) : (
            <>
              <Link className={buttonVariants({ variant: 'primary' })} href="/helm/new">
                <PackageIcon size={15} />
                New Helm scan
              </Link>
              <Button
                type="button"
                variant="secondary"
                onPress={loadHistory}
                isDisabled={historyLoading}
              >
                <Refresh01Icon size={14} className={historyLoading ? 'animate-spin' : ''} />
                Refresh
              </Button>
            </>
          )
        }
      />

      {mode === 'new' ? (
        <>
          <StepBar current={step} />

          {step === 'input' && (
            <Card>
              <Card.Header>
                <Card.Title className="flex items-center gap-2">
                  <PackageIcon size={18} />
                  Chart
                </Card.Title>
                <Card.Description>
                  Extract container images from an OCI chart or HTTP chart repository.
                </Card.Description>
              </Card.Header>
              <Card.Content>
                <form onSubmit={handleExtract} className="space-y-4">
                  <TextField fullWidth isRequired value={chartURL} onChange={handleChartURLChange}>
                    <Label>Chart URL</Label>
                    <Input
                      variant="secondary"
                      placeholder="oci://ghcr.io/org/charts/mychart or https://charts.bitnami.com/bitnami"
                      value={chartURL}
                      onChange={(e) => handleChartURLChange(e.target.value)}
                      required
                    />
                    <Description>
                      OCI: <code className="font-mono">oci://registry/path/chartname</code>{' '}
                      &nbsp;·&nbsp; HTTP: provide the repo URL and the chart name below
                    </Description>
                  </TextField>

                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="helm-credential">Helm credential</Label>
                    <Select
                      id="helm-credential"
                      aria-label="Helm credential"
                      className="w-full"
                      value={helmRegistryCredentialId || '__none__'}
                      onChange={(value) =>
                        setHelmRegistryCredentialId(
                          String(value === '__none__' ? '' : (value ?? ''))
                        )
                      }
                      variant="secondary"
                    >
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="__none__">No credential (public chart)</ListBox.Item>
                          {matchingHelmCredentials.map((credential) => (
                            <ListBox.Item key={credential.id} id={credential.id}>
                              {credential.name} · {credential.url}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <Description>
                      Only credentials that match this chart endpoint are available.
                    </Description>
                    {credentialsError ? (
                      <StatusAlert
                        status="warning"
                        title="Helm credentials unavailable"
                        description={credentialsError}
                        action={
                          <Button size="sm" variant="secondary" onPress={loadCredentials}>
                            Retry
                          </Button>
                        }
                      />
                    ) : null}
                  </div>

                  {!isOCI && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField fullWidth isRequired value={chartName} onChange={setChartName}>
                        <Label>Chart Name</Label>
                        <Input
                          variant="secondary"
                          placeholder="nginx"
                          value={chartName}
                          onChange={(e) => setChartName(e.target.value)}
                        />
                      </TextField>
                      <TextField fullWidth value={chartVersion} onChange={setChartVersion}>
                        <Label>Version</Label>
                        <Input
                          variant="secondary"
                          placeholder="15.3.0"
                          value={chartVersion}
                          onChange={(e) => setChartVersion(e.target.value)}
                        />
                        <Description>Optional</Description>
                      </TextField>
                    </div>
                  )}

                  {isOCI && (
                    <TextField fullWidth value={chartVersion} onChange={setChartVersion}>
                      <Label>Version</Label>
                      <Input
                        variant="secondary"
                        placeholder="1.0.0"
                        value={chartVersion}
                        onChange={(e) => setChartVersion(e.target.value)}
                      />
                      <Description>Optional</Description>
                    </TextField>
                  )}

                  {extractError && (
                    <Alert status="danger">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>Image extraction failed</Alert.Title>
                        <Alert.Description>{extractError}</Alert.Description>
                      </Alert.Content>
                    </Alert>
                  )}

                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      variant="primary"
                      isDisabled={extracting || !chartURL.trim()}
                      isPending={extracting}
                    >
                      Extract Images
                    </Button>
                  </div>
                </form>
              </Card.Content>
            </Card>
          )}

          {(step === 'images' || step === 'configure') && extracted && (
            <div className="space-y-4">
              {step === 'configure' ? (
                <>
                  <Card>
                    <Card.Content className="grid w-full gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">
                          {extracted.chart_name}
                          {extracted.chart_version && (
                            <span className="ml-2 text-xs font-normal text-muted">
                              v{extracted.chart_version}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted mt-0.5">
                          Found {extracted.images.length} image
                          {extracted.images.length !== 1 ? 's' : ''} &nbsp;·&nbsp;
                          <span className="font-medium">{selected.size} selected</span>
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        className="justify-self-start sm:justify-self-end"
                        onPress={() => setStep('input')}
                      >
                        <ArrowLeft01Icon size={14} />
                        Change chart
                      </Button>
                    </Card.Content>
                  </Card>

                  <Card>
                    <Card.Content className="grid w-full gap-4 lg:grid-cols-[minmax(280px,380px)_minmax(180px,240px)_minmax(0,1fr)_auto] lg:items-end">
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <Label htmlFor="helm-registry" className="text-xs">
                          Registry
                        </Label>
                        <Select
                          id="helm-registry"
                          aria-label="Registry"
                          className="w-full"
                          value={registryId || '__auto__'}
                          onChange={(value) =>
                            setRegistryId(String(value === '__auto__' ? '' : (value ?? '')))
                          }
                          variant="secondary"
                        >
                          <Select.Trigger>
                            <Select.Value />
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              <ListBox.Item id="__auto__">
                                {capabilities.enable_trivy
                                  ? 'Auto-match from image hostname'
                                  : 'Auto-match from configured Xray registries'}
                              </ListBox.Item>
                              {selectableRegistries.map((registry) => (
                                <ListBox.Item key={registry.id} id={registry.id}>
                                  {registry.name} ·{' '}
                                  {PROVIDER_LABEL[registry.scan_provider] ?? registry.scan_provider}
                                </ListBox.Item>
                              ))}
                            </ListBox>
                          </Select.Popover>
                        </Select>
                      </div>

                      {xrayOnlyWithoutRegistries && (
                        <Alert status="warning" className="w-full">
                          <Alert.Indicator />
                          <Alert.Content>
                            <Alert.Description>
                              No Artifactory Xray registry is configured yet, so this Helm run
                              cannot be queued until one is added.
                            </Alert.Description>
                          </Alert.Content>
                        </Alert>
                      )}
                      {registryError ? (
                        <StatusAlert
                          status="warning"
                          title="Scanner registries unavailable"
                          description={registryError}
                          action={
                            <Button size="sm" variant="secondary" onPress={loadRegistries}>
                              Retry
                            </Button>
                          }
                        />
                      ) : null}

                      <div className="flex min-w-0 flex-col gap-1.5">
                        <Label htmlFor="helm-platform" className="text-xs">
                          Platform
                        </Label>
                        <Select
                          id="helm-platform"
                          aria-label="Platform"
                          className="w-full"
                          value={platform || '__auto__'}
                          onChange={(value) =>
                            setPlatform(String(value === '__auto__' ? '' : (value ?? '')))
                          }
                          variant="secondary"
                        >
                          <Select.Trigger>
                            <Select.Value />
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              {PLATFORMS.map((platformOption) => (
                                <ListBox.Item key={platformOption.id} id={platformOption.id}>
                                  {platformOption.label}
                                </ListBox.Item>
                              ))}
                            </ListBox>
                          </Select.Popover>
                        </Select>
                      </div>

                      {availableTags.length > 0 && (
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <Select
                            id="helm-tags"
                            aria-label="Tags"
                            className="w-full"
                            placeholder="Select tags"
                            selectionMode="multiple"
                            value={Array.from(selectedTagIds)}
                            onChange={(keys) =>
                              setSelectedTagIds(new Set((keys as Key[]).map((key) => String(key))))
                            }
                            variant="secondary"
                          >
                            <Label className="text-xs">Tags</Label>
                            <Select.Trigger>
                              <Select.Value />
                              <Select.Indicator />
                            </Select.Trigger>
                            <Select.Popover>
                              <ListBox selectionMode="multiple">
                                {availableTags.map((tag) => (
                                  <ListBox.Item key={tag.id} id={tag.id} textValue={tag.name}>
                                    {tag.name}
                                    <ListBox.ItemIndicator />
                                  </ListBox.Item>
                                ))}
                              </ListBox>
                            </Select.Popover>
                          </Select>
                          {selectedTagIds.size > 0 && (
                            <p className="text-xs text-muted">
                              {selectedTagIds.size} tag{selectedTagIds.size === 1 ? '' : 's'}{' '}
                              selected
                            </p>
                          )}
                        </div>
                      )}
                      {tagError ? (
                        <StatusAlert
                          status="warning"
                          title="Tags unavailable"
                          description={tagError}
                          action={
                            <Button size="sm" variant="secondary" onPress={loadTags}>
                              Retry
                            </Button>
                          }
                        />
                      ) : null}

                      <Switch
                        className="justify-self-start lg:justify-self-end"
                        isSelected={makePublic}
                        onChange={setMakePublic}
                      >
                        <Switch.Content>
                          <Switch.Control>
                            <Switch.Thumb />
                          </Switch.Control>
                          <span className="text-xs">Share publicly</span>
                        </Switch.Content>
                      </Switch>
                    </Card.Content>
                  </Card>
                </>
              ) : null}

              {step === 'images' ? (
                <>
                  <Table>
                    <Table.ScrollContainer>
                      <Table.Content aria-label="Extracted Helm images" className="min-w-[840px]">
                        <Table.Header>
                          <Table.Column className="w-10">
                            <Checkbox
                              aria-label={
                                selected.size === extracted.images.length
                                  ? 'Deselect all'
                                  : 'Select all'
                              }
                              isSelected={selected.size === extracted.images.length}
                              isIndeterminate={
                                selected.size > 0 && selected.size < extracted.images.length
                              }
                              slot="selection"
                              onChange={toggleAll}
                            >
                              <Checkbox.Content>
                                <Checkbox.Control>
                                  <Checkbox.Indicator />
                                </Checkbox.Control>
                              </Checkbox.Content>
                            </Checkbox>
                          </Table.Column>
                          <Table.Column isRowHeader>Image</Table.Column>
                          <Table.Column>Tag</Table.Column>
                          <Table.Column>Source</Table.Column>
                        </Table.Header>
                        <Table.Body>
                          {editableImages.map((img) => {
                            const checked = selected.has(img.id);
                            const parsed = parseHelmImageRef(img.edited_ref);
                            return (
                              <Table.Row
                                key={img.id}
                                id={img.id}
                                className="cursor-pointer hover:bg-[var(--row-hover)]"
                                onClick={() => toggleRow(img.id)}
                              >
                                <Table.Cell onClick={(event) => event.stopPropagation()}>
                                  <Checkbox
                                    aria-label={`Select ${img.edited_ref || 'image'}`}
                                    isSelected={checked}
                                    slot="selection"
                                    onChange={() => toggleRow(img.id)}
                                  >
                                    <Checkbox.Content>
                                      <Checkbox.Control>
                                        <Checkbox.Indicator />
                                      </Checkbox.Control>
                                    </Checkbox.Content>
                                  </Checkbox>
                                </Table.Cell>
                                <Table.Cell className="min-w-[420px]">
                                  <div className="w-full space-y-1">
                                    <Input
                                      variant="secondary"
                                      value={img.edited_ref}
                                      onChange={(event) =>
                                        updateEditedRef(img.id, event.target.value)
                                      }
                                      onClick={(event) => event.stopPropagation()}
                                      placeholder="registry.example.com/org/image:tag"
                                      className="w-full font-mono"
                                    />
                                    <p className="truncate text-xs text-muted">
                                      {parsed.name || 'Enter an image reference'}
                                    </p>
                                  </div>
                                </Table.Cell>
                                <Table.Cell className="font-mono text-xs text-muted">
                                  {parsed.tag || '-'}
                                </Table.Cell>
                                <Table.Cell className="text-xs text-muted">
                                  <span title={getHelmImageSourceLabel(img)}>
                                    {img.source_file}
                                  </span>
                                </Table.Cell>
                              </Table.Row>
                            );
                          })}
                        </Table.Body>
                      </Table.Content>
                    </Table.ScrollContainer>
                  </Table>

                  <p className="text-xs text-muted">
                    Override any extracted image reference before queueing. The selected rows will
                    use the edited values.
                  </p>
                </>
              ) : null}
              {step === 'configure' && orgFeatureBlockMessage ? (
                <Alert status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>Scan creation disabled</Alert.Title>
                    <Alert.Description>{orgFeatureBlockMessage}</Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}
              {step === 'configure' && scopedOrgPolicyError ? (
                <StatusAlert
                  status="warning"
                  title="Organization policy unavailable"
                  description={scopedOrgPolicyError}
                />
              ) : null}

              <div className="flex items-center justify-between gap-4 pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  onPress={() => setStep(step === 'images' ? 'input' : 'images')}
                >
                  <ArrowLeft01Icon size={14} />
                  Back
                </Button>
                {step === 'images' ? (
                  <Button
                    type="button"
                    variant="primary"
                    onPress={() => setStep('configure')}
                    isDisabled={selected.size === 0 || hasInvalidSelection}
                  >
                    Continue to configuration
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    onPress={handleScan}
                    isDisabled={
                      scanning ||
                      selected.size === 0 ||
                      hasInvalidSelection ||
                      xrayOnlyWithoutRegistries ||
                      Boolean(orgFeatureBlockMessage)
                    }
                    isPending={scanning}
                  >
                    Queue {selected.size} selected image{selected.size !== 1 ? 's' : ''}
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <HelmRunHistory
          runs={helmRuns}
          isAdmin={isAdmin}
          loading={historyLoading}
          error={historyError}
          actionRunId={historyActionRunId}
          onRetry={loadHistory}
          onDeleteRun={deleteHelmRun}
          onShareRun={(run) => shareHelmRun(run)}
          onCopyShareLink={(run) => shareHelmRun(run, true)}
        />
      )}
      {confirmDialog}
    </div>
  );
}

export default function HelmPage() {
  return <HelmWorkspace />;
}

function statusColor(status: string): 'default' | 'success' | 'warning' | 'danger' | 'accent' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'running':
      return 'accent';
    default:
      return 'default';
  }
}

function getRunStatus(run: HelmScanRunSummary): Exclude<HelmRunHistoryStatus, 'all'> {
  if (run.active_images > 0) return 'running';
  if (run.failed_images > 0) return 'failed';
  return 'completed';
}

function getRunChartLabel(run: HelmScanRunSummary) {
  return run.chart_name || run.chart_url.replace(/^oci:\/\//, '');
}

function HelmRunHistory({
  runs,
  isAdmin,
  loading,
  error,
  actionRunId,
  onRetry,
  onDeleteRun,
  onShareRun,
  onCopyShareLink,
}: {
  runs: HelmScanRunSummary[];
  isAdmin: boolean;
  loading: boolean;
  error: string;
  actionRunId: string | null;
  onRetry: () => void;
  onDeleteRun: (run: HelmScanRunSummary) => void;
  onShareRun: (run: HelmScanRunSummary) => void;
  onCopyShareLink: (run: HelmScanRunSummary) => void;
}) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<HelmRunHistoryStatus>('all');
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: 'started',
    direction: 'descending',
  });
  const [page, setPage] = useState(1);

  const filteredRuns = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return runs.filter((run) => {
      const status = getRunStatus(run);
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (!query) return true;

      return [run.id, run.chart_name, run.chart_url, run.chart_version, run.owner_username, status]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [runs, searchQuery, statusFilter]);

  const sortedRuns = useMemo(() => {
    const direction = sortDescriptor.direction === 'descending' ? -1 : 1;
    const column = String(sortDescriptor.column || 'started') as HelmRunHistorySortKey;
    const statusRank: Record<Exclude<HelmRunHistoryStatus, 'all'>, number> = {
      running: 0,
      failed: 1,
      completed: 2,
    };

    return [...filteredRuns].sort((first, second) => {
      if (column === 'status') {
        return (statusRank[getRunStatus(first)] - statusRank[getRunStatus(second)]) * direction;
      }

      if (column === 'images') {
        return (first.total_images - second.total_images) * direction;
      }

      if (column === 'completed') {
        return (first.completed_images - second.completed_images) * direction;
      }

      if (column === 'failed') {
        return (first.failed_images - second.failed_images) * direction;
      }

      if (column === 'high') {
        return (first.high_count - second.high_count) * direction;
      }

      if (column === 'critical') {
        return (first.critical_count - second.critical_count) * direction;
      }

      if (column === 'started') {
        return (
          ((Date.parse(first.created_at || '') || 0) - (Date.parse(second.created_at || '') || 0)) *
          direction
        );
      }

      if (column === 'owner') {
        return (first.owner_username || '').localeCompare(second.owner_username || '') * direction;
      }

      return getRunChartLabel(first).localeCompare(getRunChartLabel(second)) * direction;
    });
  }, [filteredRuns, sortDescriptor]);

  const totalPages = Math.max(1, Math.ceil(sortedRuns.length / HELM_RUN_HISTORY_PAGE_SIZE));
  const effectivePage = Math.min(page, totalPages);
  const pagedRuns = sortedRuns.slice(
    (effectivePage - 1) * HELM_RUN_HISTORY_PAGE_SIZE,
    effectivePage * HELM_RUN_HISTORY_PAGE_SIZE
  );
  const visibleStart =
    sortedRuns.length === 0 ? 0 : (effectivePage - 1) * HELM_RUN_HISTORY_PAGE_SIZE + 1;
  const visibleEnd = Math.min(effectivePage * HELM_RUN_HISTORY_PAGE_SIZE, sortedRuns.length);

  if (loading && runs.length === 0) {
    return (
      <Card>
        <Card.Content className="px-5 py-8 text-center text-sm text-muted">
          Loading Helm runs...
        </Card.Content>
      </Card>
    );
  }

  if (error) {
    return (
      <StatusAlert
        status="danger"
        title="Helm runs unavailable"
        description={error}
        action={
          <Button size="sm" variant="secondary" onPress={onRetry}>
            Retry
          </Button>
        }
      />
    );
  }

  const columnCount = isAdmin ? 10 : 9;

  return (
    <>
      <Card className="p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <SearchField
            name="helm-run-search"
            aria-label="Search Helm runs"
            variant="secondary"
            className="w-full sm:max-w-sm"
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search chart, URL, owner, or run ID..."
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>

          <Select
            aria-label="Filter Helm runs by status"
            className="w-full sm:w-[180px]"
            value={statusFilter}
            variant="secondary"
            onChange={(value) => {
              setStatusFilter(
                value === 'running' || value === 'completed' || value === 'failed' ? value : 'all'
              );
              setPage(1);
            }}
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="all">All statuses</ListBox.Item>
                <ListBox.Item id="running">Running</ListBox.Item>
                <ListBox.Item id="completed">Completed</ListBox.Item>
                <ListBox.Item id="failed">Failed</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>Recent Helm runs</Card.Title>
          <Card.Description>Search, filter, and sort recent chart scan runs.</Card.Description>
        </Card.Header>
        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content
              aria-label="Recent Helm runs"
              className="min-w-[680px] md:min-w-[900px]"
              sortDescriptor={sortDescriptor}
              onSortChange={setSortDescriptor}
            >
              <Table.Header>
                <Table.Column id="chart" allowsSorting isRowHeader>
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader sortDirection={sortDirection}>
                      Chart
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
                <Table.Column id="status" allowsSorting>
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader sortDirection={sortDirection}>
                      Status
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
                <Table.Column id="images" allowsSorting className="text-right">
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader sortDirection={sortDirection}>
                      Images
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
                <Table.Column id="completed" allowsSorting className="text-right">
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader sortDirection={sortDirection}>
                      Done
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
                <Table.Column id="failed" allowsSorting className="text-right">
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader sortDirection={sortDirection}>
                      Failed
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
                <Table.Column id="high" allowsSorting className="hidden text-right lg:table-cell">
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader sortDirection={sortDirection}>
                      High
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
                <Table.Column
                  id="critical"
                  allowsSorting
                  className="hidden text-right lg:table-cell"
                >
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader sortDirection={sortDirection}>
                      Critical
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
                <Table.Column id="started" allowsSorting>
                  {({ sortDirection }) => (
                    <Table.SortableColumnHeader sortDirection={sortDirection}>
                      Started
                    </Table.SortableColumnHeader>
                  )}
                </Table.Column>
                {isAdmin ? (
                  <Table.Column id="owner" allowsSorting className="hidden lg:table-cell">
                    {({ sortDirection }) => (
                      <Table.SortableColumnHeader sortDirection={sortDirection}>
                        Owner
                      </Table.SortableColumnHeader>
                    )}
                  </Table.Column>
                ) : null}
                <Table.Column className="text-right">Action</Table.Column>
              </Table.Header>
              <Table.Body>
                {sortedRuns.length === 0 ? (
                  <Table.Row id="empty">
                    <Table.Cell colSpan={columnCount}>
                      <div className="px-4 py-10 text-center text-sm text-muted">
                        {runs.length === 0
                          ? 'No Helm runs yet. Queue one above to start tracking chart history by run ID.'
                          : 'No Helm runs match your search or filter.'}
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ) : (
                  pagedRuns.map((run) => {
                    const status = getRunStatus(run);
                    return (
                      <Table.Row key={run.id} id={run.id} className="hover:bg-[var(--row-hover)]">
                        <Table.Cell>
                          <div className="min-w-0 space-y-1">
                            <Link
                              href={`/helm/runs/${run.id}`}
                              className="block truncate text-sm font-semibold"
                              title={run.chart_name || run.chart_url}
                            >
                              {getRunChartLabel(run)}
                            </Link>
                            <p className="truncate text-xs text-muted" title={run.chart_url}>
                              {run.chart_url.replace(/^oci:\/\//, '')}
                            </p>
                            {run.chart_version ? (
                              <Chip size="sm" variant="secondary">
                                v{run.chart_version}
                              </Chip>
                            ) : null}
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <Chip color={statusColor(status)} size="sm" variant="soft">
                            {status}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell className="text-right font-mono text-xs text-muted">
                          {run.total_images}
                        </Table.Cell>
                        <Table.Cell className="text-right">
                          <Chip
                            color={run.completed_images > 0 ? 'success' : 'default'}
                            size="sm"
                            variant="soft"
                          >
                            {run.completed_images}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell className="text-right">
                          <Chip
                            color={run.failed_images > 0 ? 'danger' : 'default'}
                            size="sm"
                            variant="soft"
                          >
                            {run.failed_images}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell className="hidden text-right lg:table-cell">
                          <Chip
                            color={run.high_count > 0 ? 'warning' : 'default'}
                            size="sm"
                            variant="soft"
                          >
                            {run.high_count}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell className="hidden text-right lg:table-cell">
                          <Chip
                            color={run.critical_count > 0 ? 'danger' : 'default'}
                            size="sm"
                            variant="soft"
                          >
                            {run.critical_count}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell className="text-xs text-muted">
                          {timeAgo(run.created_at)}
                        </Table.Cell>
                        {isAdmin ? (
                          <Table.Cell className="hidden text-xs text-muted lg:table-cell">
                            {run.owner_username || '-'}
                          </Table.Cell>
                        ) : null}
                        <Table.Cell className="text-right">
                          <div className="flex justify-end">
                            <RowActionsMenu
                              label={`Open actions for ${getRunChartLabel(run)}`}
                              items={[
                                {
                                  id: 'open',
                                  label: 'Open run',
                                  icon: <EyeIcon size={15} />,
                                  onAction: () => router.push(`/helm/runs/${run.id}`),
                                },
                                {
                                  id: 'report',
                                  label: 'Generate report',
                                  icon: <FileValidationIcon size={15} />,
                                  disabled: run.active_images > 0 || run.total_images === 0,
                                  onAction: () =>
                                    router.push(
                                      `/reports/print?helmRun=${encodeURIComponent(run.id)}`
                                    ),
                                },
                                {
                                  id: 'share',
                                  label: actionRunId === run.id ? 'Sharing...' : 'Share all scans',
                                  icon: <Share01Icon size={15} />,
                                  disabled:
                                    actionRunId === run.id ||
                                    run.total_images === 0 ||
                                    (run.completed_images === 0 && run.failed_images === 0),
                                  onAction: () => onShareRun(run),
                                },
                                {
                                  id: 'copy-share-link',
                                  label:
                                    actionRunId === run.id
                                      ? 'Preparing link...'
                                      : 'Copy share link',
                                  icon: <CopyLinkIcon size={15} />,
                                  disabled:
                                    actionRunId === run.id ||
                                    run.total_images === 0 ||
                                    (run.completed_images === 0 && run.failed_images === 0),
                                  onAction: () => onCopyShareLink(run),
                                },
                                {
                                  id: 'delete',
                                  label: actionRunId === run.id ? 'Deleting...' : 'Delete run',
                                  icon: <Delete01Icon size={15} />,
                                  variant: 'danger',
                                  disabled: actionRunId === run.id,
                                  onAction: () => onDeleteRun(run),
                                },
                              ]}
                            />
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    );
                  })
                )}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
          <Table.Footer className="grid grid-cols-[1fr_auto_1fr] items-center px-4 py-3 gap-3">
            <span className="text-xs text-muted whitespace-nowrap">
              Showing {visibleStart}-{visibleEnd} of {sortedRuns.length}
            </span>
            <Pagination size="sm" className="justify-self-center">
              <Pagination.Content>
                <Pagination.Item>
                  <Pagination.Previous
                    isDisabled={effectivePage === 1}
                    onPress={() => setPage((previous) => Math.max(1, previous - 1))}
                  >
                    <Pagination.PreviousIcon />
                    <span>Previous</span>
                  </Pagination.Previous>
                </Pagination.Item>
                {Array.from({ length: totalPages }).map((_, index) => {
                  const nextPage = index + 1;
                  return (
                    <Pagination.Item key={nextPage}>
                      <Pagination.Link
                        isActive={nextPage === effectivePage}
                        onPress={() => setPage(nextPage)}
                      >
                        {nextPage}
                      </Pagination.Link>
                    </Pagination.Item>
                  );
                })}
                <Pagination.Item>
                  <Pagination.Next
                    isDisabled={effectivePage === totalPages}
                    onPress={() => setPage((previous) => Math.min(totalPages, previous + 1))}
                  >
                    <span>Next</span>
                    <Pagination.NextIcon />
                  </Pagination.Next>
                </Pagination.Item>
              </Pagination.Content>
            </Pagination>
            <span className="justify-self-end text-xs text-muted whitespace-nowrap">
              {runs.length} total
            </span>
          </Table.Footer>
        </Table>
      </Card>
    </>
  );
}

function StepBar({ current }: { current: Step }) {
  const idx = HELM_CREATION_STEPS.findIndex((step) => step.key === current);

  return (
    <div className="flex items-center gap-2">
      {HELM_CREATION_STEPS.map((step, index) => (
        <div key={step.key} className="flex items-center gap-2">
          <Chip
            color={index <= idx ? 'accent' : 'default'}
            variant={index <= idx ? 'soft' : 'secondary'}
          >
            {index + 1}. {step.label}
          </Chip>
          {index < HELM_CREATION_STEPS.length - 1 && <div className="h-px w-8 bg-border" />}
        </div>
      ))}
    </div>
  );
}
