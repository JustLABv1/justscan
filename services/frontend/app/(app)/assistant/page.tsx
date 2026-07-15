'use client';

import { AssistantExperience } from '@/components/assistant/assistant-experience';
import { PageHeader } from '@/components/ui/page-header';
import { Suspense } from 'react';

export default function AssistantPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-6 md:px-6 xl:py-7">
      <PageHeader
        title="Assistant"
        description="Ask questions about the current workspace and get help navigating security work."
      />
      <div className="mt-5 min-h-0 flex-1">
        <Suspense fallback={null}>
          <AssistantExperience />
        </Suspense>
      </div>
    </div>
  );
}
