import { buttonVariants } from '@/components/ui';
import { ArrowLeft01Icon, Search01Icon } from 'hugeicons-react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10 text-foreground sm:px-6">
      <section className="w-full max-w-md">
        <div className="grid size-10 place-items-center rounded-lg border border-border bg-muted text-muted-foreground">
          <Search01Icon size={20} />
        </div>
        <p className="mt-6 text-sm font-medium text-muted-foreground">Error 404</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The page may have moved, or the link may no longer be available.
        </p>
        <div className="mt-6">
          <Link href="/" className={buttonVariants()}>
            <ArrowLeft01Icon size={15} />
            Go home
          </Link>
        </div>
      </section>
    </main>
  );
}
