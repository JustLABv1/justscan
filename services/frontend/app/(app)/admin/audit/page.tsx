import { AdminShell } from '../_components/admin-shell';
import { AuditLogTab } from '../_components/primary-tabs';

export default function AdminAuditPage() {
	return (
		<AdminShell>
			<AuditLogTab />
		</AdminShell>
	);
}
