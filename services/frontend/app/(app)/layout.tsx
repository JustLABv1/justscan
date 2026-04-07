import { AppShell } from '@/components/app-shell';
import { requireServerSession } from '@/lib/server-auth';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireServerSession();

  return <AppShell initialUser={session.user}>{children}</AppShell>;
}
