import { requireAdminSession } from '@/lib/server-auth';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminSession();
  return children;
}