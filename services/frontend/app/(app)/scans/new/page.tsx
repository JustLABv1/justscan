'use client';

import { useToast } from '@/components/toast';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import {
  heroSelectTriggerClassName,
  joinClassNames,
  nativeFieldClassName,
} from '@/components/ui/form-styles';
import { PageHeader } from '@/components/ui/page-header';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  type ArtifactoryRepository,
  createScans,
  createUploadedArchiveScan,
  getDefaultScannerCapabilities,
  getTokenType,
  getWorkScope,
  listArtifactoryRepositories,
  listOrgs,
  listRegistriesWithCapabilities,
  type Org,
  type RegistryWithHealth,
  type Scan,
  type ScannerCapabilities,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { canMutateOrg } from '@/lib/org-permissions';
import {
  Accordion,
  Autocomplete,
  Button,
  Card,
  Disclosure,
  Label,
  ListBox,
  Radio,
  RadioGroup,
  SearchField,
  Select,
  TextArea,
  useFilter,
} from '@heroui/react';
import { ArrowDown01Icon, ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon } from 'hugeicons-react';
import { useRouter } from 'next/navigation';
import type { Key } from 'react';
import { useEffect, useState } from 'react';

const inputCls = nativeFieldClassName;
const selectTriggerCls = heroSelectTriggerClassName;

type ScanSourceKind = 'public' | 'private_registry' | 'artifactory_xray' | 'local_archive';

function parseImageReferences(value: string) {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mergeUniqueStringLists(...groups: string[][]) {
  const seen = new Set<string>();
  const merged: string[] = [];

  groups.flat().forEach((value) => {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  });

  return merged;
}

function ScanSourceCard({
  description,
  disabled = false,
  eyebrow,
  source,
  title,
}: {
  description: string;
  disabled?: boolean;
  eyebrow: string;
  source: ScanSourceKind;
  title: string;
}) {
  return (
    <Radio
      className="group w-full cursor-pointer rounded-2xl border border-surface-border bg-surface-secondary px-4 py-3 text-left transition-all duration-150 data-[selected=true]:border-accent/35 data-[selected=true]:bg-accent/10 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-60"
      isDisabled={disabled}
      value={source}
    >
      <Radio.Content className="min-w-0 flex-1">
        <Radio.Control
          className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-slate-300/50 bg-slate-400/10 group-data-[selected=true]:border-accent/40 group-data-[selected=true]:bg-accent/20"
          aria-hidden
        >
          <Radio.Indicator className="text-[11px] font-semibold text-accent">
            {({ isSelected }) => (isSelected ? '✓' : null)}
          </Radio.Indicator>
        </Radio.Control>
        <p className="text-[10px] uppercase tracking-[0.2em] text-accent">{eyebrow}</p>
        <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">{title}</p>
        <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{description}</p>
      </Radio.Content>
    </Radio>
  );
}

function ScanSection({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description?: React.ReactNode;
  title: string;
}) {
  return (
    <Card className="surface-panel rounded-2xl p-5">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">{title}</h2>
          {description ? (
            <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">{description}</p>
          ) : null}
        </div>
        {children}
      </div>
    </Card>
  );
}

function ScanWizardField({
  children,
  description,
  label,
  optional = false,
}: {
  children: React.ReactNode;
  description?: React.ReactNode;
  label: string;
  optional?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
        {label}{' '}
        {optional ? (
          <span className="font-normal text-zinc-400 dark:text-zinc-600">(optional)</span>
        ) : null}
      </Label>
      {children}
      {description ? <p className="text-xs text-zinc-500">{description}</p> : null}
    </div>
  );
}

export default function NewScanPage() {
  const { contains } = useFilter({ sensitivity: 'base' });
  const router = useRouter();
  const toast = useToast();
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';

  const [imageName, setImageName] = useState('');
  const [imageTag, setImageTag] = useState('latest');
  const [additionalImageDraft, setAdditionalImageDraft] = useState('');
  const [additionalImageEntries, setAdditionalImageEntries] = useState<string[]>([]);
  const [scanSource, setScanSource] = useState<ScanSourceKind | null>(null);
  const [isSourceExpanded, setIsSourceExpanded] = useState(true);
  const [optionalSettingsExpanded, setOptionalSettingsExpanded] = useState(false);
  const [platform, setPlatform] = useState('');
  const [uploadedArchiveFile, setUploadedArchiveFile] = useState<File | null>(null);
  const [registryId, setRegistryId] = useState('');
  const [xrayRepository, setXrayRepository] = useState('');
  const [useManualXrayRepository, setUseManualXrayRepository] = useState(false);
  const [artifactoryRepositoriesByRegistry, setArtifactoryRepositoriesByRegistry] = useState<
    Record<string, ArtifactoryRepository[]>
  >({});
  const [artifactoryRepositoriesLoading, setArtifactoryRepositoriesLoading] = useState<
    string | null
  >(null);
  const [artifactoryRepositoriesErrorByRegistry, setArtifactoryRepositoriesErrorByRegistry] =
    useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [registries, setRegistries] = useState<RegistryWithHealth[]>([]);
  const [scopedOrgPolicy, setScopedOrgPolicy] = useState<Org | null>(null);
  const [capabilities, setCapabilities] = useState<ScannerCapabilities>(
    getDefaultScannerCapabilities()
  );

  const isPlatformAdmin = getTokenType() === 'admin';

  useEffect(() => {
    listRegistriesWithCapabilities()
      .then((response) => {
        setRegistries(response.data);
        setCapabilities(response.capabilities);
        const defaultReg = response.data.find((registry) => registry.is_default);
        if (defaultReg) {
          setRegistryId((previous) => previous || defaultReg.id);
        }
      })
      .catch(() => {});
  }, [scopeKey]);

  useEffect(() => {
    let cancelled = false;

    const loadScopedOrgPolicy = async () => {
      if (workScope.kind !== 'org') {
        if (!cancelled) {
          setScopedOrgPolicy(null);
        }
        return;
      }

      listOrgs()
        .then((orgs) => {
          if (cancelled) return;
          setScopedOrgPolicy(orgs.find((org) => org.id === workScope.orgId) ?? null);
        })
        .catch(() => {
          if (cancelled) return;
          setScopedOrgPolicy(null);
        });
    };

    void loadScopedOrgPolicy();

    return () => {
      cancelled = true;
    };
  }, [scopeKey, workScope]);

  const selectableRegistries = registries.filter(
    (registry) => registry.scan_provider === 'artifactory_xray' || capabilities.enable_trivy
  );
  const privateRegistries = selectableRegistries.filter(
    (registry) => registry.scan_provider !== 'artifactory_xray'
  );
  const xrayRegistries = registries.filter(
    (registry) => registry.scan_provider === 'artifactory_xray'
  );
  const xrayOnlyWithoutRegistries = !capabilities.enable_trivy && selectableRegistries.length === 0;
  const canMutateCurrentScope =
    isPlatformAdmin ||
    workScope.kind !== 'org' ||
    !scopedOrgPolicy ||
    canMutateOrg(scopedOrgPolicy.current_user_role);
  const orgFeatureBlockMessage =
    workScope.kind !== 'org' || !scopedOrgPolicy
      ? ''
      : !scopedOrgPolicy.is_active
        ? 'Organization is suspended. Scan creation is disabled.'
        : scanSource === 'artifactory_xray'
          ? scopedOrgPolicy.allow_helm_scans
            ? ''
            : 'Helm/Xray scans are disabled for this organization.'
          : scopedOrgPolicy.allow_image_scans
            ? ''
            : 'Image scans are disabled for this organization.';
  const pendingAdditionalImages = parseImageReferences(additionalImageDraft);
  const primaryImage = imageName.trim()
    ? `${imageName.trim()}${imageTag.trim() ? `:${imageTag.trim()}` : ''}`
    : '';
  const requestedImages = mergeUniqueStringLists(
    primaryImage ? [primaryImage] : [],
    additionalImageEntries,
    pendingAdditionalImages
  );
  const selectedRegistry = registries.find((registry) => registry.id === registryId) ?? null;
  const selectedRegistryIsXray =
    scanSource === 'artifactory_xray' && selectedRegistry?.scan_provider === 'artifactory_xray';
  const selectedRegistryRepositories = selectedRegistry
    ? (artifactoryRepositoriesByRegistry[selectedRegistry.id] ?? [])
    : [];
  const selectedRegistryRepositoriesError = selectedRegistry
    ? (artifactoryRepositoriesErrorByRegistry[selectedRegistry.id] ?? '')
    : '';
  const xrayRepositoryAutocompleteValue =
    useManualXrayRepository ||
    (xrayRepository &&
      !selectedRegistryRepositories.some((repository) => repository.key === xrayRepository))
      ? '__manual__'
      : xrayRepository || '__none__';
  const scanSourceOptions = [
    {
      source: 'public' as const,
      eyebrow: 'Fastest path',
      title: 'Public registry image',
      description: 'Scan an image from Docker Hub or any unauthenticated registry endpoint.',
      disabled: !capabilities.enable_trivy,
    },
    {
      source: 'private_registry' as const,
      eyebrow: 'Auth required',
      title: 'Private registry image',
      description: 'Use one of your configured registries so JustScan can authenticate and pull.',
      disabled: !capabilities.enable_trivy || privateRegistries.length === 0,
    },
    {
      source: 'artifactory_xray' as const,
      eyebrow: 'Xray pipeline',
      title: 'Artifactory Xray image',
      description:
        'Route the image through a configured Artifactory/Xray registry and optional repo override.',
      disabled: xrayRegistries.length === 0,
    },
    {
      source: 'local_archive' as const,
      eyebrow: 'Offline input',
      title: 'Local OCI/Docker archive',
      description:
        'Upload a tarball created from docker save or an OCI archive for one-off inspection.',
      disabled: !capabilities.enable_trivy,
    },
  ];
  const availableScanSourceOptions = scanSourceOptions.filter((option) => !option.disabled);

  function selectScanSource(source: ScanSourceKind) {
    setScanSource(source);
    setIsSourceExpanded(false);
    setCreateError('');

    if (source === 'public') {
      setRegistryId('');
      setXrayRepository('');
      setUseManualXrayRepository(false);
      return;
    }

    if (source === 'private_registry') {
      const nextRegistry =
        privateRegistries.find((registry) => registry.id === registryId) ??
        privateRegistries.find((registry) => registry.is_default) ??
        privateRegistries[0] ??
        null;
      setRegistryId(nextRegistry?.id ?? '');
      setXrayRepository('');
      setUseManualXrayRepository(false);
      return;
    }

    if (source === 'local_archive') {
      setRegistryId('');
      setXrayRepository('');
      setUseManualXrayRepository(false);
      return;
    }

    const nextRegistry =
      xrayRegistries.find((registry) => registry.id === registryId) ??
      xrayRegistries.find((registry) => registry.is_default) ??
      xrayRegistries[0] ??
      null;
    setRegistryId(nextRegistry?.id ?? '');
    setXrayRepository(nextRegistry?.xray_repository ?? '');
    setUseManualXrayRepository(false);
  }

  function validateCreateForm() {
    if (!scanSource) {
      return 'Choose where this image is hosted to continue.';
    }
    if (scanSource === 'public' && !capabilities.enable_trivy) {
      return 'Public Docker Hub scans are unavailable in this deployment.';
    }
    if (scanSource === 'private_registry' && !capabilities.enable_trivy) {
      return 'Private registry scans are unavailable because local Trivy scanning is disabled.';
    }
    if (scanSource === 'private_registry' && privateRegistries.length === 0) {
      return 'Add a private registry first, or choose a different source.';
    }
    if (scanSource === 'private_registry' && !registryId) {
      return 'Choose the private registry that hosts this image.';
    }
    if (scanSource === 'artifactory_xray' && xrayRegistries.length === 0) {
      return 'Add an Artifactory Xray registry first, or choose a different source.';
    }
    if (scanSource === 'artifactory_xray' && !registryId) {
      return 'Choose the Artifactory registry that should route this scan.';
    }
    if (scanSource === 'local_archive' && !capabilities.enable_trivy) {
      return 'Local archive scans are unavailable because Trivy scanning is disabled.';
    }
    if (scanSource === 'local_archive' && !uploadedArchiveFile) {
      return 'Upload an OCI/Docker archive file to continue.';
    }
    if (scanSource !== 'local_archive' && requestedImages.length === 0) {
      return 'Provide at least one image to scan.';
    }

    return '';
  }

  useEffect(() => {
    return deferEffect(() => {
      if (!selectedRegistryIsXray || !selectedRegistry) {
        setXrayRepository('');
        setUseManualXrayRepository(false);
        return;
      }

      setXrayRepository(selectedRegistry.xray_repository ?? '');
      setUseManualXrayRepository(false);

      if (
        artifactoryRepositoriesByRegistry[selectedRegistry.id] ||
        artifactoryRepositoriesErrorByRegistry[selectedRegistry.id] ||
        artifactoryRepositoriesLoading === selectedRegistry.id
      ) {
        return;
      }

      setArtifactoryRepositoriesLoading(selectedRegistry.id);
      setArtifactoryRepositoriesErrorByRegistry((previous) => {
        const next = { ...previous };
        delete next[selectedRegistry.id];
        return next;
      });

      void listArtifactoryRepositories(selectedRegistry.id)
        .then((repositories) => {
          setArtifactoryRepositoriesByRegistry((previous) => ({
            ...previous,
            [selectedRegistry.id]: repositories,
          }));
        })
        .catch((repositoryError: unknown) => {
          setArtifactoryRepositoriesErrorByRegistry((previous) => ({
            ...previous,
            [selectedRegistry.id]:
              repositoryError instanceof Error
                ? repositoryError.message
                : 'Failed to load Artifactory repositories',
          }));
        })
        .finally(() => {
          setArtifactoryRepositoriesLoading((current) =>
            current === selectedRegistry.id ? null : current
          );
        });
    });
  }, [
    artifactoryRepositoriesByRegistry,
    artifactoryRepositoriesErrorByRegistry,
    artifactoryRepositoriesLoading,
    selectedRegistry,
    selectedRegistryIsXray,
  ]);

  function addAdditionalImagesFromDraft() {
    const parsedImages = parseImageReferences(additionalImageDraft);
    if (parsedImages.length === 0) return;

    setAdditionalImageEntries((previous) => mergeUniqueStringLists(previous, parsedImages));
    setAdditionalImageDraft('');
  }

  function removeAdditionalImageEntry(image: string) {
    setAdditionalImageEntries((previous) => previous.filter((entry) => entry !== image));
  }

  async function handleCreate(e: React.FormEvent) {
    if (!canMutateCurrentScope) return;
    e.preventDefault();
    setCreateError('');
    setCreating(true);

    try {
      if (xrayOnlyWithoutRegistries) {
        setCreateError(
          'No Artifactory Xray registry is configured yet. Add one before starting scans.'
        );
        return;
      }
      if (orgFeatureBlockMessage) {
        setCreateError(orgFeatureBlockMessage);
        return;
      }

      const validationError = validateCreateForm();
      if (validationError) {
        setCreateError(validationError);
        return;
      }

      const currentScope = getWorkScope();
      let createdScans: Scan[] = [];

      if (scanSource === 'local_archive') {
        if (!uploadedArchiveFile) {
          setCreateError('Upload an OCI/Docker archive file to continue.');
          return;
        }

        const created = await createUploadedArchiveScan({
          archive: uploadedArchiveFile,
          imageName: imageName.trim() || undefined,
          imageTag: imageTag.trim() || undefined,
          platform: platform || undefined,
          orgId: currentScope.kind === 'org' ? currentScope.orgId : undefined,
        });
        createdScans = [created];
      } else {
        const result = await createScans(
          requestedImages,
          scanSource === 'public' ? undefined : registryId || undefined,
          undefined,
          platform || undefined,
          currentScope.kind === 'org' ? currentScope.orgId : undefined,
          selectedRegistryIsXray ? xrayRepository.trim() || undefined : undefined
        );
        createdScans = Array.isArray(result.scans) ? result.scans : [];
      }

      toast.success(`${createdScans.length} image${createdScans.length === 1 ? '' : 's'} queued`);
      const firstCreatedScanId = createdScans[0]?.id;

      if (firstCreatedScanId) {
        router.push(`/scans/${firstCreatedScanId}`);
        return;
      }

      router.push('/scans');
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create scan');
    } finally {
      setCreating(false);
    }
  }

  const hasRoutingSection = scanSource === 'private_registry' || scanSource === 'artifactory_xray';
  const scanSourceLabel =
    scanSource === 'artifactory_xray'
      ? 'Artifactory Xray'
      : scanSource === 'private_registry'
        ? 'Private registry'
        : scanSource === 'local_archive'
          ? 'Local archive'
          : scanSource === 'public'
            ? 'Public / Docker Hub'
            : 'Select a source';
  const targetSummary =
    scanSource === 'local_archive'
      ? uploadedArchiveFile?.name || 'Archive upload'
      : primaryImage ||
        (requestedImages.length > 0 ? `${requestedImages.length} image targets` : 'No target yet');
  const routingSummary =
    scanSource === 'public' || scanSource === 'local_archive'
      ? 'Direct'
      : selectedRegistry?.name || 'Not selected';
  const sourceAccordionExpandedKeys = isSourceExpanded ? ['scan-source-section'] : [];

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="New Scan"
        description="Choose a source, define the target, and start a scan without leaving your current workspace scope."
        actions={
          <Button
            onPress={() => router.push('/scans')}
            variant="secondary"
            className="inline-flex items-center gap-2"
          >
            <ArrowLeft01Icon size={15} />
            Back to Scans
          </Button>
        }
      />

      <form onSubmit={handleCreate} className="space-y-4">
        {createError ? <FormAlert description={createError} title="Scan creation failed" /> : null}
        {!createError && orgFeatureBlockMessage ? (
          <FormAlert
            title="Scan creation disabled"
            description={orgFeatureBlockMessage}
            status="warning"
          />
        ) : null}

        <Card className="surface-panel overflow-hidden rounded-2xl">
          <Accordion
            hideSeparator
            className="bg-transparent"
            expandedKeys={sourceAccordionExpandedKeys}
            onExpandedChange={(keys) => setIsSourceExpanded(keys.has('scan-source-section'))}
            variant="surface"
          >
            <Accordion.Item className="bg-transparent" id="scan-source-section">
              <Accordion.Heading>
                <Accordion.Trigger className="flex items-start gap-4 px-5 py-5 text-left transition-colors hover:bg-surface-secondary/60">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-3">
                      <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
                        Source
                      </h2>
                      {scanSource && !isSourceExpanded ? (
                        <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent">
                          {scanSourceLabel}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                      {scanSource && !isSourceExpanded
                        ? 'Selected source is locked in for now. Reopen this section to change it.'
                        : 'Choose where the image lives. JustScan will only show the routing controls that matter for that source.'}
                    </p>
                  </div>
                  <Accordion.Indicator className="mt-1 shrink-0 text-zinc-400">
                    <ArrowDown01Icon size={16} />
                  </Accordion.Indicator>
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body className="px-5 pb-5 pt-0">
                  <div className="space-y-4">
                    <RadioGroup
                      className="grid gap-3"
                      name="scan-source"
                      onChange={(value) => selectScanSource(String(value) as ScanSourceKind)}
                      value={scanSource}
                    >
                      {scanSourceOptions.map((option) => (
                        <ScanSourceCard
                          key={option.source}
                          description={option.description}
                          disabled={option.disabled}
                          eyebrow={option.eyebrow}
                          source={option.source}
                          title={option.title}
                        />
                      ))}
                    </RadioGroup>
                    {availableScanSourceOptions.length === 0 ? (
                      <p className="text-sm text-zinc-500">
                        No scan source is currently available in this deployment.
                      </p>
                    ) : null}
                    {privateRegistries.length === 0 || xrayRegistries.length === 0 ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-border bg-surface-secondary px-3 py-3">
                        <p className="text-sm text-muted">
                          Private and Artifactory scan routes become available after their registry
                          is configured.
                        </p>
                        <Button
                          onPress={() => router.push('/registries')}
                          size="sm"
                          variant="secondary"
                        >
                          Manage registries
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Card>

        {scanSource ? (
          <ScanSection
            title="Target"
            description={
              scanSource === 'local_archive'
                ? 'Upload the archive and optionally set a friendlier display name.'
                : 'Use a single image or queue several references in one run.'
            }
          >
            {scanSource === 'local_archive' ? (
              <ScanWizardField label="OCI/Docker archive">
                <div className="rounded-2xl border border-dashed border-surface-border bg-surface-secondary px-4 py-4">
                  <input
                    accept=".tar,.tgz,.tar.gz,.oci"
                    className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-xl file:border-0 file:bg-accent file:px-3 file:py-2 file:font-medium file:text-white hover:file:opacity-90 dark:text-zinc-300"
                    onChange={(e) => setUploadedArchiveFile(e.target.files?.[0] ?? null)}
                    type="file"
                  />
                  {uploadedArchiveFile ? (
                    <p className="mt-3 text-xs text-zinc-500">
                      Selected: {uploadedArchiveFile.name}
                    </p>
                  ) : null}
                </div>
              </ScanWizardField>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                className="font-mono"
                label={scanSource === 'local_archive' ? 'Display name' : 'Image name'}
                onChange={(e) => setImageName(e.target.value)}
                placeholder={
                  scanSource === 'artifactory_xray' ? 'n8nio/n8n' : 'ghcr.io/example/api'
                }
                required={scanSource !== 'local_archive'}
                value={imageName}
              />
              <FormField
                className="font-mono"
                label="Tag"
                onChange={(e) => setImageTag(e.target.value)}
                placeholder="latest"
                required={scanSource !== 'local_archive'}
                value={imageTag}
              />
            </div>
          </ScanSection>
        ) : null}

        {scanSource && hasRoutingSection ? (
          <ScanSection
            title="Routing"
            description={
              scanSource === 'private_registry'
                ? 'Choose the configured registry that should authenticate and pull this image.'
                : 'Choose the Xray-backed registry first, then optionally add a repo override for mirrors or remotes.'
            }
          >
            {scanSource === 'private_registry' ? (
              <ScanWizardField label="Private registry">
                <Select
                  value={registryId || '__none__'}
                  onChange={(value) =>
                    setRegistryId(String(value === '__none__' ? '' : (value ?? '')))
                  }
                >
                  <Select.Trigger className={selectTriggerCls}>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {privateRegistries.map((registry) => (
                        <ListBox.Item key={registry.id} id={registry.id}>
                          {registry.name}
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </ScanWizardField>
            ) : null}

            {scanSource === 'artifactory_xray' ? (
              <div className="space-y-4">
                <ScanWizardField label="Artifactory registry">
                  <Select
                    value={registryId || '__none__'}
                    onChange={(value) =>
                      setRegistryId(String(value === '__none__' ? '' : (value ?? '')))
                    }
                  >
                    <Select.Trigger className={selectTriggerCls}>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {xrayRegistries.map((registry) => (
                          <ListBox.Item key={registry.id} id={registry.id}>
                            {registry.name}
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </ScanWizardField>

                <ScanWizardField
                  label="Repo override"
                  optional
                  description={
                    <>
                      Pick a repo like <span className="font-mono">docker-remote</span> so you can
                      scan <span className="font-mono">n8nio/n8n</span> instead of typing{' '}
                      <span className="font-mono">docker-remote/n8nio/n8n</span>.
                    </>
                  }
                >
                  <Autocomplete
                    value={xrayRepositoryAutocompleteValue}
                    onChange={(key: Key | null) => {
                      const value = String(key ?? '__none__');
                      if (value === '__manual__') {
                        setUseManualXrayRepository(true);
                        return;
                      }
                      setUseManualXrayRepository(false);
                      setXrayRepository(value === '__none__' ? '' : value);
                    }}
                  >
                    <Autocomplete.Trigger className="bg-surface-secondary">
                      <Autocomplete.Value />
                      <Autocomplete.ClearButton />
                      <Autocomplete.Indicator />
                    </Autocomplete.Trigger>
                    <Autocomplete.Popover>
                      <Autocomplete.Filter filter={contains}>
                        <SearchField name="artifactory-repo-search" variant="secondary">
                          <SearchField.Group>
                            <SearchField.SearchIcon />
                            <SearchField.Input placeholder="Search Artifactory repos..." />
                            <SearchField.ClearButton />
                          </SearchField.Group>
                        </SearchField>
                        <ListBox
                          renderEmptyState={() => (
                            <div className="px-3 py-2 text-sm text-zinc-500">
                              No matching repositories
                            </div>
                          )}
                        >
                          <ListBox.Item id="__none__" textValue="No repo override">
                            No repo override
                          </ListBox.Item>
                          {selectedRegistryRepositories.map((repository) => (
                            <ListBox.Item
                              key={repository.key}
                              id={repository.key}
                              textValue={`${repository.key} ${repository.class ?? ''}`.trim()}
                            >
                              {repository.key}
                              {repository.class ? ` · ${repository.class}` : ''}
                            </ListBox.Item>
                          ))}
                          <ListBox.Item id="__manual__" textValue="Enter manually">
                            Enter manually
                          </ListBox.Item>
                        </ListBox>
                      </Autocomplete.Filter>
                    </Autocomplete.Popover>
                  </Autocomplete>
                  {selectedRegistry && artifactoryRepositoriesLoading === selectedRegistry.id ? (
                    <p className="text-xs text-zinc-500">Loading available Artifactory repos…</p>
                  ) : null}
                  {selectedRegistryRepositoriesError ? (
                    <p className="text-xs" style={{ color: '#f59e0b' }}>
                      {selectedRegistryRepositoriesError}. You can still enter the repo manually.
                    </p>
                  ) : null}
                  {useManualXrayRepository || !!selectedRegistryRepositoriesError ? (
                    <FormField
                      className="font-mono"
                      description="Manual fallback when the repo list is unavailable or you need a repo key that is not listed."
                      label="Manual repo override"
                      onChange={(event) => setXrayRepository(event.target.value)}
                      placeholder="docker-remote"
                      value={xrayRepository}
                    />
                  ) : null}
                </ScanWizardField>
              </div>
            ) : null}
          </ScanSection>
        ) : null}

        {scanSource ? (
          <Disclosure
            isExpanded={optionalSettingsExpanded}
            onExpandedChange={setOptionalSettingsExpanded}
            className="surface-panel overflow-hidden rounded-2xl"
          >
            <Disclosure.Heading>
              <Disclosure.Trigger className="flex w-full items-start justify-between gap-4 px-5 py-5 text-left transition-colors hover:bg-surface-secondary/60">
                <div className="min-w-0 space-y-1.5">
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
                    Optional settings
                  </h2>
                  <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                    Add more image targets or pin a platform only when you need to.
                  </p>
                </div>
                <Disclosure.Indicator className="mt-1 shrink-0 text-zinc-400">
                  <ArrowDown01Icon size={16} />
                </Disclosure.Indicator>
              </Disclosure.Trigger>
            </Disclosure.Heading>
            <Disclosure.Content>
              <Disclosure.Body className="border-t border-surface-border px-5 py-5">
                <div className="space-y-4">
                  {scanSource !== 'local_archive' ? (
                    <ScanWizardField
                      description="Paste one or many full image references, separated by commas or new lines. Anything still in this box is included when you start the scan."
                      label="Queue more images"
                      optional
                    >
                      <TextArea
                        className={joinClassNames(inputCls, 'min-h-24 bg-surface resize-y')}
                        placeholder={
                          'ghcr.io/example/api:1.2.3\nregistry.example.com/team/worker:latest'
                        }
                        value={additionalImageDraft}
                        onChange={(e) => setAdditionalImageDraft(e.target.value)}
                      />
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="shrink-0"
                          onPress={addAdditionalImagesFromDraft}
                        >
                          Add{' '}
                          {pendingAdditionalImages.length > 1
                            ? `${pendingAdditionalImages.length} refs`
                            : 'to list'}
                        </Button>
                      </div>
                      {additionalImageEntries.length > 0 ? (
                        <div
                          className="rounded-2xl p-3"
                          style={{
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid var(--surface-border)',
                          }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-medium text-zinc-500">
                              Queued image targets
                            </p>
                            <span
                              className="rounded-full px-2 py-0.5 text-xs font-medium text-zinc-500"
                              style={{
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid var(--surface-border)',
                              }}
                            >
                              {additionalImageEntries.length}
                            </span>
                          </div>
                          <div className="mt-3 max-h-40 space-y-2 overflow-y-auto pr-1">
                            {additionalImageEntries.map((image) => (
                              <div
                                key={image}
                                className="flex items-start justify-between gap-3 rounded-xl px-3 py-2"
                                style={{
                                  background: 'rgba(255,255,255,0.03)',
                                  border: '1px solid var(--surface-border)',
                                }}
                              >
                                <span className="min-w-0 break-all font-mono text-xs text-zinc-600 dark:text-zinc-300">
                                  {image}
                                </span>
                                <button
                                  aria-label={`Remove ${image}`}
                                  className="btn-icon-subtle size-8 shrink-0 rounded-lg"
                                  onClick={() => removeAdditionalImageEntry(image)}
                                  type="button"
                                >
                                  <Cancel01Icon aria-hidden size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </ScanWizardField>
                  ) : null}

                  <ScanWizardField label="Platform" optional>
                    <Select
                      value={platform || '__auto__'}
                      onChange={(value) =>
                        setPlatform(String(value === '__auto__' ? '' : (value ?? '')))
                      }
                      variant="secondary"
                    >
                      <Label className="sr-only">Platform</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="__auto__">Auto-detect</ListBox.Item>
                          <ListBox.Item id="linux/amd64">linux/amd64</ListBox.Item>
                          <ListBox.Item id="linux/arm64">linux/arm64</ListBox.Item>
                          <ListBox.Item id="linux/arm/v7">linux/arm/v7</ListBox.Item>
                          <ListBox.Item id="linux/arm/v6">linux/arm/v6</ListBox.Item>
                          <ListBox.Item id="linux/386">linux/386</ListBox.Item>
                          <ListBox.Item id="linux/s390x">linux/s390x</ListBox.Item>
                          <ListBox.Item id="linux/ppc64le">linux/ppc64le</ListBox.Item>
                          <ListBox.Item id="windows/amd64">windows/amd64</ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </ScanWizardField>
                </div>
              </Disclosure.Body>
            </Disclosure.Content>
          </Disclosure>
        ) : null}

        {scanSource ? (
          <Card className="surface-panel rounded-2xl p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Source</p>
                <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                  {scanSourceLabel}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Target</p>
                <p className="truncate text-sm font-semibold text-zinc-900 dark:text-white">
                  {targetSummary}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Routing</p>
                <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                  {routingSummary}
                </p>
              </div>
            </div>
          </Card>
        ) : null}

        <div className="flex items-center justify-end">
          <Button
            type="submit"
            isDisabled={
              creating ||
              !canMutateCurrentScope ||
              xrayOnlyWithoutRegistries ||
              Boolean(orgFeatureBlockMessage)
            }
            variant="primary"
            className="inline-flex items-center gap-2"
          >
            {creating ? (
              <div className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <ArrowRight01Icon size={16} />
            )}
            {creating ? 'Starting scan…' : 'Start Scan'}
          </Button>
        </div>
      </form>
    </div>
  );
}
