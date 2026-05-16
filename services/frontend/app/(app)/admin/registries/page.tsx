import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { GlobalRegistriesTab } from '../_components/advanced-tabs';

export default function AdminRegistriesPage() {
	return (
		<AdminPageShell>
			<GlobalRegistriesTab />
		</AdminPageShell>
	);
}
