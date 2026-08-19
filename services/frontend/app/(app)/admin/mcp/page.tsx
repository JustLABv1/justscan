import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { MCPAdminTab } from '@/components/admin/mcp-admin-tab';

export default function AdminMCPPage() {
  return (
    <AdminPageShell>
      <MCPAdminTab />
    </AdminPageShell>
  );
}
