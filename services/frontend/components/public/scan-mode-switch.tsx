import { cn } from '@/lib/utils';
import { IrisScanIcon, PackageIcon } from 'hugeicons-react';
import Link from 'next/link';

const MODES = [
  { id: 'image', label: 'Container image', href: '/public/scan/image', icon: IrisScanIcon },
  { id: 'helm', label: 'Helm chart', href: '/public/scan/helm', icon: PackageIcon },
] as const;

/** Switch between the public image and Helm chart scanners. */
export function ScanModeSwitch({ active }: { active: 'image' | 'helm' }) {
  return (
    <nav
      aria-label="What to scan"
      className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-sm text-muted-foreground"
    >
      {MODES.map((mode) => {
        const Icon = mode.icon;
        const current = mode.id === active;
        return (
          <Link
            key={mode.id}
            href={mode.href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-3 font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              current ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground'
            )}
          >
            <Icon size={14} aria-hidden />
            {mode.label}
          </Link>
        );
      })}
    </nav>
  );
}
