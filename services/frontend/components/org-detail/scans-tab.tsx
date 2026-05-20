import { ImageSummary } from '@/lib/api';
import { Button, Card } from '@heroui/react';
import { PlusSignIcon } from 'hugeicons-react';
import { useCallback, useMemo, useState } from 'react';

import { ImageScansTable } from '../scans/image-scans-table';

import { OrgScanItem } from './shared';

interface OrgScansTabProps {
  canManageScans: boolean;
  onOpenAssignModal: () => void | Promise<void>;
  onRemoveScan: (scanId: string) => void | Promise<void>;
  orgScans: OrgScanItem[];
}

export function OrgScansTab({
  canManageScans,
  onOpenAssignModal,
  onRemoveScan,
  orgScans,
}: OrgScansTabProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedScans, setSelectedScans] = useState<Set<string>>(new Set());
  const [childRefreshKey, setChildRefreshKey] = useState<Record<string, number>>({});

  const imageSummaries = useMemo<ImageSummary[]>(() => {
    const byImage = new Map<string, ImageSummary>();

    for (const scan of orgScans) {
      const existing = byImage.get(scan.image_name);

      if (!existing) {
        byImage.set(scan.image_name, {
          image_name: scan.image_name,
          scan_count: 1,
          latest_scan_id: scan.id,
          latest_tag: scan.image_tag,
          latest_status: scan.status,
          latest_external_status: scan.external_status,
          latest_scan_at: scan.created_at,
          owner_type: scan.owner_type,
          owner_user_id: scan.owner_user_id,
          owner_org_id: scan.owner_org_id,
          critical_count: scan.critical_count,
          high_count: scan.high_count,
          medium_count: scan.medium_count,
          low_count: scan.low_count,
        });
        continue;
      }

      existing.scan_count += 1;

      if (Date.parse(scan.created_at) > Date.parse(existing.latest_scan_at)) {
        existing.latest_scan_id = scan.id;
        existing.latest_tag = scan.image_tag;
        existing.latest_status = scan.status;
        existing.latest_external_status = scan.external_status;
        existing.latest_scan_at = scan.created_at;
        existing.owner_type = scan.owner_type;
        existing.owner_user_id = scan.owner_user_id;
        existing.owner_org_id = scan.owner_org_id;
        existing.critical_count = scan.critical_count;
        existing.high_count = scan.high_count;
        existing.medium_count = scan.medium_count;
        existing.low_count = scan.low_count;
      }
    }

    return Array.from(byImage.values()).sort(
      (a, b) => Date.parse(b.latest_scan_at) - Date.parse(a.latest_scan_at)
    );
  }, [orgScans]);

  const handleDelete = useCallback(
    async (scanId: string, imageName: string) => {
      await onRemoveScan(scanId);
      setChildRefreshKey((previous) => ({
        ...previous,
        [imageName]: (previous[imageName] ?? 0) + 1,
      }));
    },
    [onRemoveScan]
  );

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Assigned Scans</h2>
        {canManageScans && (
          <Button onClick={() => void onOpenAssignModal()}>
            <PlusSignIcon size={14} />
            Assign Scan
          </Button>
        )}
      </div>

      {orgScans.length === 0 ? (
        <Card className="surface-card rounded-2xl p-6 text-center text-sm text-zinc-500">
          No scans assigned. Assign a scan to evaluate it against this organization&apos;s policies.
        </Card>
      ) : (
        <ImageScansTable
          childRefreshKey={childRefreshKey}
          expanded={expanded}
          hasActiveFilters={false}
          images={imageSummaries}
          loading={false}
          onCancel={async () => {}}
          onClearFilters={() => {}}
          onDelete={handleDelete}
          onExpandedChange={setExpanded}
          onOpenCreateModal={onOpenAssignModal}
          onSelectedScansChange={setSelectedScans}
          onSelectScan={() => {}}
          allowMutationActions={canManageScans}
          selectedScans={selectedScans}
        />
      )}
    </Card>
  );
}
