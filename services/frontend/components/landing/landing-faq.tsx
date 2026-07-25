'use client';

import { Accordion } from '@heroui/react';
import { ArrowDown01Icon } from 'hugeicons-react';

const FAQ_ITEMS = [
  {
    question: 'Is JustScan fully self-hosted?',
    answer:
      'Yes. You deploy JustScan with Docker Compose or Helm and keep the application, scan data, credentials, and security workflow inside infrastructure you control.',
  },
  {
    question: 'Which scanning engines does JustScan support?',
    answer:
      'JustScan supports its built-in Trivy workflow and Artifactory Xray. Teams can use the engine that matches each registry and keep the results in one consistent review experience.',
  },
  {
    question: 'What can I scan from the CLI?',
    answer:
      'The CLI can submit registry images, stream images from a local Docker or Podman daemon, and upload local or HTTPS-hosted OCI archives. It waits for the same server-side policy verdict used by the web application.',
  },
  {
    question: 'How does the GitOps workflow work?',
    answer:
      'Connect a Git repository and JustScan discovers container images declared in supported manifests. You can review the discovered workloads, run scans immediately, or schedule the repository for recurring discovery and scanning.',
  },
  {
    question: 'Can I scan private registries?',
    answer:
      'Yes. Registry connections support authenticated pull workflows, and stored registry credentials are encrypted at rest.',
  },
  {
    question: 'Are Collectors available today?',
    answer:
      'Not yet. Collectors are an upcoming capability currently being planned. The landing-page preview communicates the intended direction without presenting the feature as generally available.',
  },
] as const;

export function LandingFaq() {
  return (
    <Accordion
      className="w-full rounded-2xl border border-divider/70 bg-surface-secondary/55 px-2 sm:px-4"
      defaultExpandedKeys={['faq-0']}
      variant="surface"
    >
      {FAQ_ITEMS.map((item, index) => (
        <Accordion.Item key={`faq-${index}`} id={`faq-${index}`}>
          <Accordion.Heading>
            <Accordion.Trigger className="min-h-16 text-left text-base font-medium text-foreground sm:min-h-18">
              <span className="mr-4 flex size-7 shrink-0 items-center justify-center rounded-lg border border-divider/70 bg-surface text-xs font-mono text-muted">
                {String(index + 1).padStart(2, '0')}
              </span>
              {item.question}
              <Accordion.Indicator className="text-muted [&>svg]:size-4">
                <ArrowDown01Icon aria-hidden />
              </Accordion.Indicator>
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className="pb-6 pl-11 text-sm leading-7 text-muted sm:pl-12">
              {item.answer}
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}
