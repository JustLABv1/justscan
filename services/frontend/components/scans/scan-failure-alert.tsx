import { getScanFailurePresentation } from '@/lib/scan-failure';
import { Alert, Disclosure } from '@heroui/react';

type ScanFailureAlertProps = {
  errorMessage?: string;
  imageReference?: string;
};

export function ScanFailureAlert({ errorMessage, imageReference }: ScanFailureAlertProps) {
  const presentation = getScanFailurePresentation(errorMessage, imageReference);

  return (
    <Alert status="danger">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{presentation.title}</Alert.Title>
        <Alert.Description>
          {presentation.description} {presentation.guidance}
        </Alert.Description>

        {errorMessage && (
          <Disclosure className="mt-3">
            <Disclosure.Heading>
              <Disclosure.Trigger className="flex items-center gap-2 text-sm font-medium text-foreground">
                Technical details
                <Disclosure.Indicator />
              </Disclosure.Trigger>
            </Disclosure.Heading>
            <Disclosure.Content>
              <Disclosure.Body className="pt-2">
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-surface-secondary p-3 text-xs leading-relaxed text-muted">
                  {errorMessage}
                </pre>
              </Disclosure.Body>
            </Disclosure.Content>
          </Disclosure>
        )}
      </Alert.Content>
    </Alert>
  );
}
