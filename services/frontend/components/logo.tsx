import Image from 'next/image';

export function Logo({ className, size }: { className?: string; size?: number }) {
  const s = size || 24;
  const combinedClassName = `select-none invert dark:invert-0 ${className ?? ''}`.trim();

  return (
    <Image
      src="/justscan-logo.png"
      alt="JustScan logo"
      width={s}
      height={s}
      className={combinedClassName}
      priority
    />
  );
}
