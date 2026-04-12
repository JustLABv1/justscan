'use client';
import { Logo } from '@/components/logo';
import { createPublicHelmScans, extractPublicHelmImages, getPublicHelmScanRun, getPublicSettings, getToken, HelmExtractResponse, PublicSettings, Scan } from '@/lib/api';
import {
  createEditableHelmImages,
  EditableHelmImage,
  getHelmImageSourceLabel,
  parseHelmImageRef,
} from '@/lib/helm-image-overrides';
import { addToHelmPublicHistory, addToPublicHistory, getHelmPublicHistory, PublicHelmRunHistoryEntry, timeAgo, updateHelmPublicHistoryEntry } from '@/lib/publicScanHistory';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const PLATFORMS = [
  { value: '', label: 'Auto (detect)' },
  { value: 'linux/amd64', label: 'linux/amd64' },
  { value: 'linux/arm64', label: 'linux/arm64' },
  { value: 'linux/arm/v7', label: 'linux/arm/v7' },
  { value: 'windows/amd64', label: 'windows/amd64' },
];

type Step = 'form' | 'extracting' | 'review' | 'scanning';

function toRunHistoryEntry(detail: {
  run: {
    id: string;
    chart_url: string;
    chart_name?: string;
    chart_version?: string;
    platform?: string;
    created_at: string;
  };
  items: Array<{ latest_scan: Scan }>;
}): PublicHelmRunHistoryEntry {
  const latestScans = detail.items.map((item) => item.latest_scan);
  return {
    id: detail.run.id,
    chart_url: detail.run.chart_url,
    chart_name: detail.run.chart_name || undefined,
    chart_version: detail.run.chart_version || undefined,
    platform: detail.run.platform || undefined,
    total_images: latestScans.length,
    completed_images: latestScans.filter((scan) => scan.status === 'completed').length,
    failed_images: latestScans.filter((scan) => scan.status === 'failed').length,
    active_images: latestScans.filter((scan) => scan.status !== 'completed' && scan.status !== 'failed').length,
    critical_count: latestScans.reduce((sum, scan) => sum + (scan.critical_count ?? 0), 0),
    high_count: latestScans.reduce((sum, scan) => sum + (scan.high_count ?? 0), 0),
    medium_count: latestScans.reduce((sum, scan) => sum + (scan.medium_count ?? 0), 0),
    low_count: latestScans.reduce((sum, scan) => sum + (scan.low_count ?? 0), 0),
    created_at: detail.run.created_at,
  };
}

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
  const [images, setImages] = useState<EditableHelmImage[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [helmHistory, setHelmHistory] = useState<PublicHelmRunHistoryEntry[]>([]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);

  const isDark = mounted && resolvedTheme === 'dark';
  const isOCI = chartUrl.startsWith('oci://');
  const selectedImages = images.filter((img) => selected.has(img.id));
  const hasInvalidSelection = selectedImages.some((img) => img.edited_ref.trim() === '');
  const isDisabled = settings !== null && (!settings.enabled || settings.local_scan_available === false);
  const disabledMessage = settings?.disabled_reason || 'The administrator has disabled this feature. Please check back later.';

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      const initialHistory = getHelmPublicHistory();
      if (cancelled) return;

      if (initialHistory.length === 0) {
        setHelmHistory([]);
        return;
      }

      const refreshedHistory = await Promise.all(initialHistory.map(async (entry) => {
        try {
          const detail = await getPublicHelmScanRun(entry.id);
          const nextEntry = toRunHistoryEntry(detail);
          updateHelmPublicHistoryEntry(entry.id, nextEntry);
          return nextEntry;
        } catch {
          return entry;
        }
      }));

      if (!cancelled) {
        setHelmHistory(refreshedHistory);
      }
    }

    setMounted(true);
    setIsLoggedIn(!!getToken());
    getPublicSettings().then(setSettings).catch(() => setSettings({ enabled: true, rate_limit_per_hour: 5, local_scan_available: true }));
    loadHistory().catch(() => setHelmHistory(getHelmPublicHistory()));

    return () => {
      cancelled = true;
    };
  }, []);

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
      const extractedImages = Array.isArray(res.images) ? res.images : [];
      const nextImages = createEditableHelmImages(extractedImages);
      setChartInfo({ name: res.chart_name, version: res.chart_version });
      setImages(nextImages);
      setSelected(new Set(nextImages.map((img) => img.id)));
      setStep('review');
    } catch (err: unknown) {
      setExtractError(err instanceof Error ? err.message : 'Failed to extract images');
      setStep('form');
    }
  }

  async function handleScan() {
    setScanError('');
    const selectedImages = images.filter((img) => selected.has(img.id));
    if (selectedImages.length === 0) return;
    if (hasInvalidSelection) {
      setScanError('Each selected image needs a non-empty image reference.');
      return;
    }

    setStep('scanning');
    try {
      const res = await createPublicHelmScans(
        chartUrl.trim(),
        selectedImages.map((img) => ({
          full_ref: img.edited_ref.trim(),
          source_path: getHelmImageSourceLabel(img),
        })),
        platform || undefined,
        chartInfo.name || undefined,
        chartInfo.version || undefined,
      );

      if (!res.run?.id) {
        throw new Error('Helm run was created without a persisted run ID');
      }

      // Add to localStorage history
      (res.scans ?? []).forEach((scan: Scan) => addToPublicHistory({
        id: scan.id,
        image_name: scan.image_name,
        image_tag: scan.image_tag,
        platform: platform || undefined,
        status: scan.status,
        critical_count: scan.critical_count ?? 0,
        high_count: scan.high_count ?? 0,
        medium_count: scan.medium_count ?? 0,
        low_count: scan.low_count ?? 0,
        unknown_count: 0,
        created_at: scan.created_at,
      }));

      const createdEntry: PublicHelmRunHistoryEntry = {
        id: res.run.id,
        chart_url: res.run.chart_url,
        chart_name: res.run.chart_name || undefined,
        chart_version: res.run.chart_version || undefined,
        platform: res.run.platform || undefined,
        total_images: res.scans.length,
        completed_images: res.scans.filter((scan) => scan.status === 'completed').length,
        failed_images: res.scans.filter((scan) => scan.status === 'failed').length,
        active_images: res.scans.filter((scan) => scan.status !== 'completed' && scan.status !== 'failed').length,
        critical_count: res.scans.reduce((sum, scan) => sum + (scan.critical_count ?? 0), 0),
        high_count: res.scans.reduce((sum, scan) => sum + (scan.high_count ?? 0), 0),
        medium_count: res.scans.reduce((sum, scan) => sum + (scan.medium_count ?? 0), 0),
        low_count: res.scans.reduce((sum, scan) => sum + (scan.low_count ?? 0), 0),
        created_at: res.run.created_at,
      };
      addToHelmPublicHistory(createdEntry);
      setHelmHistory(getHelmPublicHistory());
      router.push(`/public/scan/helm/runs/${res.run.id}`);
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : 'Failed to start scans');
      setStep('review');
    }
  }

  function toggleImage(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateEditedRef(id: string, value: string) {
    setImages((prev) => prev.map((image) => (
      image.id === id ? { ...image, edited_ref: value } : image
    )));
  }

  function selectAll() { setSelected(new Set(images.map((image) => image.id))); }
  function deselectAll() { setSelected(new Set()); }

  function openRun(run: PublicHelmRunHistoryEntry) {
    router.push(`/public/scan/helm/runs/${run.id}`);
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

              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                Override any extracted image reference before scanning. Selected rows will use the edited values.
              </p>
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
          {(step === 'form' || step === 'extracting') && isDisabled && (
            <div className="rounded-2xl px-6 py-5 text-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <p className="text-red-500 dark:text-red-400 font-medium">Public Helm scanning is temporarily disabled</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{disabledMessage}</p>
            </div>
          )}

          {(step === 'form' || step === 'extracting') && !isDisabled && (
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
                {settings?.rate_limit_per_hour ?? 5} free scans per hour · Public charts only
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
                {helmHistory.slice(0, 5).map((run) => {
                  const displayUrl = run.chart_url.replace(/^oci:\/\//, '');
                  const isGroupOCI = run.chart_url.startsWith('oci://');
                  return (
                    <button
                      key={run.id}
                      onClick={() => openRun(run)}
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
                          {run.chart_version && (
                            <span className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>v{run.chart_version}</span>
                          )}
                          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                            {run.completed_images + run.failed_images}/{run.total_images} scanned · {timeAgo(run.created_at)}
                          </span>
                        </div>
                      </div>
                      <div className="hidden sm:flex items-center gap-2 shrink-0 text-xs font-mono">
                        {run.critical_count > 0 && <span className="text-red-500">{run.critical_count}C</span>}
                        {run.high_count > 0 && <span className="text-orange-500">{run.high_count}H</span>}
                        {run.critical_count === 0 && run.high_count === 0 && run.completed_images > 0 && run.active_images === 0 && run.failed_images === 0 && (
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

              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                Override any extracted image reference before scanning. Selected rows will use the edited values.
              </p>

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
                  {images.map((img) => {
                    const parsed = parseHelmImageRef(img.edited_ref);
                    const checked = selected.has(img.id);

                    return (
                      <div
                        key={img.id}
                        className="flex items-start gap-3 px-4 py-3 transition-colors"
                        style={{ background: checked ? 'rgba(124,58,237,0.04)' : 'transparent' }}
                        onMouseEnter={e => { if (!checked) e.currentTarget.style.background = 'var(--row-hover)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = checked ? 'rgba(124,58,237,0.04)' : 'transparent'; }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleImage(img.id)}
                          className="mt-0.5 accent-violet-600"
                        />
                        <div className="flex-1 min-w-0">
                          <input
                            type="text"
                            value={img.edited_ref}
                            onChange={(event) => updateEditedRef(img.id, event.target.value)}
                            className="w-full bg-transparent text-sm font-mono font-medium outline-none"
                            style={{ color: 'var(--text-primary)', caretColor: '#7c3aed' }}
                            placeholder="registry.example.com/org/image:tag"
                          />
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <p className="text-xs font-mono truncate" style={{ color: 'var(--text-faint)' }}>
                              {parsed.name || 'Enter an image reference'}
                            </p>
                            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                              style={{ background: 'rgba(124,58,237,0.08)', color: '#7c3aed' }}>
                              {parsed.tag || '—'}
                            </span>
                          </div>
                          {img.source_path && (
                            <p className="text-xs mt-1 font-mono truncate" style={{ color: 'var(--text-faint)' }}>
                              {getHelmImageSourceLabel(img)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
                  disabled={selected.size === 0 || step === 'scanning' || hasInvalidSelection}
                  className="w-full py-3 rounded-2xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', boxShadow: '0 0 24px rgba(124,58,237,0.35)' }}
                >
                  {step === 'scanning' ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Creating Helm run…
                    </span>
                  ) : `Scan ${selected.size} image${selected.size !== 1 ? 's' : ''} →`}
                </button>
              </div>
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
