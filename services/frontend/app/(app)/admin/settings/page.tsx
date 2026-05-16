import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { SettingsTab } from '../_components/primary-tabs';

export default function AdminSettingsPage() {
	return (
		<AdminPageShell>
			<SettingsTab />
		</AdminPageShell>
	);
}
