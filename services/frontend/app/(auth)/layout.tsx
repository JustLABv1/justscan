export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-aurora-shell">
      <div className="auth-aurora-center">{children}</div>
    </main>
  );
}
