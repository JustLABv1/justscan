'use client';
import { PublicPage, PublicPageHeader } from '@/components/public/public-page';
import { useIsLoggedIn } from '@/components/public/public-navbar';
import { hasScanResults, PublicScanResult } from '@/components/public/public-scan-result';
import { scanPlatformLabel } from '@/components/public/scan-details';
import {
  loadFindingsPage,
  useFindingQuery,
  useFindings,
} from '@/components/public/use-public-findings';
import { SBOMWorkspace } from '@/components/scans/sbom-workspace';
import { Alert, Button, buttonVariants, useOverlayState } from '@/components/ui';
import { StatusBadge } from '@/components/ui/badges';
import { StatusTag } from '@/components/ui/status-dot';
import { VulnerabilityDetailsModal } from '@/components/vulnerability-details-modal';
import type { Scan, Vulnerability } from '@/lib/api';
import {
  ApiError,
  getSharedScan,
  getSharedSBOM,
  getSharedSBOMComponent,
  getSharedSBOMGraph,
  getSharedVulnerabilityContextAnalysis,
  listScans,
  listSharedVulnerabilities,
  rescanShared,
} from '@/lib/api';
import { pluralize } from '@/lib/labels';
import { FileExportIcon, GitCompareIcon, Refresh01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { prioritizePolicyFindings, xrayPolicySummary } from './xray-policy';

export default function SharedScanPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const isLoggedIn = useIsLoggedIn();
  const [scan, setScan] = useState<Scan | null>(null);
  const [error, setError] = useState('');
  const [reScanning, setReScanning] = useState(false);
  const [comparingPrev, setComparingPrev] = useState(false);
  const [actionError, setActionError] = useState('');
  const vulnerabilityDetailsModal = useOverlayState();
  const [selectedVulnerability, setSelectedVulnerability] = useState<Vulnerability | null>(null);
  const queryState = useFindingQuery();

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let terminal = false;
    let inFlight = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      terminal = true;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const poll = () => {
      if (stopped || controller.signal.aborted || inFlight || terminal) return;
      inFlight = true;

      void getSharedScan(token, { signal: controller.signal })
        .then((result) => {
          if (stopped) return;
          setError('');
          setScan(result);
          if (result.status === 'completed' || result.status === 'failed') {
            stopPolling();
          }
        })
        .catch((error: unknown) => {
          if (
            stopped ||
            controller.signal.aborted ||
            (error instanceof Error && error.name === 'AbortError')
          ) {
            return;
          }
          stopPolling();
          if (error instanceof ApiError && error.status === 401) {
            router.push(`/login?returnUrl=/shared/${token}`);
            return;
          }
          setError(error instanceof Error ? error.message : 'Failed to load shared scan.');
        })
        .finally(() => {
          inFlight = false;
        });
    };

    void poll();
    intervalId = setInterval(() => void poll(), 2500);

    return () => {
      stopped = true;
      controller.abort();
      stopPolling();
    };
  }, [token, router]);

  const findings = useFindings({
    enabled: hasScanResults(scan),
    sourceKey: `${token}:${scan?.status ?? ''}:${scan?.external_status ?? ''}`,
    query: queryState.query,
    page: queryState.page,
    load: (query, page, signal) =>
      loadFindingsPage(
        (current, pageSize) =>
          listSharedVulnerabilities(
            token,
            current,
            pageSize,
            query.severity || undefined,
            query.pkg || undefined,
            query.hasFix || undefined,
            query.minCvss || undefined,
            query.sortBy,
            query.sortDir,
            { signal }
          ),
        query,
        page,
        signal,
        prioritizePolicyFindings
      ),
    onUnauthorized: (reason) => {
      if (reason instanceof ApiError && reason.status === 401) {
        router.push(`/login?returnUrl=/shared/${token}`);
        return true;
      }
      return false;
    },
  });

  async function handleRescan() {
    setReScanning(true);
    setActionError('');
    try {
      const result = await rescanShared(token);
      if (result.type === 'authenticated') {
        router.push(`/scans/details/${result.scan_id}`);
      } else {
        router.push(`/public/scan/${result.scan_id}`);
      }
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'The scan could not be queued.');
    } finally {
      setReScanning(false);
    }
  }

  async function handleComparePrev() {
    if (!scan) return;
    setComparingPrev(true);
    try {
      const res = await listScans(1, 5, scan.image_name);
      const prev = (res.data ?? []).find((s) => s.id !== scan.id);
      if (prev) router.push(`/scans/compare?a=${prev.id}&b=${scan.id}`);
      else setActionError('There is no earlier scan of this image to compare with.');
    } catch {
      setActionError('Earlier scans of this image could not be loaded.');
    } finally {
      setComparingPrev(false);
    }
  }

  function openVulnerabilityDetails(vulnerability: Vulnerability) {
    setSelectedVulnerability(vulnerability);
    vulnerabilityDetailsModal.open();
  }

  function closeVulnerabilityDetails() {
    vulnerabilityDetailsModal.close();
    setSelectedVulnerability(null);
  }

  if (error) {
    return (
      <PublicPage title="Shared scan">
        <div className="mx-auto max-w-md space-y-4 py-16 text-center">
          <h1 className="text-xl font-semibold">This shared scan isn’t available</h1>
          <p className="text-sm text-muted-foreground">
            The link may have been turned off by its owner, or it may be wrong. Ask the person who
            sent it for a new link.
          </p>
          <Link href="/" className={buttonVariants()}>
            Go home
          </Link>
        </div>
      </PublicPage>
    );
  }

  const imageName = scan ? `${scan.image_name}:${scan.image_tag}` : 'Loading scan…';
  const isTerminal = scan?.status === 'completed' || scan?.status === 'failed';
  const platform = scan ? scanPlatformLabel(scan) : '';

  return (
    <PublicPage title={scan ? imageName : 'Shared scan'}>
      <PublicPageHeader
        eyebrow="Shared scan"
        title={imageName}
        subtitle={platform || undefined}
        status={
          scan ? (
            <>
              <StatusBadge
                status={scan.status}
                externalStatus={scan.external_status}
                currentStep={scan.current_step}
              />
              {scan.share_visibility === 'authenticated' ? (
                <StatusTag tone="accent">Visible to signed-in users only</StatusTag>
              ) : null}
            </>
          ) : null
        }
        actions={[
          ...(isTerminal
            ? [
                {
                  label: 'Scan again',
                  icon: <Refresh01Icon size={15} />,
                  onPress: handleRescan,
                  pending: reScanning,
                  variant: 'primary' as const,
                },
              ]
            : []),
          ...(hasScanResults(scan)
            ? [
                {
                  label: 'Export',
                  icon: <FileExportIcon size={15} />,
                  onPress: () =>
                    window.open(
                      `/reports/print?scans=${scan?.id}`,
                      '_blank',
                      'noopener,noreferrer'
                    ),
                },
              ]
            : []),
        ]}
        moreActions={
          scan?.status === 'completed' && isLoggedIn
            ? [
                {
                  id: 'compare',
                  label: 'Compare with previous scan',
                  icon: <GitCompareIcon size={15} />,
                  pending: comparingPrev,
                  onAction: handleComparePrev,
                },
              ]
            : []
        }
      />

      {actionError ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{actionError}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <PublicScanResult
        scan={scan}
        queryState={queryState}
        findings={findings}
        onOpenVulnerability={openVulnerabilityDetails}
        enableCveSearch
        enablePolicyFirst
        renderPolicy={(vulnerability) => {
          const policy = xrayPolicySummary(vulnerability);
          if (!policy) return null;
          return (
            <Button
              size="sm"
              variant={policy.blocking ? 'destructive' : 'outline'}
              onPress={() => openVulnerabilityDetails(vulnerability)}
            >
              {policy.blocking ? 'Blocking' : pluralize(policy.count, 'match', 'matches')}
            </Button>
          );
        }}
        extraTabs={
          scan
            ? [
                {
                  id: 'sbom',
                  label: 'Packages',
                  content: (
                    <SBOMWorkspace
                      readOnly
                      loadComponents={(query) => getSharedSBOM(token, query)}
                      loadGraph={(focus) => getSharedSBOMGraph(token, focus)}
                      loadComponent={(componentId) => getSharedSBOMComponent(token, componentId)}
                      downloadHref={`/api/v1/shared/${token}/sbom/download`}
                    />
                  ),
                },
              ]
            : []
        }
      />

      <VulnerabilityDetailsModal
        vulnerability={selectedVulnerability}
        state={vulnerabilityDetailsModal}
        onClose={closeVulnerabilityDetails}
        loadContextAnalysis={(vulnerability) =>
          getSharedVulnerabilityContextAnalysis(token, vulnerability.id)
        }
      />
    </PublicPage>
  );
}
