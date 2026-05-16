import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { ScannerTab } from '@/components/admin/scanner-tab';

export default function AdminScannerPage() {
  return (
    <AdminPageShell>
      <ScannerTab />
    </AdminPageShell>
  );
}
