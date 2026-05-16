import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { UsersTab } from '../_components/primary-tabs';

export default function AdminUsersPage() {
	return (
		<AdminPageShell>
			<UsersTab />
		</AdminPageShell>
	);
}
