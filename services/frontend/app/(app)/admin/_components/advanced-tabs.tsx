'use client';

import {
  GlobalRegistriesTab as GlobalRegistriesTabContent,
  IdentityProvidersTab as IdentityProvidersTabContent,
  InsightsTab as InsightsTabContent,
  NotificationsTab as NotificationsTabContent,
  ScansTab as ScansTabContent,
} from '@/components/admin/advanced-tabs-legacy';

export function NotificationsTab() {
  return <NotificationsTabContent />;
}

export function ScansTab() {
  return <ScansTabContent />;
}

export function InsightsTab() {
  return <InsightsTabContent />;
}

export function IdentityProvidersTab() {
  return <IdentityProvidersTabContent />;
}

export function GlobalRegistriesTab() {
  return <GlobalRegistriesTabContent />;
}
