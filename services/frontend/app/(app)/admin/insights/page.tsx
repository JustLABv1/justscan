import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { InsightsTab } from '../_components/advanced-tabs';

export default function AdminInsightsPage() {
	return (
		<AdminPageShell>
			<InsightsTab />
		</AdminPageShell>
	);
}
