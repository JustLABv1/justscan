'use client';

import { Button } from '@heroui/react';
import type { ReactNode } from 'react';

interface AuthProviderButtonProps {
  href: string;
  label: string;
  icon?: ReactNode;
}

export function AuthProviderButton({ href, label, icon }: AuthProviderButtonProps) {
  return (
    <Button fullWidth onPress={() => window.location.assign(href)} variant="tertiary">
      {icon}
      {label}
    </Button>
  );
}
