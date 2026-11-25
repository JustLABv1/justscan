'use client';
import { PublicPage, PublicPageHeader } from '@/components/public/public-page';
import { PublicScanResult, hasScanResults } from '@/components/public/public-scan-result';
import { scanPlatformLabel } from '@/components/public/scan-details';
import {
  loadFindingsPage,
  useFindingQuery,
  useFindings,
} from '@/components/public/use-public-findings';
import { Alert, buttonVariants, useOverlayState } from '@/components/ui';
import { StatusBadge } from '@/components/ui/badges';
import { VulnerabilityDetailsModal } from '@/components/vulnerability-details-modal';
import type { Scan, Vulnerability } from '@/lib/api';
import {
  getPublicScan,
  getPublicVulnerabilityContextAnalysis,
  listPublicVulnerabilities,
  reScanPublic,
} from '@/lib/api';
import { updatePublicHistoryEntry } from '@/lib/publicScanHistory';
import { FileExportIcon, PackageIcon, Refresh01Icon, Search01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function PublicScanResultPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [scan, setScan] = useState<Scan | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [reScanning, setReScanning] = useState(false);
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

      void getPublicScan(id, { signal: controller.signal })
        .then((result) => {
          if (stopped) return;
          setError('');
          setScan(result);
          setActionError('');
          if (result.status === 'completed' || result.status === 'failed') {
            stopPolling();
            updatePublicHistoryEntry(id, {
              status: result.status,
              critical_count: result.critical_count ?? 0,
              high_count: result.high_count ?? 0,
              medium_count: result.medium_count ?? 0,
              low_count: result.low_count ?? 0,
              unknown_count: result.unknown_count ?? 0,
            });
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
          setError(error instanceof Error ? error.message : 'Failed to load public scan.');
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
  }, [id]);

  const findings = useFindings({
    enabled: hasScanResults(scan),
    sourceKey: `${id}:${scan?.status ?? ''}:${scan?.external_status ?? ''}`,
    query: queryState.query,
    page: queryState.page,
    load: (query, page, signal) =>
      loadFindingsPage(
        (current, pageSize) =>
          listPublicVulnerabilities(
            id,
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
        signal
      ),
  });

  async function handleRescan() {
    setReScanning(true);
    setActionError('');
    try {
      const newScan = await reScanPublic(id);
      router.push(`/public/scan/${newScan.id}`);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'The scan could not be queued.');
    } finally {
      setReScanning(false);
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
      <PublicPage title="Scan result" homeHref="/public/scan/image">
        <div className="mx-auto max-w-md space-y-4 py-16 text-center">
          <h1 className="text-xl font-semibold">This scan isn’t available</h1>
          <p className="text-sm text-muted-foreground">
            It may have expired, or the link may be wrong. Public scans are kept for a limited time.
          </p>
          <Link href="/public/scan/image" className={buttonVariants()}>
            <Search01Icon size={15} />
            Scan an image
          </Link>
        </div>
      </PublicPage>
    );
  }

  const imageName = scan ? `${scan.image_name}:${scan.image_tag}` : 'Loading scan…';
  const canExport = hasScanResults(scan);
  const isTerminal = scan?.status === 'completed' || scan?.status === 'failed';
  const platform = scan ? scanPlatformLabel(scan) : '';

  return (
    <PublicPage title={scan ? imageName : 'Scan result'} homeHref="/public/scan/image">
      <PublicPageHeader
        eyebrow={scan?.helm_chart_name ? `Image from ${scan.helm_chart_name}` : 'Public image scan'}
        title={imageName}
        subtitle={platform || undefined}
        status={
          scan ? (
            <StatusBadge
              status={scan.status}
              externalStatus={scan.external_status}
              currentStep={scan.current_step}
            />
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
          ...(canExport
            ? [
                {
                  label: 'Export',
                  icon: <FileExportIcon size={15} />,
                  onPress: () =>
                    window.open(`/reports/print?scans=${id}`, '_blank', 'noopener,noreferrer'),
                },
              ]
            : []),
        ]}
        moreActions={[
          ...(scan?.helm_scan_run_id
            ? [
                {
                  id: 'helm-run',
                  label: 'Back to Helm chart',
                  icon: <PackageIcon size={15} />,
                  onAction: () => router.push(`/public/scan/helm/runs/${scan.helm_scan_run_id}`),
                },
              ]
            : []),
          {
            id: 'new-scan',
            label: 'Scan another image',
            icon: <Search01Icon size={15} />,
            onAction: () => router.push('/public/scan/image'),
          },
        ]}
      />

      {actionError ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>The scan couldn’t be started</Alert.Title>
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
        failureActions={
          <Link href="/public/scan/image" className={buttonVariants({ variant: 'outline' })}>
            Try another image
          </Link>
        }
      />

      <VulnerabilityDetailsModal
        vulnerability={selectedVulnerability}
        state={vulnerabilityDetailsModal}
        onClose={closeVulnerabilityDetails}
        loadContextAnalysis={(vulnerability) =>
          getPublicVulnerabilityContextAnalysis(id, vulnerability.id)
        }
      />
    </PublicPage>
  );
}
