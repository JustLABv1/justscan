'use client';

import { fullDate, timeAgo } from '@/lib/time';
import { useEffect, useState } from 'react';

export function ScannerDatabaseCard({ label, updatedAt, downloadedAt }: { label: string; updatedAt?: string | null; downloadedAt?: string | null }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}>
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
  const waitingForXray = externalStatus === 'waiting_for_xray';

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
        <div className="absolute inset-y-0 left-0 w-1/3" style={{ background: 'linear-gradient(90deg, transparent, #a78bfa, #60a5fa, transparent)', animation: 'scanBar 2s ease-in-out infinite' }} />
      </div>

      <style>{`
        @keyframes scanBar { 0% { left: -33%; } 100% { left: 100%; } }
        @keyframes radarSweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes ringPulse1 { 0%, 100% { opacity: 0.8; } 50% { opacity: 0.25; } }
        @keyframes ringPulse2 { 0%, 100% { opacity: 0.6; } 50% { opacity: 0.15; } }
        @keyframes ringPulse3 { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.08; } }
        @keyframes fadePhase { 0% { opacity: 0; transform: translateY(6px); } 15% { opacity: 1; transform: translateY(0); } 85% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-6px); } }
      `}</style>

      <div className="p-10 flex flex-col items-center gap-8">
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

        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2.5">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-widest" style={{ background: waitingForXray ? 'rgba(245,158,11,0.12)' : status === 'running' ? 'rgba(59,130,246,0.12)' : 'rgba(161,161,170,0.1)', border: `1px solid ${waitingForXray ? 'rgba(245,158,11,0.25)' : status === 'running' ? 'rgba(59,130,246,0.25)' : 'rgba(161,161,170,0.2)'}`, color: waitingForXray ? '#f59e0b' : status === 'running' ? '#60a5fa' : '#a1a1aa' }}>
              <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle animate-pulse" style={{ background: waitingForXray ? '#f59e0b' : status === 'running' ? '#60a5fa' : '#a1a1aa' }} />
              {waitingForXray ? 'Waiting for Xray' : status === 'running' ? 'Scan in progress' : 'Queued'}
            </span>
            {elapsed > 0 && <span className="text-xs text-zinc-500 font-mono">{elapsedStr}</span>}
          </div>
          <p className="text-sm text-zinc-500" key={phase} style={{ animation: 'fadePhase 1.8s ease-in-out forwards', minHeight: 20 }}>
            {waitingForXray ? 'Xray is still processing this image. Results will import automatically once they are ready.' : status === 'pending' ? 'Waiting for scanner…' : phases[phase]}
          </p>
          <p className="text-xs text-zinc-500/50 mt-1">Results will appear automatically when the scan finishes.</p>
        </div>
      </div>
    </div>
  );
}