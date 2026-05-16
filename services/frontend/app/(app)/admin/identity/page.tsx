import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { IdentityProvidersTab } from '../_components/advanced-tabs';

export default function AdminIdentityPage() {
	return (
		<AdminPageShell>
			<IdentityProvidersTab />
		</AdminPageShell>
	);
}
