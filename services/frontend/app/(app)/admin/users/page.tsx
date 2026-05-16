import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { UsersTab } from '@/components/admin/users-tab';

export default function AdminUsersPage() {
	return (
		<AdminPageShell>
			<UsersTab />
		</AdminPageShell>
	);
}
