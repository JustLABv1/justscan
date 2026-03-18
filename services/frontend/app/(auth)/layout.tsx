export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen flex items-center justify-center app-bg p-4 overflow-hidden">
      {/* Ambient orbs */}
      <div className="pointer-events-none" aria-hidden>
        <div className="fixed top-0 right-0 w-[500px] h-[500px] rounded-full"
          style={{ background: 'radial-gradient(circle,rgba(124,58,237,0.08) 0%,transparent 70%)', filter: 'blur(48px)' }} />
        <div className="fixed bottom-0 left-0 w-[400px] h-[400px] rounded-full"
          style={{ background: 'radial-gradient(circle,rgba(29,78,216,0.06) 0%,transparent 70%)', filter: 'blur(48px)' }} />
      </div>
      <div className="relative w-full max-w-sm z-10">{children}</div>
    </div>
  );
}
