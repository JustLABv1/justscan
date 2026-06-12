'use client';

import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import {
  createOrgToken,
  createPipelineScanWithToken,
  getPipelineScanWithToken,
  type Org,
  type PipelineScanResult,
  type PipelineVerdictConfig,
} from '@/lib/api';
import { getApiBase } from '@/lib/api/base';
import { generateCITemplate, type CIProvider } from '@/lib/ci-templates';
import { deferEffect } from '@/lib/defer-effect';
import {
  Accordion,
  Alert,
  Button,
  Card,
  Chip,
  Label,
  ListBox,
  ProgressBar,
  Select,
  Switch,
  Tabs,
} from '@heroui/react';
import {
  CheckmarkCircle02Icon,
  Copy01Icon,
  Download01Icon,
  Key01Icon,
  PlayIcon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

const STEPS = ['Prepare', 'Configure', 'Credential', 'Verify', 'Install'] as const;
const PROVIDERS: Array<{ id: CIProvider; label: string; description: string }> = [
  {
    id: 'github_actions',
    label: 'GitHub Actions',
    description: 'Workflow YAML using repository secrets.',
  },
  { id: 'gitlab_ci', label: 'GitLab CI', description: 'Job YAML using masked CI/CD variables.' },
  {
    id: 'generic',
    label: 'Generic shell',
    description: 'Portable curl and jq script for any runner.',
  },
  {
    id: 'n8n',
    label: 'n8n',
    description: 'HTTP trigger, polling loop, and verdict branch recipe.',
  },
];

function defaultPublicURL() {
  if (typeof window === 'undefined') return '';
  return getApiBase() || window.location.origin;
}

function terminalVerdict(verdict?: string) {
  return verdict === 'pass' || verdict === 'fail' || verdict === 'error';
}

function ReadinessItem({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-divider/70 bg-surface-secondary px-4 py-3">
      <Chip color={ready ? 'success' : 'danger'} size="sm" variant="soft">
        {ready ? 'Ready' : 'Blocked'}
      </Chip>
      <span className="text-sm">{children}</span>
    </div>
  );
}

function CodeBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-divider/70 bg-surface-secondary">
      <div className="flex items-center justify-end border-b border-divider/70 px-3 py-2">
        <Button size="sm" variant="secondary" onPress={() => void copy()}>
          <Copy01Icon size={14} />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="max-h-[480px] overflow-auto p-4 text-xs leading-relaxed">
        <code>{value}</code>
      </pre>
    </div>
  );
}

interface OrgCICDTabProps {
  org: Org;
  canManageTokens: boolean;
}

export function OrgCICDTab({ org, canManageTokens }: OrgCICDTabProps) {
  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState<CIProvider>('github_actions');
  const [publicURL, setPublicURL] = useState('');
  const [severity, setSeverity] = useState<PipelineVerdictConfig['fail_on_severity']>('high');
  const [failOnScanError, setFailOnScanError] = useState(true);
  const [failOnXrayBlock, setFailOnXrayBlock] = useState(true);
  const [timeoutMinutes, setTimeoutMinutes] = useState(30);
  const [callbackURL, setCallbackURL] = useState('');
  const [callbackSecret, setCallbackSecret] = useState('');
  const [token, setToken] = useState('');
  const [tokenName, setTokenName] = useState('CI/CD pipeline');
  const [creatingToken, setCreatingToken] = useState(false);
  const [tokenError, setTokenError] = useState('');
  const [image, setImage] = useState('alpine:latest');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [result, setResult] = useState<PipelineScanResult | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    const cancelInitialization = deferEffect(() => setPublicURL(defaultPublicURL()));
    return () => {
      cancelInitialization();
      cancelledRef.current = true;
    };
  }, []);

  const verdict = useMemo<PipelineVerdictConfig>(
    () => ({
      fail_on_severity: severity,
      fail_on_scan_error: failOnScanError,
      fail_on_xray_block: failOnXrayBlock,
    }),
    [failOnScanError, failOnXrayBlock, severity]
  );
  const template = useMemo(
    () =>
      generateCITemplate({
        provider,
        publicURL,
        orgId: org.id,
        timeoutMinutes,
        verdict,
        callbackURL: callbackURL.trim() || undefined,
        callbackSecretVariable: callbackURL.trim() ? 'env.JUSTSCAN_CALLBACK_SECRET' : undefined,
      }),
    [callbackURL, org.id, provider, publicURL, timeoutMinutes, verdict]
  );
  const providerInfo = PROVIDERS.find((item) => item.id === provider) ?? PROVIDERS[0];

  async function createCredential() {
    setCreatingToken(true);
    setTokenError('');
    try {
      const created = await createOrgToken(
        org.id,
        tokenName.trim() || 'CI/CD pipeline',
        90 * 24 * 60 * 60,
        'pipeline_scan'
      );
      setToken(created.key);
    } catch (error) {
      setTokenError(error instanceof Error ? error.message : 'Failed to create pipeline token');
    } finally {
      setCreatingToken(false);
    }
  }

  async function verify() {
    setVerifying(true);
    setVerifyError('');
    setResult(null);
    cancelledRef.current = false;
    try {
      const accepted = await createPipelineScanWithToken(publicURL, org.id, token, {
        image: image.trim(),
        source: provider === 'generic' ? 'generic' : provider,
        external_ref: `onboarding-${Date.now()}`,
        callback: callbackURL.trim()
          ? { url: callbackURL.trim(), secret: callbackSecret.trim() }
          : undefined,
        verdict,
      });
      const deadline = Date.now() + timeoutMinutes * 60_000;
      while (!cancelledRef.current && Date.now() < deadline) {
        const next = await getPipelineScanWithToken(accepted.status_url, token);
        if (cancelledRef.current) return;
        setResult(next);
        if (terminalVerdict(next.verdict)) return;
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
      }
      if (!cancelledRef.current) throw new Error(`Timed out after ${timeoutMinutes} minutes`);
    } catch (error) {
      setVerifyError(error instanceof Error ? error.message : 'Verification failed');
    } finally {
      setVerifying(false);
    }
  }

  function downloadTemplate() {
    const extension =
      provider === 'github_actions' || provider === 'gitlab_ci'
        ? 'yml'
        : provider === 'n8n'
          ? 'json'
          : 'sh';
    const blob = new Blob([template], { type: 'text/plain;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `justscan-${provider}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  return (
    <div className="space-y-6">
      <Card>
        <Card.Header>
          <Card.Title>Connect JustScan to CI/CD</Card.Title>
          <Card.Description>
            Prepare a least-privilege credential, verify a real scan, and install a blocking
            pipeline template.
          </Card.Description>
        </Card.Header>
        <Card.Content className="space-y-4">
          <ProgressBar
            aria-label="CI/CD onboarding progress"
            maxValue={STEPS.length}
            value={step + 1}
          >
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
          <Tabs selectedKey={String(step)} onSelectionChange={(key) => setStep(Number(key))}>
            <Tabs.ListContainer className="overflow-x-auto">
              <Tabs.List aria-label="CI/CD onboarding steps" className="min-w-max">
                {STEPS.map((label, index) => (
                  <Tabs.Tab key={label} id={String(index)}>
                    {index + 1}. {label}
                    <Tabs.Indicator />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
        </Card.Content>
      </Card>

      {step === 0 && (
        <Card>
          <Card.Header>
            <Card.Title>How the integration works</Card.Title>
            <Card.Description>
              Your runner sends an image reference, JustScan scans it, then the runner polls until
              the configured verdict is ready.
            </Card.Description>
          </Card.Header>
          <Card.Content className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              {[
                'Submit image and gate settings',
                'Scan in this organization',
                'Pass or fail the CI job',
              ].map((label, index) => (
                <div
                  key={label}
                  className="flex items-center gap-3 rounded-2xl border border-divider/70 bg-surface-secondary p-4"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/12 text-sm font-semibold text-accent">
                    {index + 1}
                  </span>
                  <p className="text-sm font-medium">{label}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <ReadinessItem ready={org.is_active}>Organization is active</ReadinessItem>
              <ReadinessItem ready={org.allow_image_scans}>Image scanning is enabled</ReadinessItem>
              <ReadinessItem ready={org.allow_org_tokens}>
                Organization tokens are enabled
              </ReadinessItem>
              <ReadinessItem ready>
                Public images work immediately; private images require an accessible registry.
              </ReadinessItem>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                render={(props: any) => <Link {...props} href="/registries" />}
              >
                Review registries
              </Button>
              <Button
                variant="secondary"
                render={(props: any) => <Link {...props} href={`/orgs/${org.id}?tab=access`} />}
              >
                Manage tokens
              </Button>
            </div>
          </Card.Content>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <Card.Header>
            <Card.Title>Configure pipeline behavior</Card.Title>
          </Card.Header>
          <Card.Content className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2">
              {PROVIDERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setProvider(item.id)}
                  className={`rounded-2xl border p-4 text-left transition-colors ${provider === item.id ? 'border-accent bg-accent/10' : 'border-divider/70 bg-surface-secondary'}`}
                >
                  <p className="font-medium">{item.label}</p>
                  <p className="mt-1 text-xs text-muted">{item.description}</p>
                </button>
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                label="Public JustScan URL"
                value={publicURL}
                onChange={(event) => setPublicURL(event.target.value)}
                placeholder="https://justscan.example.com"
              />
              <Select
                className="w-full"
                value={severity}
                variant="secondary"
                onChange={(value) =>
                  setSeverity(String(value) as PipelineVerdictConfig['fail_on_severity'])
                }
              >
                <Label>Fail on severity</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {['none', 'low', 'medium', 'high', 'critical'].map((value) => (
                      <ListBox.Item key={value} id={value}>
                        {value.toUpperCase()}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <FormField
                label="Timeout in minutes"
                type="number"
                min={1}
                max={120}
                value={String(timeoutMinutes)}
                onChange={(event) =>
                  setTimeoutMinutes(Math.max(1, Number(event.target.value) || 1))
                }
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Switch isSelected={failOnScanError} onChange={setFailOnScanError}>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <Switch.Content>
                  <Label>Fail on scan errors</Label>
                </Switch.Content>
              </Switch>
              <Switch isSelected={failOnXrayBlock} onChange={setFailOnXrayBlock}>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <Switch.Content>
                  <Label>Fail on Xray policy blocks</Label>
                </Switch.Content>
              </Switch>
            </div>
            <Accordion variant="surface">
              <Accordion.Item>
                <Accordion.Heading>
                  <Accordion.Trigger>
                    Advanced: signed completion callback
                    <Accordion.Indicator />
                  </Accordion.Trigger>
                </Accordion.Heading>
                <Accordion.Panel>
                  <Accordion.Body className="grid gap-4 md:grid-cols-2">
                    <FormField
                      label="Callback URL"
                      value={callbackURL}
                      onChange={(event) => setCallbackURL(event.target.value)}
                      placeholder="https://automation.example.com/callback"
                    />
                    <FormField
                      label="Callback secret"
                      type="password"
                      value={callbackSecret}
                      onChange={(event) => setCallbackSecret(event.target.value)}
                      placeholder="Used to sign callback payloads"
                    />
                  </Accordion.Body>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          </Card.Content>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <Card.Header>
            <Card.Title>Create a pipeline-scoped credential</Card.Title>
            <Card.Description>
              This token can only create and read pipeline scans for this organization.
            </Card.Description>
          </Card.Header>
          <Card.Content className="space-y-4">
            {tokenError ? (
              <FormAlert description={tokenError} title="Token creation failed" />
            ) : null}
            {canManageTokens ? (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <FormField
                  label="Token name"
                  value={tokenName}
                  onChange={(event) => setTokenName(event.target.value)}
                  placeholder="CI/CD pipeline"
                />
                <Button isDisabled={creatingToken} onPress={() => void createCredential()}>
                  <Key01Icon size={15} />
                  {creatingToken ? 'Creating...' : 'Create 90-day token'}
                </Button>
              </div>
            ) : (
              <FormAlert
                status="warning"
                title="Admin help required"
                description="You can prepare the template, but an organization admin must create a pipeline-scoped token for you."
              />
            )}
            <Alert status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>The token is shown once</Alert.Title>
                <Alert.Description>
                  Store it as your provider&apos;s JUSTSCAN_ORG_TOKEN secret. It is held only in
                  this page&apos;s memory.
                </Alert.Description>
              </Alert.Content>
            </Alert>
            <FormField
              label="Newly generated or existing pipeline token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste a pipeline-scoped org token"
            />
            {token ? <CodeBlock value={token} /> : null}
          </Card.Content>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <Card.Header>
            <Card.Title>Verify with a real scan</Card.Title>
            <Card.Description>
              A terminal verdict proves the token and pipeline API work from this browser.
            </Card.Description>
          </Card.Header>
          <Card.Content className="space-y-4">
            <Alert status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>
                  Browser verification does not prove that your external CI runner can reach the
                  configured JustScan URL.
                </Alert.Description>
              </Alert.Content>
            </Alert>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <FormField
                label="Verification image"
                value={image}
                onChange={(event) => setImage(event.target.value)}
                placeholder="alpine:latest"
              />
              <Button
                isDisabled={verifying || !token.trim() || !image.trim() || !publicURL.trim()}
                onPress={() => void verify()}
              >
                <PlayIcon size={15} />
                {verifying ? 'Scanning...' : 'Run verification scan'}
              </Button>
            </div>
            {verifyError ? (
              <FormAlert description={verifyError} title="Verification failed" />
            ) : null}
            {result ? (
              <Card variant="secondary">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip
                    color={terminalVerdict(result.verdict) ? 'success' : 'accent'}
                    variant="soft"
                  >
                    {terminalVerdict(result.verdict)
                      ? 'Connectivity verified'
                      : result.current_step}
                  </Chip>
                  <Chip
                    color={
                      result.verdict === 'pass'
                        ? 'success'
                        : result.verdict === 'pending'
                          ? 'accent'
                          : 'danger'
                    }
                    variant="soft"
                  >
                    Verdict: {result.verdict}
                  </Chip>
                  {callbackURL ? (
                    <Chip variant="soft">Callback: {result.callback?.status || 'waiting'}</Chip>
                  ) : null}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                  <span>Critical: {result.critical_count}</span>
                  <span>High: {result.high_count}</span>
                  <span>Medium: {result.medium_count}</span>
                  <span>Low: {result.low_count}</span>
                  <span>Unknown: {result.unknown_count}</span>
                </div>
                {terminalVerdict(result.verdict) && result.verdict !== 'pass' ? (
                  <p className="mt-4 text-sm text-danger">
                    The integration works, and this image produced a blocking security verdict.
                  </p>
                ) : null}
              </Card>
            ) : null}
          </Card.Content>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <Card.Header>
            <Card.Title>Install the {providerInfo.label} template</Card.Title>
            <Card.Description>
              The generated template references JUSTSCAN_ORG_TOKEN and never contains the raw
              credential.
            </Card.Description>
          </Card.Header>
          <Card.Content className="space-y-4">
            <FormAlert
              status="success"
              title="Ready to install"
              description={`Create the required secret in ${providerInfo.label}, set the image variable, then add this template to your pipeline.`}
            />
            <CodeBlock value={template} />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onPress={downloadTemplate}>
                <Download01Icon size={15} />
                Download template
              </Button>
              <Button
                variant="secondary"
                render={(props: any) => <Link {...props} href={`/orgs/${org.id}?tab=scans`} />}
              >
                <CheckmarkCircle02Icon size={15} />
                View organization scans
              </Button>
              <Button
                variant="secondary"
                render={(props: any) => <Link {...props} href={`/orgs/${org.id}?tab=access`} />}
              >
                Manage tokens
              </Button>
              <Button
                variant="secondary"
                render={(props: any) => (
                  <Link {...props} href="/swagger/index.html" target="_blank" />
                )}
              >
                API reference
              </Button>
            </div>
          </Card.Content>
        </Card>
      )}

      <div className="flex justify-between">
        <Button
          variant="secondary"
          isDisabled={step === 0}
          onPress={() => setStep((value) => Math.max(0, value - 1))}
        >
          Back
        </Button>
        <Button
          isDisabled={step === STEPS.length - 1}
          onPress={() => setStep((value) => Math.min(STEPS.length - 1, value + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
