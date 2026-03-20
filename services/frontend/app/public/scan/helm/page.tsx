'use client';
import { Logo } from '@/components/logo';
import { createPublicHelmScans, extractPublicHelmImages, getPublicScan, getToken, HelmExtractResponse, HelmImage, Scan } from '@/lib/api';
import { addToHelmPublicHistory, addToPublicHistory, getHelmPublicHistory, HelmScanGroup, timeAgo, updateHelmPublicHistoryEntry, updatePublicHistoryEntry } from '@/lib/publicScanHistory';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const PLATFORMS = [
  { value: '', label: 'Auto (detect)' },
  { value: 'linux/amd64', label: 'linux/amd64' },
  { value: 'linux/arm64', label: 'linux/arm64' },
  { value: 'linux/arm/v7', label: 'linux/arm/v7' },
  { value: 'windows/amd64', label: 'windows/amd64' },
];

function statusStyle(status: string) {
  switch (status) {
    case 'completed': return { color: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' };
    case 'failed':    return { color: 'text-red-500 dark:text-red-400',         dot: 'bg-red-500' };
    case 'running':   return { color: 'text-blue-500 dark:text-blue-400',        dot: 'bg-blue-400' };
    default:          return { color: 'text-zinc-500',                           dot: 'bg-zinc-400' };
  }
}

type ScanResult = {
  id: string;
  image_name: string;
  image_tag: string;
  status: string;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  created_at: string;
};

type Step = 'form' | 'extracting' | 'review' | 'scanning' | 'results';

export default function PublicHelmScanPage() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Form
  const [chartUrl, setChartUrl] = useState('');
  const [chartName, setChartName] = useState('');
  const [chartVersion, setChartVersion] = useState('');
  const [platform, setPlatform] = useState('');

  // Steps
  const [step, setStep] = useState<Step>('form');
  const [extractError, setExtractError] = useState('');
  const [scanError, setScanError] = useState('');

  // Extracted images
  const [chartInfo, setChartInfo] = useState<{ name: string; version: string }>({ name: '', version: '' });
  const [images, setImages] = useState<HelmImage[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Scan results
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);
  const [helmHistory, setHelmHistory] = useState<HelmScanGroup[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isDark = mounted && resolvedTheme === 'dark';
  const isOCI = chartUrl.startsWith('oci://');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    setIsLoggedIn(!!getToken());
    const history = getHelmPublicHistory();
    setHelmHistory(history);
    // Restore last active group if navigated back
    const lastGroupId = typeof window !== 'undefined' ? sessionStorage.getItem('helm_active_group') : null;
    if (lastGroupId) {
      const group = history.find(g => g.group_id === lastGroupId);
      if (group && group.scans.length > 1) {
        setCurrentGroupId(group.group_id);
        setScanResults(group.scans.map(s => ({
          id: s.id,
          image_name: s.image_name,
          image_tag: s.image_tag,
          status: s.status,
          critical_count: s.critical_count,
          high_count: s.high_count,
          medium_count: s.medium_count,
          low_count: s.low_count,
          created_at: s.created_at,
        })));
        setStep('results');
      }
    }
  }, []);

  // Poll scan statuses
  useEffect(() => {
    if (step !== 'results' && step !== 'scanning') return;
    if (pollRef.current) clearInterval(pollRef.current);

    const active = scanResults.filter(s => s.status === 'pending' || s.status === 'running');
    if (active.length === 0) {
      // Defer state update to avoid synchronous setState in effect
      const t = setTimeout(() => { if (step === 'scanning') setStep('results'); }, 0);
      return () => clearTimeout(t);
    }

    pollRef.current = setInterval(async () => {
      let anyChange = false;
      const updates = await Promise.all(
        active.map(async r => {
          try {
            const fresh = await getPublicScan(r.id);
            if (fresh.status !== r.status) {
              updatePublicHistoryEntry(r.id, {
                status: fresh.status,
                critical_count: fresh.critical_count ?? 0,
                high_count: fresh.high_count ?? 0,
                medium_count: fresh.medium_count ?? 0,
                low_count: fresh.low_count ?? 0,
                unknown_count: fresh.unknown_count ?? 0,
              });
              anyChange = true;
              return { id: r.id, status: fresh.status, critical_count: fresh.critical_count ?? 0, high_count: fresh.high_count ?? 0, medium_count: fresh.medium_count ?? 0, low_count: fresh.low_count ?? 0 };
            }
          } catch { /* ignore */ }
          return null;
        })
      );

      if (anyChange) {
        setScanResults(prev => prev.map(r => {
          const upd = updates.find(u => u?.id === r.id);
          return upd ? { ...r, ...upd } : r;
        }));
        // Update helm history group
        if (currentGroupId) {
          const allScans = scanResults.map(r => {
            const upd = updates.find(u => u?.id === r.id);
            return upd ? { ...r, ...upd } : r;
          });
          updateHelmPublicHistoryEntry(currentGroupId, {
            scans: allScans.map(r => ({
              id: r.id,
              image_name: r.image_name,
              image_tag: r.image_tag,
              status: r.status,
              critical_count: r.critical_count,
              high_count: r.high_count,
              medium_count: r.medium_count,
              low_count: r.low_count,
              created_at: r.created_at,
            })),
          });
          setHelmHistory(getHelmPublicHistory());
        }
        // Check if all done
        const remaining = active.filter(r => {
          const upd = updates.find(u => u?.id === r.id);
          return !upd || (upd.status !== 'completed' && upd.status !== 'failed');
        });
        if (remaining.length === 0) {
          setStep('results');
        }
      }
    }, 3000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [step, scanResults]);

  async function handleExtract(e: React.FormEvent) {
    e.preventDefault();
    setExtractError('');
    setStep('extracting');
    try {
      const res: HelmExtractResponse = await extractPublicHelmImages(
        chartUrl.trim(),
        isOCI ? undefined : chartName.trim() || undefined,
        chartVersion.trim() || undefined,
      );
      const images = Array.isArray(res.images) ? res.images : [];
      setChartInfo({ name: res.chart_name, version: res.chart_version });
      setImages(images);
      setSelected(new Set(images.map(img => img.full_ref)));
      setStep('review');
    } catch (err: unknown) {
      setExtractError(err instanceof Error ? err.message : 'Failed to extract images');
      setStep('form');
    }
  }

  async function handleScan() {
    setScanError('');
    const selectedImages = images.filter(img => selected.has(img.full_ref));
    if (selectedImages.length === 0) return;

    setStep('scanning');
    try {
      const res = await createPublicHelmScans(
        chartUrl.trim(),
        selectedImages.map(img => ({ full_ref: img.full_ref, source_path: img.source_path })),
        platform || undefined,
      );

      const results: ScanResult[] = (res.scans ?? []).map((s: Scan) => ({
        id: s.id,
        image_name: s.image_name,
        image_tag: s.image_tag,
        status: s.status,
        critical_count: s.critical_count ?? 0,
        high_count: s.high_count ?? 0,
        medium_count: s.medium_count ?? 0,
        low_count: s.low_count ?? 0,
        created_at: s.created_at,
      }));

      // Add to localStorage history
      results.forEach(r => addToPublicHistory({
        id: r.id,
        image_name: r.image_name,
        image_tag: r.image_tag,
        platform: platform || undefined,
        status: r.status,
        critical_count: r.critical_count,
        high_count: r.high_count,
        medium_count: r.medium_count,
        low_count: r.low_count,
        unknown_count: 0,
        created_at: r.created_at,
      }));

      // Add helm group to history
      const groupId = results[0]?.id ?? crypto.randomUUID();
      setCurrentGroupId(groupId);
      const helmGroup: HelmScanGroup = {
        group_id: groupId,
        chart_url: chartUrl.trim(),
        chart_name: chartInfo.name || undefined,
        chart_version: chartInfo.version || undefined,
        scans: results.map(r => ({
          id: r.id,
          image_name: r.image_name,
          image_tag: r.image_tag,
          status: r.status,
          critical_count: r.critical_count,
          high_count: r.high_count,
          medium_count: r.medium_count,
          low_count: r.low_count,
          created_at: r.created_at,
        })),
        created_at: results[0]?.created_at ?? new Date().toISOString(),
      };
      addToHelmPublicHistory(helmGroup);
      setHelmHistory(getHelmPublicHistory());

      setScanResults(results);

      if (results.length === 1) {
        // Single scan → navigate directly to result page
        sessionStorage.removeItem('helm_active_group');
        router.push(`/public/scan/${results[0].id}`);
      } else {
        // Multiple scans → show results list; persist group so back-nav works
        sessionStorage.setItem('helm_active_group', groupId);
      }
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : 'Failed to start scans');
      setStep('review');
    }
  }

  function toggleImage(ref: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  }

  function selectAll() { setSelected(new Set(images.map(i => i.full_ref))); }
  function deselectAll() { setSelected(new Set()); }

  function restoreGroup(group: HelmScanGroup) {
    setCurrentGroupId(group.group_id);
    setScanResults(group.scans.map(s => ({
      id: s.id,
      image_name: s.image_name,
      image_tag: s.image_tag,
      status: s.status,
      critical_count: s.critical_count,
      high_count: s.high_count,
      medium_count: s.medium_count,
      low_count: s.low_count,
      created_at: s.created_at,
    })));
    sessionStorage.setItem('helm_active_group', group.group_id);
    setStep('results');
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--app-bg)', color: 'var(--text-primary)' }}>
      {/* Animated background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <style>{`
          @keyframes helmGridDrift {
            0%   { background-position: 0 0; }
            100% { background-position: 40px 40px; }
          }
          @keyframes helmSweepBeam {
            0%   { transform: translateY(-100vh); opacity: 0; }
            5%   { opacity: 1; }
            95%  { opacity: 1; }
            100% { transform: translateY(100vh); opacity: 0; }
          }
        `}</style>
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full"
          style={{ background: isDark ? 'radial-gradient(circle, rgba(124,58,237,0.15) 0%, transparent 65%)' : 'radial-gradient(circle, rgba(124,58,237,0.08) 0%, transparent 65%)' }} />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] rounded-full"
          style={{ background: isDark ? 'radial-gradient(circle, rgba(109,40,217,0.1) 0%, transparent 65%)' : 'radial-gradient(circle, rgba(109,40,217,0.05) 0%, transparent 65%)' }} />
        <div className="absolute inset-0"
          style={{
            backgroundImage: isDark
              ? 'radial-gradient(circle, rgba(167,139,250,0.1) 1px, transparent 1px)'
              : 'radial-gradient(circle, rgba(124,58,237,0.06) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            animation: 'helmGridDrift 16s linear infinite',
          }} />
        <div className="absolute inset-x-0 h-px"
          style={{
            background: isDark
              ? 'linear-gradient(90deg, transparent, rgba(124,58,237,0.3), rgba(167,139,250,0.4), rgba(124,58,237,0.3), transparent)'
              : 'linear-gradient(90deg, transparent, rgba(124,58,237,0.15), rgba(124,58,237,0.22), rgba(124,58,237,0.15), transparent)',
            animation: 'helmSweepBeam 11s ease-in-out infinite',
            animationDelay: '2s',
            top: 0,
          }} />
      </div>

      {/* Nav */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)', boxShadow: '0 0 12px rgba(124,58,237,0.5)' }}>
            <Logo size={16} className="text-white" />
          </div>
          <span className="font-semibold text-[15px] tracking-tight" style={{ color: 'var(--text-primary)' }}>JustScan</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/public/scan/image"
            className="hidden sm:flex text-sm px-3 py-1.5 rounded-xl font-medium transition-colors items-center gap-1.5"
            style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/><line x1="15" y1="9" x2="15" y2="21"/>
            </svg>
            Scan Image
          </Link>
          {mounted && (
            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
            >
              {isDark ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              )}
            </button>
          )}
          <Link href={isLoggedIn ? '/scans' : '/login'} className="text-sm px-3 py-1.5 rounded-xl font-medium transition-colors"
            style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
            {isLoggedIn ? 'Dashboard →' : 'Sign in'}
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col items-center px-4 py-12">
        <div className="w-full max-w-2xl space-y-8 my-auto">

          {/* Hero */}
          <div className="text-center space-y-3">
            <div className="flex justify-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-[#a78bfa]"
                style={{
                  background: isDark ? 'linear-gradient(135deg, rgba(124,58,237,0.25) 0%, rgba(109,40,217,0.12) 100%)' : 'linear-gradient(135deg, rgba(124,58,237,0.12) 0%, rgba(109,40,217,0.06) 100%)',
                  border: '1px solid rgba(167,139,250,0.25)',
                  boxShadow: '0 0 28px rgba(124,58,237,0.15)',
                }}>
                {/* Helm wheel icon */}
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
                </svg>
              </div>
            </div>
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                Scan Helm chart{' '}
                <span style={{ background: 'linear-gradient(135deg, #a78bfa, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  images
                </span>
              </h1>
              <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                Extract all container images from your Helm chart and scan them for CVEs · No account needed
              </p>
            </div>
          </div>

          {/* Step 1 — Chart URL form */}
          {(step === 'form' || step === 'extracting') && (
            <form onSubmit={handleExtract} className="space-y-3">
              {/* Chart URL */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Chart URL</label>
                <div className="flex items-center gap-2 p-2 rounded-2xl"
                  style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-shadow)' }}>
                  <div className="pl-2 shrink-0" style={{ color: 'var(--text-faint)' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={chartUrl}
                    onChange={e => setChartUrl(e.target.value)}
                    placeholder="oci://ghcr.io/org/chart:1.0  or  https://charts.example.com"
                    disabled={step === 'extracting'}
                    className="flex-1 bg-transparent text-sm outline-none font-mono py-2.5"
                    style={{ color: 'var(--text-primary)', caretColor: '#7c3aed' }}
                    autoFocus
                  />
                </div>
              </div>

              {/* Chart name + version (only required for HTTP repositories, not OCI) */}
              {!isOCI && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Chart name <span className="text-red-400">*</span></label>
                    <input
                      type="text"
                      value={chartName}
                      onChange={e => setChartName(e.target.value)}
                      placeholder="e.g. nginx"
                      disabled={step === 'extracting'}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', caretColor: '#7c3aed' }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Version <span style={{ color: 'var(--text-faint)' }}>(optional)</span></label>
                    <input
                      type="text"
                      value={chartVersion}
                      onChange={e => setChartVersion(e.target.value)}
                      placeholder="e.g. 1.2.3"
                      disabled={step === 'extracting'}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', caretColor: '#7c3aed' }}
                    />
                  </div>
                </div>
              )}
              {isOCI && (
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                    Version / tag <span style={{ color: 'var(--text-faint)' }}>(optional — overrides tag in URL)</span>
                  </label>
                  <input
                    type="text"
                    value={chartVersion}
                    onChange={e => setChartVersion(e.target.value)}
                    placeholder="e.g. 1.2.3"
                    disabled={step === 'extracting'}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none font-mono"
                    style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', caretColor: '#7c3aed' }}
                  />
                </div>
              )}

              {extractError && <p className="text-sm text-red-500 dark:text-red-400">{extractError}</p>}

              <button
                type="submit"
                disabled={step === 'extracting' || !chartUrl.trim() || (!isOCI && !chartName.trim())}
                className="w-full py-3 rounded-2xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', boxShadow: '0 0 24px rgba(124,58,237,0.35), inset 0 1px 0 rgba(255,255,255,0.15)' }}
              >
                {step === 'extracting' ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Extracting images…
                  </span>
                ) : 'Extract images →'}
              </button>

              <p className="text-xs text-center" style={{ color: 'var(--text-faint)' }}>
                5 free scans per hour · Public charts only · Powered by Trivy
              </p>
            </form>
          )}

          {/* Helm scan history — shown only on form step */}
          {(step === 'form' || step === 'extracting') && helmHistory.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                <span className="text-xs font-medium px-2" style={{ color: 'var(--text-faint)' }}>Recent scans</span>
                <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
              </div>
              <div className="rounded-2xl overflow-hidden divide-y" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                {helmHistory.slice(0, 5).map(group => {
                  const displayUrl = group.chart_url.replace(/^oci:\/\//, '');
                  const isGroupOCI = group.chart_url.startsWith('oci://');
                  const done = group.scans.filter(s => s.status === 'completed' || s.status === 'failed').length;
                  const critical = group.scans.reduce((a, s) => a + s.critical_count, 0);
                  const high = group.scans.reduce((a, s) => a + s.high_count, 0);
                  return (
                    <button
                      key={group.group_id}
                      onClick={() => restoreGroup(group)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors group"
                      style={{ borderTop: '1px solid var(--row-divider)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {displayUrl}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs px-1.5 py-0.5 rounded font-medium shrink-0"
                            style={{
                              background: isGroupOCI ? 'rgba(124,58,237,0.1)' : 'rgba(59,130,246,0.1)',
                              color: isGroupOCI ? '#a78bfa' : '#60a5fa',
                            }}>
                            {isGroupOCI ? 'OCI' : 'HTTP'}
                          </span>
                          {group.chart_version && (
                            <span className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>v{group.chart_version}</span>
                          )}
                          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                            {done}/{group.scans.length} scanned · {timeAgo(group.created_at)}
                          </span>
                        </div>
                      </div>
                      <div className="hidden sm:flex items-center gap-2 shrink-0 text-xs font-mono">
                        {critical > 0 && <span className="text-red-500">{critical}C</span>}
                        {high > 0 && <span className="text-orange-500">{high}H</span>}
                        {critical === 0 && high === 0 && done === group.scans.length && done > 0 && (
                          <span className="text-emerald-600">Clean</span>
                        )}
                      </div>
                      <svg className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" width="14" height="14"
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        style={{ color: 'var(--text-muted)' }}>
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 2 — Review images */}
          {(step === 'review' || step === 'scanning') && (
            <div className="space-y-4">
              {/* Chart info */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                    {chartInfo.name || 'Chart'}
                    {chartInfo.version && <span className="ml-2 text-xs px-2 py-0.5 rounded-full font-mono"
                      style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.2)' }}>
                      v{chartInfo.version}
                    </span>}
                  </p>
                  <p className="text-xs mt-0.5 font-mono truncate max-w-xs" style={{ color: 'var(--text-faint)' }}>{chartUrl}</p>
                </div>
                <button
                  onClick={() => { setStep('form'); setImages([]); setSelected(new Set()); }}
                  className="text-xs px-3 py-1.5 rounded-xl transition-colors"
                  style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
                >
                  ← Change chart
                </button>
              </div>

              {/* Image list */}
              <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: 'var(--row-divider)' }}>
                  <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                    {images.length} image{images.length !== 1 ? 's' : ''} found · {selected.size} selected
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={selectAll} className="text-xs transition-colors" style={{ color: '#7c3aed' }}>All</button>
                    <span style={{ color: 'var(--border-subtle)' }}>·</span>
                    <button onClick={deselectAll} className="text-xs transition-colors" style={{ color: 'var(--text-faint)' }}>None</button>
                  </div>
                </div>
                <div className="divide-y" style={{ borderColor: 'var(--row-divider)' }}>
                  {images.map(img => (
                    <label key={img.full_ref} className="flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors"
                      style={{ background: selected.has(img.full_ref) ? 'rgba(124,58,237,0.04)' : 'transparent' }}
                      onMouseEnter={e => { if (!selected.has(img.full_ref)) e.currentTarget.style.background = 'var(--row-hover)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = selected.has(img.full_ref) ? 'rgba(124,58,237,0.04)' : 'transparent'; }}>
                      <input
                        type="checkbox"
                        checked={selected.has(img.full_ref)}
                        onChange={() => toggleImage(img.full_ref)}
                        className="mt-0.5 accent-violet-600"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {img.name}:{img.tag}
                        </p>
                        {img.source_path && (
                          <p className="text-xs mt-0.5 font-mono truncate" style={{ color: 'var(--text-faint)' }}>
                            {img.source_path}
                          </p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Platform & scan button */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Platform:</span>
                  {PLATFORMS.map(p => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPlatform(p.value)}
                      className="text-xs px-2.5 py-1 rounded-lg font-mono transition-all"
                      style={platform === p.value
                        ? { background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(167,139,250,0.4)', color: '#7c3aed' }
                        : { background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }
                      }
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {scanError && <p className="text-sm text-red-500 dark:text-red-400">{scanError}</p>}

                <button
                  onClick={handleScan}
                  disabled={selected.size === 0 || step === 'scanning'}
                  className="w-full py-3 rounded-2xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', boxShadow: '0 0 24px rgba(124,58,237,0.35)' }}
                >
                  {step === 'scanning' ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Starting scans…
                    </span>
                  ) : `Scan ${selected.size} image${selected.size !== 1 ? 's' : ''} →`}
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Results (multiple scans) */}
          {(step === 'results' || (step === 'scanning' && scanResults.length > 1)) && scanResults.length > 1 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Scan results
                  <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-faint)' }}>
                    {scanResults.filter(r => r.status === 'completed' || r.status === 'failed').length} / {scanResults.length} done
                  </span>
                </h2>
                <button
                  onClick={() => { sessionStorage.removeItem('helm_active_group'); setStep('form'); setChartUrl(''); setChartName(''); setChartVersion(''); setImages([]); setSelected(new Set()); setScanResults([]); setCurrentGroupId(null); }}
                  className="text-xs px-3 py-1.5 rounded-xl transition-colors"
                  style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
                >
                  Scan another chart
                </button>
              </div>

              <div className="rounded-2xl overflow-hidden divide-y" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                {scanResults.map(r => {
                  const st = statusStyle(r.status);
                  const isActive = r.status === 'pending' || r.status === 'running';
                  return (
                    <div
                      key={r.id}
                      onClick={() => { if (currentGroupId) sessionStorage.setItem('helm_active_group', currentGroupId); router.push(`/public/scan/${r.id}`); }}
                      onKeyDown={e => { if (e.key === 'Enter') { if (currentGroupId) sessionStorage.setItem('helm_active_group', currentGroupId); router.push(`/public/scan/${r.id}`); } }}
                      role="link"
                      tabIndex={0}
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors group"
                      style={{ borderTop: '1px solid var(--row-divider)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {r.image_name}:{r.image_tag}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{timeAgo(r.created_at)}</p>
                      </div>

                      <div className={`flex items-center gap-1.5 text-xs font-medium shrink-0 ${st.color}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${st.dot} ${isActive ? 'animate-pulse' : ''}`} />
                        {r.status}
                      </div>

                      {r.status === 'completed' && (
                        <div className="hidden sm:flex items-center gap-2 shrink-0 text-xs font-mono">
                          {r.critical_count > 0 && <span className="text-red-500">{r.critical_count}C</span>}
                          {r.high_count > 0     && <span className="text-orange-500">{r.high_count}H</span>}
                          {r.medium_count > 0   && <span className="text-yellow-600">{r.medium_count}M</span>}
                          {r.low_count > 0      && <span className="text-blue-500">{r.low_count}L</span>}
                          {r.critical_count === 0 && r.high_count === 0 && r.medium_count === 0 && r.low_count === 0 && (
                            <span className="text-emerald-600">Clean</span>
                          )}
                        </div>
                      )}

                      <svg className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" width="14" height="14"
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        style={{ color: 'var(--text-muted)' }}>
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-center" style={{ color: 'var(--text-faint)' }}>
                Stored locally on this device · Sign in to keep scans permanently
              </p>
            </div>
          )}
        </div>
      </main>

      <footer className="relative z-10 text-center py-6 text-xs" style={{ color: 'var(--text-faint)', borderTop: '1px solid var(--border-subtle)' }}>
        JustScan · Self-hosted image vulnerability scanner
      </footer>
    </div>
  );
}
