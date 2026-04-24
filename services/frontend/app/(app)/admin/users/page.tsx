import { AdminShell } from '../_components/admin-shell';
import { UsersTab } from '../_components/primary-tabs';

export default function AdminUsersPage() {
	return (
		<AdminShell>
			<UsersTab />
		</AdminShell>
	);
}
