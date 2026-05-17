import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { TokensTab } from '@/components/admin/tokens-tab';

export default function AdminTokensPage() {
	return (
		<AdminPageShell>
			<TokensTab />
		</AdminPageShell>
	);
}
