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
import { Alert, Button, Card, Chip } from '@heroui/react';
import { Copy01Icon, Key01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

function defaultPublicURL() {
  if (typeof window === 'undefined') return '';
  return getApiBase() || window.location.origin;
}

function CodeBlock({ label, value }: { label: string; value: string }) {
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
    <div className="overflow-hidden rounded-2xl border border-divider bg-surface-secondary">
      <div className="flex items-center justify-between gap-3 border-b border-divider px-4 py-2.5">
        <span className="text-xs font-medium text-muted">{label}</span>
        <Button size="sm" variant="secondary" onPress={() => void copy()}>
          <Copy01Icon size={14} />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="overflow-auto p-4 text-xs leading-relaxed">
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
        90 * 24 * 60 * 60,
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

  const terminalSetup = `justscan config set my-organization \\
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
            Copy the instance details, create a least-privilege token, then run your first remote
            scan. JustScan does the scanning; the CLI only talks to this instance.
          </Card.Description>
        </Card.Header>
        <Card.Content className="space-y-5">
          <div className="grid gap-3 lg:grid-cols-2">
            <CopyValue label="JustScan instance URL" value={publicURL} />
            <CopyValue label="Organization ID" value={org.id} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-divider bg-surface-tertiary p-4">
            <div>
              <p className="text-sm font-medium">Create a pipeline token</p>
              <p className="mt-1 text-xs text-muted">
                It can create and read scans for {org.name} only. It cannot administer the
                organization.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                render={(props: any) => (
                  <Link {...props} href={`/orgs/${org.id}?tab=access&section=tokens`} />
                )}
              >
                Manage CLI tokens
              </Button>
              {canManageTokens ? (
                <Button isDisabled={creatingToken} onPress={() => void createCredential()}>
                  <Key01Icon size={15} />
                  {creatingToken ? 'Creating…' : 'Create CLI token'}
                </Button>
              ) : null}
            </div>
          </div>

          {tokenError ? <FormAlert description={tokenError} title="Token creation failed" /> : null}
          {token ? (
            <>
              <Alert status="warning" className="border-warning/40 bg-warning/15">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>Copy this token now</Alert.Title>
                  <Alert.Description>
                    It is shown only once. Store it in a secret manager or CI secret, never in a
                    profile or source file.
                  </Alert.Description>
                </Alert.Content>
              </Alert>
              <CodeBlock label="Pipeline token" value={token} />
            </>
          ) : null}

          <CodeBlock label="Terminal setup" value={terminalSetup} />
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
