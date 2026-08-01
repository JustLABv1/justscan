import { Logo } from '@/components/logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-aurora-shell">
      <div aria-hidden="true" className="auth-aurora-field" />
      <div aria-hidden="true" className="auth-aurora-ribbon auth-aurora-ribbon--one" />
      <div aria-hidden="true" className="auth-aurora-ribbon auth-aurora-ribbon--two" />
      <div aria-hidden="true" className="auth-aurora-orb auth-aurora-orb--one" />
      <div aria-hidden="true" className="auth-aurora-orb auth-aurora-orb--two" />

      <div className="auth-aurora-layout">
        <section aria-label="Aurora security overview" className="auth-aurora-art">
          <div className="auth-aurora-art-content">
            <div className="auth-aurora-art-topbar">
              <div className="auth-aurora-brand">
                <Logo className="auth-aurora-brand-logo" size={30} />
                <span className="auth-aurora-brand-name">JustScan</span>
              </div>
              <span className="auth-aurora-art-topline">A clearer view of risk</span>
            </div>

            <div className="auth-aurora-art-main">
              <div className="auth-aurora-copy">
                <p className="auth-aurora-eyebrow">The calm before deploy</p>
                <h2>
                  Ship with
                  <br />
                  <span>confidence.</span>
                </h2>
                <p className="auth-aurora-description">
                  A quiet, continuous view of what&apos;s changing in your container estate — so the
                  work that matters can stay in focus.
                </p>
              </div>

              <div className="auth-aurora-window">
                <div className="auth-aurora-window-head">
                  <div>
                    <span className="auth-aurora-console-kicker">Workspace pulse</span>
                    <strong>Last 14 days</strong>
                  </div>
                  <span className="auth-aurora-status-pill">
                    <span className="auth-aurora-status-dot" /> Healthy
                  </span>
                </div>
                <div aria-hidden="true" className="auth-aurora-bars">
                  <span style={{ height: '34%' }} />
                  <span style={{ height: '48%' }} />
                  <span style={{ height: '40%' }} />
                  <span style={{ height: '62%' }} />
                  <span style={{ height: '56%' }} />
                  <span style={{ height: '76%' }} />
                  <span style={{ height: '68%' }} />
                  <span style={{ height: '88%' }} />
                  <span style={{ height: '73%' }} />
                  <span style={{ height: '94%' }} />
                  <span style={{ height: '82%' }} />
                  <span style={{ height: '100%' }} />
                </div>
                <div className="auth-aurora-window-foot">
                  <span>
                    <strong>96.8%</strong> healthy images
                  </span>
                  <span>+12.4% this week</span>
                </div>
              </div>

              <div className="auth-aurora-quote">
                <span aria-hidden="true" className="auth-aurora-quote-mark">
                  “
                </span>
                <p>Every fix has a thread back to the code that caused it.</p>
                <span className="auth-aurora-quote-byline">JustScan / operator notes</span>
              </div>
            </div>
          </div>
        </section>

        <section className="auth-aurora-form-side">{children}</section>
      </div>
    </main>
  );
}
