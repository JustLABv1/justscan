import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MaintenancePageClient } from './maintenance-page-client';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
const FALLBACK_MESSAGE = 'JustScan is currently undergoing maintenance. Please check back shortly.';

export const metadata: Metadata = {
  title: 'Maintenance | JustScan',
};

async function getMaintenanceSettings() {
  try {
    const response = await fetch(`${API}/api/v1/public/maintenance`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as { enabled: boolean; message?: string };
  } catch {
    return null;
  }
}

export default async function MaintenancePage() {
  const maintenance = await getMaintenanceSettings();

  if (!maintenance?.enabled) {
    redirect('/');
  }

  const message = maintenance.message?.trim() || FALLBACK_MESSAGE;

  return <MaintenancePageClient message={message} />;
}
