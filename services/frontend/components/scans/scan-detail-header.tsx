'use client';

import type { ReactNode } from 'react';

type ScanDetailHeaderProps = {
  navigation?: ReactNode;
  badges?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
};

export function ScanDetailHeader({
  navigation,
  badges,
  title,
  subtitle,
  meta,
  actions,
}: ScanDetailHeaderProps) {
  return (
    <div className="space-y-4">
      {badges ? <div className="flex flex-wrap items-center gap-2">{badges}</div> : null}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          {navigation ? <div className="flex flex-wrap items-center gap-2">{navigation}</div> : null}
          <div className="min-w-0">
            <h1
              className="text-xl font-bold font-mono text-zinc-900 dark:text-white break-words"
              style={{ overflowWrap: 'anywhere' }}
            >
              {title}
            </h1>
            {subtitle ? (
              <div
                className="mt-1 text-xs font-mono text-zinc-500 break-words"
                style={{ overflowWrap: 'anywhere' }}
              >
                {subtitle}
              </div>
            ) : null}
            {meta ? <div className="mt-1">{meta}</div> : null}
          </div>
        </div>
        {actions ? (
          <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto xl:max-w-[48%] xl:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}