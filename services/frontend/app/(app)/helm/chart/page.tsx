'use client';
import { listHelmScanRuns } from '@/lib/api';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { Card, Spinner, buttonVariants } from '@/components/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

function HelmChartRedirectContent() {
  const router = useRouter();
  const params = useSearchParams();
  const chartUrl = params.get('url') ?? '';
  const requestError = chartUrl ? '' : 'No chart URL specified.';
  const [error, setError] = useState('');

  useEffect(() => {
    if (requestError) {
      return;
    }

    listHelmScanRuns(1, 1, chartUrl)
      .then((response) => {
        const latestRun = response.data?.[0];
        if (!latestRun) {
          setError('No Helm runs were found for this chart URL.');
          return;
        }
        router.replace(`/helm/runs/${latestRun.id}`);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to resolve Helm run.');
      });
  }, [chartUrl, requestError, router]);

  if (requestError) {
    return (
      <PageContainer size="narrow">
        <PageHeader
          title="Resolve Helm run"
          description="Find the latest run for the requested chart."
        />
        <Card>
          <Card.Content className="space-y-3 py-8 text-center text-sm text-muted-foreground">
            <p>{requestError}</p>
            <Link className={buttonVariants({ variant: 'secondary' })} href="/helm">
              Back to Helm runs
            </Link>
          </Card.Content>
        </Card>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer size="narrow">
        <PageHeader
          title="Resolve Helm run"
          description="Find the latest run for the requested chart."
        />
        <Card>
          <Card.Content className="space-y-3 py-8 text-center text-sm text-muted-foreground">
            <p>{error}</p>
            <Link className={buttonVariants({ variant: 'secondary' })} href="/helm">
              Back to Helm runs
            </Link>
          </Card.Content>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="narrow">
      <PageHeader
        title="Resolve Helm run"
        description="Find the latest run for the requested chart."
      />
      <Card>
        <Card.Content className="flex items-center justify-center gap-3 py-8 text-sm text-muted-foreground">
          <Spinner size="sm" />
          Resolving latest Helm run…
        </Card.Content>
      </Card>
    </PageContainer>
  );
}

export default function HelmChartRedirectPage() {
  return (
    <Suspense
      fallback={
        <PageContainer size="narrow">
          <PageHeader
            title="Resolve Helm run"
            description="Find the latest run for the requested chart."
          />
          <Card>
            <Card.Content className="flex items-center justify-center gap-3 py-8 text-sm text-muted-foreground">
              <Spinner size="sm" />
              Resolving latest Helm run…
            </Card.Content>
          </Card>
        </PageContainer>
      }
    >
      <HelmChartRedirectContent />
    </Suspense>
  );
}
