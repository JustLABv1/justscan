'use client';

import { AssistantExperience } from '@/components/assistant/assistant-experience';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { Suspense } from 'react';

export default function AssistantPage() {
  return (
    <PageContainer size="default" className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Assistant"
        description="Ask questions about the current workspace and get help navigating security work."
      />
      <div className="min-h-0 flex-1">
        <Suspense fallback={null}>
          <AssistantExperience />
        </Suspense>
      </div>
    </PageContainer>
  );
}
