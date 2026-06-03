import { PublicShell } from '@/components/public/public-shell';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <PublicShell centered contentClassName="p-4" withRays>
      <div className="w-full max-w-sm">{children}</div>
    </PublicShell>
  );
}
