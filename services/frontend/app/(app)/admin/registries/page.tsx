import { AdminShell } from '../_components/admin-shell';
import { GlobalRegistriesTab } from '../_components/legacy-admin-page';

export default function AdminRegistriesPage() {
	return (
		<AdminShell>
			<GlobalRegistriesTab />
		</AdminShell>
	);
}
