'use client';

import { useToast } from '@/components/toast';
import { FormAlert, StatusAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import {
  fieldSelectTriggerClassName,
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
  Button,
  Card,
  Disclosure,
  Label,
  ListBox,
  FileDropzone,
  Input,
  Select,
  SearchableSelect,
  TextArea,
} from '@/components/ui';
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CloudUploadIcon,
  DatabaseSyncIcon,
  Globe02Icon,
  LockIcon,
} from 'hugeicons-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChoiceCards } from '@/components/panelui/choice-cards';
import { useEffect, useRef, useState } from 'react';

const inputCls = nativeFieldClassName;
const selectTriggerCls = fieldSelectTriggerClassName;

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

const DIGEST_REFERENCE_PATTERN = /^[A-Za-z][A-Za-z0-9+._-]*:[0-9a-fA-F]{32,}$/;

function buildPrimaryImageReference(imageName: string, tagOrDigest: string) {
  const name = imageName.trim();
  const reference = tagOrDigest.trim().replace(/^@/, '');

  if (!name) return '';
  if (name.includes('@')) return name;
  if (!reference) return name;
  if (DIGEST_REFERENCE_PATTERN.test(reference)) return `${name}@${reference}`;
  return `${name}:${reference}`;
}

function ScanSection({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description?: React.ReactNode;
  title?: string;
}) {
  return (
    <Card className="surface-panel rounded-xl p-5">
      <div className="space-y-4">
        <div className="space-y-1.5">
          {title ? <h2 className="text-base font-semibold text-foreground">{title}</h2> : null}
          {description ? (
            <p className="text-sm leading-6 text-muted-foreground dark:text-foreground">
              {description}
            </p>
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
      <Label className="text-sm font-medium text-muted-foreground dark:text-foreground">
        {label}{' '}
        {optional ? <span className="font-normal text-muted-foreground">(optional)</span> : null}
      </Label>
      {children}
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export default function NewScanPage() {
  const router = useRouter();
  const toast = useToast();
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';

  const [imageName, setImageName] = useState('');
  const [imageTag, setImageTag] = useState('latest');
  const [additionalImageDraft, setAdditionalImageDraft] = useState('');
  const [additionalImageEntries, setAdditionalImageEntries] = useState<string[]>([]);
  const [scanSource, setScanSource] = useState<ScanSourceKind | null>(null);
  const sourceChosenManually = useRef(false);
  const [detectedRegistryName, setDetectedRegistryName] = useState('');
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
  const [scopedOrgPolicyError, setScopedOrgPolicyError] = useState('');
  const [capabilities, setCapabilities] = useState<ScannerCapabilities>(() =>
    getDefaultScannerCapabilities()
  );
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(true);
  const [capabilitiesError, setCapabilitiesError] = useState('');
  const [capabilitiesRetryKey, setCapabilitiesRetryKey] = useState(0);

  const isPlatformAdmin = getTokenType() === 'admin';

  useEffect(() => {
    let cancelled = false;
    listRegistriesWithCapabilities()
      .then((response) => {
        if (cancelled) return;
        setCapabilitiesError('');
        setRegistries(response.data);
        setCapabilities(response.capabilities);
        const defaultReg = response.data.find((registry) => registry.is_default);
        if (defaultReg) {
          setRegistryId((previous) => previous || defaultReg.id);
        }
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setCapabilitiesError(
          reason instanceof Error ? reason.message : 'Failed to load scanner capabilities'
        );
      })
      .finally(() => {
        if (!cancelled) setCapabilitiesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [capabilitiesRetryKey, scopeKey]);

  useEffect(() => {
    let cancelled = false;

    const loadScopedOrgPolicy = async () => {
      if (workScope.kind !== 'org') {
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
        .catch((reason: unknown) => {
          if (cancelled) return;
          setScopedOrgPolicy(null);
          setScopedOrgPolicyError(
            reason instanceof Error ? reason.message : 'Failed to load organization policy'
          );
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
  const primaryImage = buildPrimaryImageReference(imageName, imageTag);
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
  const scanSourceOptions = [
    {
      source: 'public' as const,
      shortLabel: 'Public',
      metadata: 'No auth',
      title: 'Public registry',
      description: 'Docker Hub or any open registry',
      disabled: !capabilities.enable_trivy,
      disabledReason: !capabilities.enable_trivy ? 'Unavailable here' : '',
      icon: <Globe02Icon aria-hidden size={18} />,
    },
    {
      source: 'private_registry' as const,
      shortLabel: 'Private registry',
      metadata: 'Credentials',
      title: 'Private registry',
      description: 'One of your configured registries',
      disabled: !capabilities.enable_trivy || privateRegistries.length === 0,
      disabledReason: !capabilities.enable_trivy
        ? 'Unavailable here'
        : privateRegistries.length === 0
          ? 'Add a registry first'
          : '',
      icon: <LockIcon aria-hidden size={18} />,
    },
    {
      source: 'artifactory_xray' as const,
      shortLabel: 'Artifactory Xray',
      metadata: 'Xray',
      title: 'Artifactory Xray',
      description: 'Through Artifactory and Xray',
      disabled: xrayRegistries.length === 0,
      disabledReason: xrayRegistries.length === 0 ? 'Add an Xray registry first' : '',
      icon: <DatabaseSyncIcon aria-hidden size={18} />,
    },
    {
      source: 'local_archive' as const,
      shortLabel: 'Upload archive',
      metadata: 'Upload',
      title: 'Local archive',
      description: 'A docker save or OCI tarball',
      disabled: !capabilities.enable_trivy,
      disabledReason: !capabilities.enable_trivy ? 'Unavailable here' : '',
      icon: <CloudUploadIcon aria-hidden size={18} />,
    },
  ];
  const availableScanSourceOptions = scanSourceOptions.filter((option) => !option.disabled);

  function selectScanSource(source: ScanSourceKind) {
    setScanSource(source);
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

  function chooseScanSource(source: ScanSourceKind) {
    sourceChosenManually.current = true;
    setDetectedRegistryName('');
    selectScanSource(source);
  }

  function registryHost(url: string) {
    return url
      .replace(/^[a-z]+:\/\//i, '')
      .split('/')[0]
      .toLowerCase();
  }

  function handleImageInput(value: string) {
    setImageName(value);
    setImageTag('');
    if (sourceChosenManually.current || scanSource === 'local_archive') return;

    const first = value.trim().split('/')[0] ?? '';
    const hasHost = value.includes('/') && (first.includes('.') || first.includes(':'));
    const match = hasHost
      ? privateRegistries.find((registry) => registryHost(registry.url) === first.toLowerCase())
      : undefined;
    if (match) {
      setScanSource('private_registry');
      setRegistryId(match.id);
      setDetectedRegistryName(match.name);
    } else if (detectedRegistryName) {
      setDetectedRegistryName('');
      selectScanSource('public');
    }
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
    if (capabilitiesLoading || scanSource !== null) return;
    return deferEffect(() => {
      const first = scanSourceOptions.find((option) => !option.disabled);
      if (first && !sourceChosenManually.current) selectScanSource(first.source);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capabilitiesLoading, scanSource, registries, capabilities]);

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
    e.preventDefault();
    setCreateError('');

    if (!canMutateCurrentScope) return;
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

    setCreating(true);
    try {
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
        router.push(`/scans/details/${firstCreatedScanId}`);
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
  const canStartScan =
    !creating &&
    !capabilitiesLoading &&
    !capabilitiesError &&
    canMutateCurrentScope &&
    !xrayOnlyWithoutRegistries &&
    !orgFeatureBlockMessage &&
    validateCreateForm() === '';
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <PageHeader
        title="New Scan"
        description="Enter an image and start scanning. The source is detected for you."
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
        {capabilitiesLoading ? (
          <StatusAlert
            title="Loading scanner capabilities"
            description="Checking available scan routes…"
          />
        ) : null}
        {capabilitiesError ? (
          <StatusAlert
            status="danger"
            title="Scanner capabilities unavailable"
            description={capabilitiesError}
            action={
              <Button
                size="sm"
                variant="secondary"
                onPress={() => {
                  setCapabilitiesError('');
                  setCapabilitiesLoading(true);
                  setCapabilitiesRetryKey((current) => current + 1);
                }}
              >
                Retry
              </Button>
            }
          />
        ) : null}
        {scopedOrgPolicyError ? (
          <StatusAlert
            status="warning"
            title="Organization policy unavailable"
            description={scopedOrgPolicyError}
          />
        ) : null}
        {!createError && orgFeatureBlockMessage ? (
          <FormAlert
            title="Scan creation disabled"
            description={orgFeatureBlockMessage}
            status="warning"
          />
        ) : null}

        <div className="scan-form-reveal">
          <ScanSection
            title={scanSource === 'local_archive' ? 'Archive' : undefined}
            description={
              scanSource === 'local_archive'
                ? 'Upload the archive and optionally set a friendlier display name.'
                : undefined
            }
          >
            {scanSource === 'local_archive' ? (
              <FileDropzone
                aria-label="OCI or Docker archive"
                file={uploadedArchiveFile}
                onFileChange={setUploadedArchiveFile}
                accept=".tar,.tgz,.tar.gz,.oci"
                title="Drop your image archive here"
                hint="docker save or OCI · .tar .tgz .tar.gz .oci"
              />
            ) : null}

            {scanSource === 'local_archive' ? (
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  className="font-mono"
                  label="Display name"
                  onChange={(e) => {
                    const nextImageName = e.target.value;
                    setImageName(nextImageName);
                    if (nextImageName.includes('@')) setImageTag('');
                  }}
                  placeholder="ghcr.io/example/api"
                  value={imageName}
                />
                <FormField
                  className="font-mono"
                  label="Tag"
                  onChange={(e) => setImageTag(e.target.value)}
                  placeholder="latest"
                  value={imageTag}
                />
              </div>
            ) : (
              <FormField
                autoFocus
                className="font-mono"
                description={
                  detectedRegistryName
                    ? `Detected ${detectedRegistryName}. Change the source below if that is wrong.`
                    : 'For example nginx:latest or ghcr.io/org/app:1.2'
                }
                label="Image"
                onChange={(e) => handleImageInput(e.target.value)}
                placeholder="nginx:latest"
                required
                value={imageName}
              />
            )}
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground dark:text-foreground">
                Source
              </p>
              <ChoiceCards
                aria-label="Scan source"
                value={scanSource ?? ''}
                onValueChange={(value) => chooseScanSource(String(value) as ScanSourceKind)}
                columns={4}
                aspect="5 / 2"
              >
                {scanSourceOptions.map((option) => (
                  <ChoiceCards.Item
                    key={option.source}
                    value={option.source}
                    disabled={option.disabled}
                  >
                    <ChoiceCards.Media>{option.icon}</ChoiceCards.Media>
                    <ChoiceCards.Label>{option.shortLabel}</ChoiceCards.Label>
                    <ChoiceCards.Description>
                      {option.disabledReason || option.description}
                    </ChoiceCards.Description>
                  </ChoiceCards.Item>
                ))}
              </ChoiceCards>
              {availableScanSourceOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No scan source is currently available in this deployment.
                </p>
              ) : null}
              {privateRegistries.length === 0 || xrayRegistries.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Need a private or Artifactory source?{' '}
                  <Link href="/registries" className="underline underline-offset-2">
                    Add a registry
                  </Link>
                  .
                </p>
              ) : null}
            </div>
            {hasRoutingSection ? (
              <div className="space-y-3">
                <div className="grid gap-4 sm:grid-cols-2">
                  <ScanWizardField
                    label={scanSource === 'private_registry' ? 'Registry' : 'Artifactory registry'}
                  >
                    <Select
                      aria-label="Registry"
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
                          {(scanSource === 'private_registry'
                            ? privateRegistries
                            : xrayRegistries
                          ).map((registry) => (
                            <ListBox.Item key={registry.id} id={registry.id}>
                              {registry.name}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    {scanSource === 'artifactory_xray' && selectedRegistry ? (
                      <p className="text-xs text-muted-foreground">
                        {selectedRegistry.xray_mode === 'full'
                          ? 'Full mode: requests a fresh Xray scan.'
                          : 'Limited mode: imports the existing Xray result, no rescan.'}
                      </p>
                    ) : null}
                  </ScanWizardField>

                  {scanSource === 'artifactory_xray' ? (
                    <ScanWizardField label="Repo override" optional>
                      {useManualXrayRepository || selectedRegistryRepositoriesError ? (
                        <Input
                          aria-label="Repo override"
                          className="font-mono"
                          placeholder="docker-remote"
                          value={xrayRepository}
                          onChange={(event) => setXrayRepository(event.target.value)}
                        />
                      ) : (
                        <SearchableSelect
                          aria-label="Repo override"
                          clearable
                          items={selectedRegistryRepositories.map((repository) => ({
                            value: repository.key,
                            label: repository.key,
                            description: repository.class || undefined,
                          }))}
                          value={xrayRepository || null}
                          onValueChange={(next) => setXrayRepository(next ?? '')}
                          placeholder={
                            selectedRegistry &&
                            artifactoryRepositoriesLoading === selectedRegistry.id
                              ? 'Loading repos…'
                              : 'Search repos'
                          }
                          emptyText="No matching repositories"
                        />
                      )}
                      <p className="text-xs text-muted-foreground">
                        {selectedRegistryRepositoriesError ? (
                          <>
                            Repo list unavailable, enter the key manually.{' '}
                            <button
                              type="button"
                              className="underline underline-offset-2"
                              onClick={() =>
                                setArtifactoryRepositoriesErrorByRegistry((previous) => {
                                  const next = { ...previous };
                                  if (selectedRegistry) delete next[selectedRegistry.id];
                                  return next;
                                })
                              }
                            >
                              Retry
                            </button>
                          </>
                        ) : useManualXrayRepository ? (
                          <button
                            type="button"
                            className="underline underline-offset-2"
                            onClick={() => setUseManualXrayRepository(false)}
                          >
                            Pick from the list instead
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="underline underline-offset-2"
                            onClick={() => setUseManualXrayRepository(true)}
                          >
                            Enter manually
                          </button>
                        )}
                      </p>
                    </ScanWizardField>
                  ) : null}
                </div>
              </div>
            ) : null}
          </ScanSection>
        </div>

        {scanSource ? (
          <Card className="surface-panel overflow-hidden rounded-xl p-0">
            <Disclosure
              className="w-full"
              isExpanded={optionalSettingsExpanded}
              onExpandedChange={setOptionalSettingsExpanded}
            >
              <Disclosure.Heading>
                <Disclosure.Trigger className="flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left transition-colors hover:bg-surface-secondary/60">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <h2 className="text-sm font-medium text-foreground">Advanced</h2>
                    <p className="truncate text-xs text-muted-foreground">More images, platform</p>
                  </div>
                  <Disclosure.Indicator className="shrink-0 text-muted-foreground">
                    <ArrowDown01Icon size={16} />
                  </Disclosure.Indicator>
                </Disclosure.Trigger>
              </Disclosure.Heading>
              <Disclosure.Content>
                <Disclosure.Body className="border-t border-border px-5 py-5">
                  <div className="space-y-4">
                    {scanSource !== 'local_archive' ? (
                      <ScanWizardField
                        description="One reference per line or comma-separated."
                        label="Queue more images"
                        optional
                      >
                        <TextArea
                          aria-label="Additional image references"
                          className={joinClassNames(inputCls, ' resize-y')}
                          placeholder={
                            'ghcr.io/example/api:1.2.3\nregistry.example.com/team/worker:latest'
                          }
                          value={additionalImageDraft}
                          onChange={(e) => setAdditionalImageDraft(e.target.value)}
                        />
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <Button
                            type="button"
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
                            className="rounded-xl p-3"
                            style={{
                              background: 'rgba(255,255,255,0.03)',
                              border: '1px solid var(--surface-border)',
                            }}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs font-medium text-muted-foreground">
                                Queued image targets
                              </p>
                              <span
                                className="rounded-full px-2 py-0.5 text-xs font-medium text-muted-foreground"
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
                                  <span className="min-w-0 break-all font-mono text-xs text-muted-foreground dark:text-foreground">
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
                        aria-label="Platform"
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
          </Card>
        ) : null}

        <Card className="surface-panel rounded-xl p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {scanSource && targetSummary !== 'No target yet' ? (
                <>
                  <span className="font-medium text-foreground">{targetSummary}</span>
                  {' · '}
                  {scanSourceLabel}
                  {routingSummary !== 'Direct' ? ` · ${routingSummary}` : ''}
                </>
              ) : (
                'Enter an image to scan.'
              )}
            </p>
            <Button
              type="submit"
              isDisabled={!canStartScan}
              variant="primary"
              className="inline-flex shrink-0 items-center gap-2"
            >
              {creating ? (
                <div className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <ArrowRight01Icon size={16} />
              )}
              {creating ? 'Starting scan…' : 'Start Scan'}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
