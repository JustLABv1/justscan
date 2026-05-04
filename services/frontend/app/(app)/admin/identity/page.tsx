import { AdminShell } from '../_components/admin-shell';
import { IdentityProvidersTab } from '../_components/legacy-admin-page';

export default function AdminIdentityPage() {
	return (
		<AdminShell>
			<IdentityProvidersTab />
		</AdminShell>
	);
}
