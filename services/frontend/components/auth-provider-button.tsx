'use client';

import { Button } from '@heroui/react';
import type { ReactNode } from 'react';

interface AuthProviderButtonProps {
  href: string;
  label: string;
  icon?: ReactNode;
  className?: string;
  onBeforeNavigate?: () => void;
}

export function AuthProviderButton({
  href,
  label,
  icon,
  className,
  onBeforeNavigate,
}: AuthProviderButtonProps) {
  return (
    <Button
      className={className}
      fullWidth
      onPress={() => {
        onBeforeNavigate?.();
        window.location.assign(href);
      }}
      variant="tertiary"
    >
      {icon}
      {label}
    </Button>
  );
}
