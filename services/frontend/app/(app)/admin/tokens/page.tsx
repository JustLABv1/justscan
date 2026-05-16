import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { TokensTab } from '../_components/primary-tabs';

export default function AdminTokensPage() {
	return (
		<AdminPageShell>
			<TokensTab />
		</AdminPageShell>
	);
}
