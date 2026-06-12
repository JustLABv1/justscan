import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Security Vulnerability Report | JustScan',
  description: 'Printable JustScan vulnerability report.',
};

export default async function LegacyPrintReportPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  const { scanId } = await params;
  redirect(`/reports/print?scans=${encodeURIComponent(scanId)}`);
}
