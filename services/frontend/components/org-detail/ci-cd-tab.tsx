'use client';

import { useToast } from '@/components/toast';
import { FormAlert } from '@/components/ui/form-alert';
import {
  createOrgToken,
  listPipelineScans,
  type Org,
  type PipelineScanHistoryItem,
} from '@/lib/api';
import { getApiBase } from '@/lib/api/base';
import { deferEffect } from '@/lib/defer-effect';
import { Alert, Button, ButtonGroup, Card, Chip, Label, ListBox, Select } from '@heroui/react';
import { Copy01Icon, Download01Icon, Key01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const CLI_TOKEN_LIFETIMES = [
  { label: '30 days', value: 30 * 24 * 60 * 60 },
  { label: '90 days', value: 90 * 24 * 60 * 60 },
  { label: '180 days', value: 180 * 24 * 60 * 60 },
  { label: '1 year', value: 365 * 24 * 60 * 60 },
  { label: '5 years', value: 5 * 365 * 24 * 60 * 60 },
];

function defaultPublicURL() {
  if (typeof window === 'undefined') return '';
  return getApiBase() || window.location.origin;
}

function CodeBlock({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl border border-divider bg-surface-secondary ${className ?? ''}`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-divider px-4 py-2.5">
        <span className="text-xs font-medium text-muted">{label}</span>
        <Button size="sm" variant="secondary" onPress={() => void copy()}>
          <Copy01Icon size={14} />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="flex-1 overflow-auto p-4 text-xs leading-relaxed">
        <code>{value}</code>
      </pre>
    </div>
  );
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-divider bg-surface-secondary p-4">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted">{label}</p>
        <code className="mt-1 block truncate text-sm font-medium">{value || 'Loading…'}</code>
      </div>
      <Button size="sm" variant="secondary" onPress={() => void copy()} isDisabled={!value}>
        <Copy01Icon size={14} />
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

function deliveryStatusColor(status: string): 'default' | 'success' | 'danger' {
  if (status === 'delivered') return 'success';
  if (status === 'failed') return 'danger';
  return 'default';
}

interface OrgCICDTabProps {
  org: Org;
  canManageTokens: boolean;
}

export function OrgCICDTab({ org, canManageTokens }: OrgCICDTabProps) {
  const toast = useToast();
  const [publicURL, setPublicURL] = useState('');
  const [token, setToken] = useState('');
  const [creatingToken, setCreatingToken] = useState(false);
  const [tokenError, setTokenError] = useState('');
  const [tokenLifetime, setTokenLifetime] = useState(String(CLI_TOKEN_LIFETIMES[1].value));
  const [history, setHistory] = useState<PipelineScanHistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);

  useEffect(() => {
    const cancelInitialization = deferEffect(() => setPublicURL(defaultPublicURL()));
    return cancelInitialization;
  }, []);

  useEffect(() => {
    void listPipelineScans(org.id)
      .then((response) => {
        setHistory(response.data);
        setHistoryTotal(response.total);
      })
      .catch(() => setHistory([]));
  }, [org.id, token]);

  async function createCredential() {
    setCreatingToken(true);
    setTokenError('');
    try {
      const created = await createOrgToken(
        org.id,
        'JustScan CLI',
        Number(tokenLifetime),
        'pipeline_scan'
      );
      setToken(created.key);
      toast.success('Pipeline token created. Copy it now; it will not be shown again.');
    } catch (error) {
      setTokenError(error instanceof Error ? error.message : 'Failed to create pipeline token');
    } finally {
      setCreatingToken(false);
    }
  }

  const personalTerminalSetup = `justscan config set my-organization \\
  --server "${publicURL || 'https://justscan.example.com'}" \\
  --org "${org.id}"

justscan login
justscan scan "registry.example.com/my-app:1.2.3" \\
  --source justscan_cli`;

  const pipelineTerminalSetup = `justscan config set my-organization \\
  --server "${publicURL || 'https://justscan.example.com'}" \\
  --org "${org.id}"

export JUSTSCAN_TOKEN="<paste-your-pipeline-token>"
justscan scan "registry.example.com/my-app:1.2.3" \\
  --source justscan_cli`;

  return (
    <div className="space-y-6">
      <Card>
        <Card.Header>
          <Card.Title>Set up the JustScan CLI</Card.Title>
          <Card.Description>
            Sign in with your JustScan account for local work, or create a least-privilege token
            for CI/CD. JustScan does the scanning; the CLI only talks to this instance.
          </Card.Description>
        </Card.Header>
        <Card.Content className="space-y-8">
          <section className="flex flex-wrap items-center justify-between gap-4 border-b border-divider pb-6">
            <div className="flex items-start gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                1
              </span>
              <div>
                <p className="text-sm font-medium">Install the CLI</p>
                <p className="mt-1 text-xs text-muted">
                  Download the latest release. Run <code>justscan version --check</code> later to
                  check for updates.
                </p>
              </div>
            </div>
            <ButtonGroup size="sm">
              <Button
                variant="primary"
                render={(props: any) => (
                  <a
                    {...props}
                    href="https://github.com/JustLABv1/justscan/releases/latest"
                    target="_blank"
                    rel="noreferrer"
                  />
                )}
              >
                <Download01Icon size={15} />
                Download CLI
              </Button>
              <Button
                variant="secondary"
                render={(props: any) => (
                  <a
                    {...props}
                    href="https://github.com/JustLABv1/justscan/blob/main/docs/justscan-cli.md"
                    target="_blank"
                    rel="noreferrer"
                  />
                )}
              >
                CLI guide
              </Button>
            </ButtonGroup>
          </section>

          <section className="space-y-3 border-b border-divider pb-6">
            <div className="flex items-start gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-xs font-semibold text-muted">
                2
              </span>
              <div>
                <p className="text-sm font-medium">Connect to this organization</p>
                <p className="mt-1 text-xs text-muted">Copy these values into your CLI profile.</p>
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <CopyValue label="JustScan instance URL" value={publicURL} />
              <CopyValue label="Organization ID" value={org.id} />
            </div>
          </section>

          <section className="space-y-5">
            <div className="flex items-start gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-xs font-semibold text-muted">
                3
              </span>
              <div>
                <p className="text-sm font-medium">Choose how you will use the CLI</p>
                <p className="mt-1 text-xs text-muted">
                  Sign in for interactive work, or create a dedicated token for CI/CD.
                </p>
              </div>
            </div>

            <div className="grid items-stretch gap-8 xl:grid-cols-2">
              <div className="flex h-full flex-col gap-3">
                <div>
                  <p className="text-sm font-medium">Personal terminal</p>
                  <p className="mt-1 text-xs text-muted">
                    Sign in with your own JustScan account; the CLI stores the session in your
                    operating system’s keychain.
                  </p>
                </div>
                <CodeBlock
                  label="Personal setup"
                  value={personalTerminalSetup}
                  className="flex-1"
                />
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium">CI/CD pipeline</p>
                  <p className="mt-1 text-xs text-muted">
                    Create a least-privilege token, then store it as a secret in your CI provider.
                  </p>
                </div>
                <div className="rounded-xl border border-divider bg-surface-secondary p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">Pipeline token</p>
                    <Link
                      href={`/orgs/${org.id}?tab=access&section=tokens`}
                      className="text-xs font-medium text-accent hover:underline"
                    >
                      Manage tokens
                    </Link>
                  </div>
                  {canManageTokens ? (
                    <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                      <Select
                        aria-label="CLI token lifetime"
                        value={tokenLifetime}
                        onChange={(value) =>
                          setTokenLifetime(String(value ?? CLI_TOKEN_LIFETIMES[1].value))
                        }
                        variant="primary"
                        className="min-w-36 flex-1"
                      >
                        <Label>Token lifetime</Label>
                        <Select.Trigger className="border border-divider bg-surface shadow-sm">
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover className="border border-divider bg-surface shadow-lg">
                          <ListBox>
                            {CLI_TOKEN_LIFETIMES.map((option) => (
                              <ListBox.Item
                                key={option.value}
                                id={String(option.value)}
                                textValue={option.label}
                              >
                                {option.label}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      <Button isDisabled={creatingToken} onPress={() => void createCredential()}>
                        <Key01Icon size={15} />
                        {creatingToken ? 'Creating…' : 'Create token'}
                      </Button>
                    </div>
                  ) : null}
                </div>

                {tokenError ? <FormAlert description={tokenError} title="Token creation failed" /> : null}
                {token ? (
                  <>
                    <Alert status="warning" className="border-warning/40 bg-warning/15">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>Copy this token now</Alert.Title>
                        <Alert.Description>
                          It is shown only once. Store it in a secret manager or CI secret, never
                          in a profile or source file.
                        </Alert.Description>
                      </Alert.Content>
                    </Alert>
                    <CodeBlock label="Pipeline token" value={token} />
                  </>
                ) : null}
                <CodeBlock label="CI/CD setup" value={pipelineTerminalSetup} />
              </div>
            </div>
          </section>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>Recent pipeline runs</Card.Title>
          <Card.Description>
            {historyTotal === 0
              ? 'No pipeline-triggered scans have been recorded yet.'
              : `${historyTotal} pipeline-triggered scan${historyTotal === 1 ? '' : 's'} in this organization.`}
          </Card.Description>
        </Card.Header>
        <Card.Content>
          {history.length === 0 ? (
            <p className="text-sm text-muted">Run a scan with the CLI to create history.</p>
          ) : (
            <div className="divide-y divide-divider rounded-2xl border border-divider">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {entry.scan.image_name}:{entry.scan.image_tag}
                    </p>
                    <p className="text-xs text-muted">
                      {entry.initiator?.token_description || entry.source.replaceAll('_', ' ')}
                      {entry.external_ref ? ` · ${entry.external_ref}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Chip size="sm" variant="soft">
                      {entry.scan.status}
                    </Chip>
                    <Chip
                      size="sm"
                      color={deliveryStatusColor(entry.delivery_status)}
                      variant="soft"
                    >
                      {entry.delivery_status}
                    </Chip>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}
