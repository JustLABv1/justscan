'use client';
import React from 'react';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-4 text-center px-6">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.12)' }}
      >
        <span className="text-zinc-400">{icon}</span>
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{title}</p>
        <p className="text-sm text-zinc-500 max-w-xs mx-auto leading-relaxed">{description}</p>
      </div>
      {action && (
        <button
          onClick={action.onClick}
          className="btn-primary mt-1"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
