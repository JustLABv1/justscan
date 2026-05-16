import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { AuditLogTab } from '../_components/primary-tabs';

export default function AdminAuditPage() {
	return (
		<AdminPageShell>
			<AuditLogTab />
		</AdminPageShell>
	);
}
