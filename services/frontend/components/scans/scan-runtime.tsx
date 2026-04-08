'use client';

import { fullDate, timeAgo } from '@/lib/time';
import { useEffect, useState } from 'react';

export function ScannerDatabaseCard({ label, updatedAt, downloadedAt }: { label: string; updatedAt?: string | null; downloadedAt?: string | null }) {
  return (
    <div className="glass-panel rounded-xl p-4">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className="text-sm font-medium text-zinc-900 dark:text-white" title={updatedAt ? fullDate(updatedAt) : ''}>
        {updatedAt ? `${timeAgo(updatedAt)} (${fullDate(updatedAt)})` : 'Unknown'}
      </p>
      <p className="text-xs text-zinc-500 mt-1" title={downloadedAt ? fullDate(downloadedAt) : ''}>
        Downloaded {downloadedAt ? timeAgo(downloadedAt) : 'unknown'}
      </p>
    </div>
  );
}

export function ScanningAnimation({ status, externalStatus, startedAt }: { status: string; externalStatus?: string; startedAt: string | null }) {
  const [elapsed, setElapsed] = useState(0);
  const [phase, setPhase] = useState(0);
  const warmingArtifactoryCache = externalStatus === 'warming_artifactory_cache';
  const waitingForXray = externalStatus === 'waiting_for_xray';
  const statusTone = waitingForXray
    ? { color: '#f59e0b', background: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)' }
    : warmingArtifactoryCache
      ? { color: '#38bdf8', background: 'rgba(14,165,233,0.12)', border: 'rgba(14,165,233,0.25)' }
      : { color: '#60a5fa', background: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.25)' };

  const phases = [
    'Pulling image layers…',
    'Analyzing OS packages…',
    'Scanning language libraries…',
    'Checking CVE database…',
    'Correlating vulnerabilities…',
    'Building report…',
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      const start = startedAt ? new Date(startedAt).getTime() : Date.now();
      setElapsed(Math.floor((Date.now() - start) / 1000));
      setPhase((previous) => (previous + 1) % phases.length);
    }, 1800);
    return () => clearInterval(timer);
  }, [startedAt]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div className="glass-panel rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.06) 0%, rgba(59,130,246,0.04) 100%)' }}>
      <div className="h-0.5 w-full relative overflow-hidden" style={{ background: 'rgba(124,58,237,0.15)' }}>
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: warmingArtifactoryCache ? '28%' : '33%',
            background: warmingArtifactoryCache
              ? 'linear-gradient(90deg, transparent, #7dd3fc, #38bdf8, transparent)'
              : 'linear-gradient(90deg, transparent, #a78bfa, #60a5fa, transparent)',
            animation: warmingArtifactoryCache ? 'cacheFlow 1.6s linear infinite' : 'scanBar 2s ease-in-out infinite',
          }}
        />
      </div>

      <style>{`
        @keyframes scanBar { 0% { left: -33%; } 100% { left: 100%; } }
        @keyframes cacheFlow { 0% { left: -28%; opacity: 0; } 16% { opacity: 1; } 100% { left: 100%; opacity: 0; } }
        @keyframes radarSweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes ringPulse1 { 0%, 100% { opacity: 0.8; } 50% { opacity: 0.25; } }
        @keyframes ringPulse2 { 0%, 100% { opacity: 0.6; } 50% { opacity: 0.15; } }
        @keyframes ringPulse3 { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.08; } }
        @keyframes cachePacket { 0% { transform: translateX(0) scale(0.92); opacity: 0; } 18% { opacity: 1; } 78% { opacity: 1; } 100% { transform: translateX(58px) scale(1.05); opacity: 0; } }
        @keyframes cacheLayerLift { 0%, 100% { transform: translateY(0); opacity: 0.55; } 50% { transform: translateY(-3px); opacity: 1; } }
        @keyframes cacheSlotGlow { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
        @keyframes cacheDot { 0%, 100% { transform: translateX(0) scale(0.8); opacity: 0.55; } 40% { transform: translateX(4px) scale(1); opacity: 1; } 80% { transform: translateX(8px) scale(0.92); opacity: 0.72; } }
        @keyframes fadePhase { 0% { opacity: 0; transform: translateY(6px); } 15% { opacity: 1; transform: translateY(0); } 85% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-6px); } }
      `}</style>

      <div className="p-10 flex flex-col items-center gap-8">
        {warmingArtifactoryCache ? (
          <svg width="190" height="150" viewBox="0 0 190 150" style={{ overflow: 'visible' }}>
            <defs>
              <linearGradient id="cacheBeam" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(125,211,252,0)" />
                <stop offset="50%" stopColor="rgba(56,189,248,0.75)" />
                <stop offset="100%" stopColor="rgba(125,211,252,0)" />
              </linearGradient>
            </defs>
            <path d="M 70 48 C 90 48, 104 48, 124 48" stroke="rgba(56,189,248,0.18)" strokeWidth="2" strokeLinecap="round" />
            <path d="M 70 75 C 90 75, 104 75, 124 75" stroke="rgba(56,189,248,0.18)" strokeWidth="2" strokeLinecap="round" />
            <path d="M 70 102 C 90 102, 104 102, 124 102" stroke="rgba(56,189,248,0.18)" strokeWidth="2" strokeLinecap="round" />

            <rect x="18" y="40" width="48" height="16" rx="8" fill="rgba(125,211,252,0.16)" stroke="rgba(56,189,248,0.35)" style={{ animation: 'cacheLayerLift 2.2s ease-in-out infinite' }} />
            <rect x="18" y="67" width="48" height="16" rx="8" fill="rgba(125,211,252,0.13)" stroke="rgba(56,189,248,0.3)" style={{ animation: 'cacheLayerLift 2.2s ease-in-out infinite 0.18s' }} />
            <rect x="18" y="94" width="48" height="16" rx="8" fill="rgba(125,211,252,0.1)" stroke="rgba(56,189,248,0.26)" style={{ animation: 'cacheLayerLift 2.2s ease-in-out infinite 0.36s' }} />

            <g style={{ animation: 'cachePacket 1.8s ease-in-out infinite' }}>
              <rect x="73" y="44" width="14" height="9" rx="4.5" fill="#7dd3fc" />
              <rect x="88" y="44" width="31" height="9" rx="4.5" fill="url(#cacheBeam)" />
            </g>
            <g style={{ animation: 'cachePacket 1.8s ease-in-out infinite 0.32s' }}>
              <rect x="73" y="71" width="14" height="9" rx="4.5" fill="#7dd3fc" />
              <rect x="88" y="71" width="31" height="9" rx="4.5" fill="url(#cacheBeam)" />
            </g>
            <g style={{ animation: 'cachePacket 1.8s ease-in-out infinite 0.64s' }}>
              <rect x="73" y="98" width="14" height="9" rx="4.5" fill="#7dd3fc" />
              <rect x="88" y="98" width="31" height="9" rx="4.5" fill="url(#cacheBeam)" />
            </g>

            <rect x="126" y="31" width="46" height="24" rx="10" fill="rgba(14,165,233,0.08)" stroke="rgba(56,189,248,0.24)" />
            <rect x="126" y="63" width="46" height="24" rx="10" fill="rgba(14,165,233,0.08)" stroke="rgba(56,189,248,0.24)" />
            <rect x="126" y="95" width="46" height="24" rx="10" fill="rgba(14,165,233,0.08)" stroke="rgba(56,189,248,0.24)" />

            <rect x="133" y="38" width="13" height="10" rx="5" fill="#38bdf8" style={{ animation: 'cacheSlotGlow 1.8s ease-in-out infinite' }} />
            <rect x="149" y="38" width="16" height="10" rx="5" fill="rgba(125,211,252,0.7)" style={{ animation: 'cacheSlotGlow 1.8s ease-in-out infinite 0.16s' }} />
            <rect x="133" y="70" width="18" height="10" rx="5" fill="rgba(125,211,252,0.8)" style={{ animation: 'cacheSlotGlow 1.8s ease-in-out infinite 0.28s' }} />
            <rect x="154" y="70" width="11" height="10" rx="5" fill="#38bdf8" style={{ animation: 'cacheSlotGlow 1.8s ease-in-out infinite 0.4s' }} />
            <rect x="133" y="102" width="14" height="10" rx="5" fill="#38bdf8" style={{ animation: 'cacheSlotGlow 1.8s ease-in-out infinite 0.52s' }} />
            <rect x="150" y="102" width="15" height="10" rx="5" fill="rgba(125,211,252,0.7)" style={{ animation: 'cacheSlotGlow 1.8s ease-in-out infinite 0.64s' }} />
          </svg>
        ) : (
          <svg width="160" height="160" viewBox="0 0 160 160" style={{ overflow: 'visible' }}>
            <circle cx="80" cy="80" r="76" fill="url(#radarGlow)" />
            <defs>
              <radialGradient id="radarGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.07" />
                <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="80" cy="80" r="76" stroke="rgba(124,58,237,0.18)" strokeWidth="1" fill="none" style={{ animation: 'ringPulse3 3s ease-in-out infinite' }} />
            <circle cx="80" cy="80" r="56" stroke="rgba(124,58,237,0.25)" strokeWidth="1" fill="none" style={{ animation: 'ringPulse2 3s ease-in-out infinite 0.4s' }} />
            <circle cx="80" cy="80" r="36" stroke="rgba(124,58,237,0.35)" strokeWidth="1" fill="none" style={{ animation: 'ringPulse1 3s ease-in-out infinite 0.8s' }} />
            <line x1="4" y1="80" x2="156" y2="80" stroke="rgba(124,58,237,0.12)" strokeWidth="1" />
            <line x1="80" y1="4" x2="80" y2="156" stroke="rgba(124,58,237,0.12)" strokeWidth="1" />
            <g style={{ transformOrigin: '80px 80px', animation: 'radarSweep 3s linear infinite' }}>
              <path d="M 80 80 L 80 4 A 76 76 0 0 1 156 80 Z" fill="rgba(124,58,237,0.13)" />
              <line x1="80" y1="80" x2="80" y2="4" stroke="rgba(167,139,250,0.85)" strokeWidth="1.5" strokeLinecap="round" />
            </g>
            <circle cx="80" cy="80" r="7" fill="rgba(167,139,250,0.2)" />
            <circle cx="80" cy="80" r="3.5" fill="#a78bfa" style={{ filter: 'drop-shadow(0 0 5px rgba(167,139,250,0.9))' }} />
          </svg>
        )}

        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2.5">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-widest" style={{ background: statusTone.background, border: `1px solid ${statusTone.border}`, color: statusTone.color }}>
              <span
                className={`inline-block h-1.5 rounded-full mr-1.5 align-middle ${warmingArtifactoryCache ? 'w-2.5' : 'w-1.5'} ${warmingArtifactoryCache ? '' : 'animate-pulse'}`}
                style={{ background: statusTone.color, animation: warmingArtifactoryCache ? 'cacheDot 1.1s ease-in-out infinite' : undefined }}
              />
              {waitingForXray ? 'Waiting for Xray' : warmingArtifactoryCache ? 'Warming Artifactory Cache' : status === 'running' ? 'Scan in progress' : 'Queued'}
            </span>
            {elapsed > 0 && <span className="text-xs text-zinc-500 font-mono">{elapsedStr}</span>}
          </div>
          <p className="text-sm text-zinc-500" key={phase} style={{ animation: 'fadePhase 1.8s ease-in-out forwards', minHeight: 20 }}>
            {waitingForXray ? 'Xray is still processing this image. Results will import automatically once they are ready.' : warmingArtifactoryCache ? 'JustScan is pulling the image through Artifactory so Xray can index and scan it.' : status === 'pending' ? 'Waiting for scanner…' : phases[phase]}
          </p>
          <p className="text-xs text-zinc-500/50 mt-1">Results will appear automatically when the scan finishes.</p>
        </div>
      </div>
    </div>
  );
}