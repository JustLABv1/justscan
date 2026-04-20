'use client';

import { getWorkScope, type WorkScope } from '@/lib/api';
import { useEffect, useState } from 'react';

const WORK_SCOPE_EVENT = 'justscan-work-scope-changed';

export function useWorkScope(): WorkScope {
  const [workScope, setWorkScope] = useState<WorkScope>(() => getWorkScope());

  useEffect(() => {
    function handleScopeChanged(event: Event) {
      const detail = (event as CustomEvent<WorkScope>).detail;
      setWorkScope(detail ?? getWorkScope());
    }

    window.addEventListener(WORK_SCOPE_EVENT, handleScopeChanged as EventListener);
    return () => window.removeEventListener(WORK_SCOPE_EVENT, handleScopeChanged as EventListener);
  }, []);

  return workScope;
}