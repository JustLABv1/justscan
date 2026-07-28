'use client';

import { Button } from '@heroui/react';
import type { ReactNode } from 'react';

interface AuthProviderButtonProps {
  href: string;
  label: string;
  icon?: ReactNode;
  onBeforeNavigate?: () => void;
}

export function AuthProviderButton({ href, label, icon, onBeforeNavigate }: AuthProviderButtonProps) {
  return (
    <Button
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
