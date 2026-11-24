'use client';

import { Card, Disclosure, DescriptionList, type DescriptionItem } from '@/components/ui';
import type { Scan } from '@/lib/api';
import { labelFor, SCAN_PROVIDER_LABELS } from '@/lib/labels';
import { fullDate, timeAgo } from '@/lib/time';

/**
 * Collapsed "Scan details" panel for technical metadata (digest, scanner,
 * platform, source path). Keeps the page header readable for outsiders.
 */
export function ScanDetailsDisclosure({
  items,
  title = 'Scan details',
  defaultExpanded = false,
}: {
  items: DescriptionItem[];
  title?: string;
  defaultExpanded?: boolean;
}) {
  if (items.every((item) => item.hidden)) return null;
  return (
    <Card className="gap-0 py-0">
      <Disclosure defaultExpanded={defaultExpanded}>
        <Disclosure.Heading>
          <Disclosure.Trigger className="px-4 py-3 text-foreground hover:no-underline sm:px-5">
            {title}
            <Disclosure.Indicator />
          </Disclosure.Trigger>
        </Disclosure.Heading>
        <Disclosure.Content>
          <Disclosure.Body className="border-t border-border px-4 py-4 sm:px-5">
            <DescriptionList items={items} columns={3} />
          </Disclosure.Body>
        </Disclosure.Content>
      </Disclosure>
    </Card>
  );
}

function dateValue(value?: string | null) {
  if (!value) return null;
  return <span title={fullDate(value)}>{timeAgo(value)}</span>;
}

/** Scanner label without exposing raw provider keys. */
export function scanProviderLabel(scan: Pick<Scan, 'scan_provider' | 'trivy_version'>) {
  if (!scan.scan_provider || scan.scan_provider === 'trivy') {
    return scan.trivy_version ? `Trivy ${scan.trivy_version}` : 'Trivy';
  }
  return labelFor(SCAN_PROVIDER_LABELS, scan.scan_provider);
}

/** Readable platform such as "linux/amd64 · Debian 12". */
export function scanPlatformLabel(
  scan: Pick<Scan, 'architecture' | 'os_family' | 'os_name' | 'platform'>
) {
  const os = [scan.os_family, scan.os_name].filter(Boolean).join(' ');
  const arch = scan.platform || scan.architecture;
  return [arch, os].filter(Boolean).join(' · ');
}

/** Standard detail rows for one image scan. */
export function scanDetailItems(scan: Scan): DescriptionItem[] {
  const platform = scanPlatformLabel(scan);
  const chart = [scan.helm_chart_name, scan.helm_chart_version].filter(Boolean).join(' ');
  return [
    { label: 'Image', value: `${scan.image_name}:${scan.image_tag}`, mono: true, wide: true },
    {
      label: 'Digest',
      value: scan.image_digest,
      mono: true,
      wide: true,
      hidden: !scan.image_digest,
    },
    { label: 'Scanner', value: scanProviderLabel(scan) },
    { label: 'Platform', value: platform, hidden: !platform },
    { label: 'Started', value: dateValue(scan.started_at), hidden: !scan.started_at },
    { label: 'Finished', value: dateValue(scan.completed_at), hidden: !scan.completed_at },
    {
      label: 'Vulnerability database updated',
      value: dateValue(scan.trivy_vuln_db_updated_at),
      hidden: !scan.trivy_vuln_db_updated_at,
    },
    { label: 'Helm chart', value: chart, hidden: !chart },
    {
      label: 'Source path in chart',
      value: scan.helm_source_path,
      mono: true,
      hidden: !scan.helm_source_path,
    },
  ];
}
