import { Alert, Button, Card } from '@heroui/react';
import Link from 'next/link';

export function RouteLoadingState({
  title = 'Loading view',
  message = 'Fetching the latest data for this page.',
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div aria-label={title} className="p-6 max-w-5xl mx-auto">
      <Card className="surface-card rounded-3xl p-8 space-y-5">
        <div className="space-y-2">
          <div className="skeleton h-8 w-48 rounded-xl" />
          <div className="skeleton h-4 w-72 rounded-lg" />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="rounded-2xl p-5"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}
            >
              <div className="skeleton h-4 w-24 rounded" />
              <div className="skeleton h-8 w-20 rounded mt-3" />
              <div className="skeleton h-3 w-28 rounded mt-4" />
            </div>
          ))}
        </div>
        <div
          className="rounded-2xl p-5 space-y-3"
          style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}
        >
          <div className="skeleton h-4 w-40 rounded" />
          <div className="skeleton h-3 w-full rounded" />
          <div className="skeleton h-3 w-5/6 rounded" />
          <p className="text-sm text-zinc-500">{message}</p>
        </div>
      </Card>
    </div>
  );
}

export function RouteErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Card className="p-8 space-y-4">
        <Alert className="bg-danger-soft" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{title}</Alert.Title>
            <Alert.Description>{message}</Alert.Description>
          </Alert.Content>
        </Alert>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button variant="outline">
            <Link href="/dashboard" className="btn-secondary">
              Back to dashboard
            </Link>
          </Button>
          <Button onClick={onRetry} variant="primary">
            Retry
          </Button>
        </div>
      </Card>
    </div>
  );
}
