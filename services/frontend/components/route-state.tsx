'use client';

import { buttonVariants, Button, Card } from '@/components/ui';
import {
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  Copy01Icon,
  RefreshIcon,
  Tick02Icon,
} from 'hugeicons-react';
import Link from 'next/link';
import { deferEffect } from '@/lib/defer-effect';
import { useEffect, useState } from 'react';

export function RouteLoadingState({
  title = 'Loading view',
  message = 'Fetching the latest data for this page.',
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div aria-label={title} className="p-6 max-w-5xl mx-auto">
      <Card className="surface-card rounded-xl p-8 space-y-5">
        <div className="space-y-2">
          <div className="skeleton h-8 w-48 rounded-xl" />
          <div className="skeleton h-4 w-72 rounded-lg" />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="rounded-xl p-5"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}
            >
              <div className="skeleton h-4 w-24 rounded" />
              <div className="skeleton h-8 w-20 rounded mt-3" />
              <div className="skeleton h-3 w-28 rounded mt-4" />
            </div>
          ))}
        </div>
        <div
          className="rounded-xl p-5 space-y-3"
          style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}
        >
          <div className="skeleton h-4 w-40 rounded" />
          <div className="skeleton h-3 w-full rounded" />
          <div className="skeleton h-3 w-5/6 rounded" />
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </Card>
    </div>
  );
}

export function RouteErrorState({
  title,
  message,
  onRetry,
  error,
  homeHref = '/dashboard',
  homeLabel = 'Back to dashboard',
}: {
  title: string;
  message: string;
  onRetry: () => void;
  /** The error passed to the route's error boundary, shown under Technical details. */
  error?: Error & { digest?: string };
  homeHref?: string;
  homeLabel?: string;
}) {
  const [location, setLocation] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(
    () =>
      deferEffect(() => {
        setLocation(window.location.pathname + window.location.search);
        setOccurredAt(new Date().toISOString());
      }),
    []
  );

  const errorText = error ? error.message || error.name || 'Unknown error' : '';
  const details = [
    errorText && `Error: ${errorText}`,
    error?.digest && `Error ID: ${error.digest}`,
    location && `Page: ${location}`,
    occurredAt && `Time: ${occurredAt}`,
  ]
    .filter(Boolean)
    .join('\n');

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="flex min-h-[calc(100dvh-10rem)] items-center justify-center px-4 py-10 sm:px-6">
      <div
        aria-live="polite"
        className="w-full max-w-md duration-300 animate-in fade-in slide-in-from-bottom-1"
        role="alert"
      >
        <div className="grid size-10 place-items-center rounded-lg border border-border bg-muted text-destructive">
          <AlertCircleIcon size={20} />
        </div>
        <p className="mt-6 text-sm font-medium text-muted-foreground">Something went wrong</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{message}</p>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button onClick={onRetry}>
            <RefreshIcon size={15} />
            Try again
          </Button>
          <Link className={buttonVariants({ variant: 'outline' })} href={homeHref}>
            <ArrowLeft01Icon size={15} />
            {homeLabel}
          </Link>
        </div>

        {details ? (
          <details className="group mt-8 rounded-lg border border-border bg-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
              Technical details
              <ArrowDown01Icon className="transition-transform group-open:rotate-180" size={16} />
            </summary>
            <div className="space-y-3 border-t border-border px-4 py-3">
              <pre className="max-h-48 overflow-auto font-mono text-xs leading-5 break-words whitespace-pre-wrap text-foreground">
                {details}
              </pre>
              <Button onClick={copyDetails} size="sm" variant="ghost">
                {copied ? <Tick02Icon size={14} /> : <Copy01Icon size={14} />}
                {copied ? 'Copied' : 'Copy details'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Include these details when you report the problem.
              </p>
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}
