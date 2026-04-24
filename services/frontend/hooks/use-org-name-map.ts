'use client';

import { listOrgs, type Org } from '@/lib/api';
import { useEffect, useState } from 'react';

export function useOrgDirectory() {
  const [orgs, setOrgs] = useState<Org[]>([]);

  useEffect(() => {
    let active = true;

    listOrgs()
      .then((nextOrgs) => {
        if (!active) return;
        setOrgs(nextOrgs);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const orgNamesById = Object.fromEntries(orgs.map((org) => [org.id, org.name]));

  return { orgs, orgNamesById };
}

export function useOrgNameMap() {
  const { orgNamesById } = useOrgDirectory();
  return orgNamesById;
}