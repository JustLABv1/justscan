import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { ScannerTab } from '../_components/primary-tabs';

export default function AdminScannerPage() {
	return (
		<AdminPageShell>
			<ScannerTab />
		</AdminPageShell>
	);
}
