import { VulnerabilityExplorerDetail } from '@/components/vulnkb/vulnerability-explorer-detail';

type VulnerabilityExplorerPageProps = {
  params: Promise<{ vulnId: string }>;
};

export default async function VulnerabilityExplorerPage({
  params,
}: VulnerabilityExplorerPageProps) {
  const { vulnId } = await params;
  return <VulnerabilityExplorerDetail vulnId={decodeURIComponent(vulnId)} />;
}
