'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { EmptyState } from '@/components/ui/empty-state';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { nativeFieldClassName } from '@/components/ui/form-styles';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { TableRowSkeleton } from '@/components/ui/skeleton';
import { createRegistry, deleteRegistry, getDefaultScannerCapabilities, listRegistriesWithCapabilities, RegistryWithHealth, ScannerCapabilities, testRegistry, updateRegistry } from '@/lib/api';
import { timeAgo } from '@/lib/time';
import { ListBox, Modal, Select, useOverlayState } from '@heroui/react';
import { Delete01Icon, PencilEdit01Icon, PlusSignIcon, ServerStack01Icon, Shield01Icon, TestTube01Icon } from 'hugeicons-react';
import { useCallback, useEffect, useState } from 'react';

const inputCls = nativeFieldClassName;

const AUTH_TYPE_LABEL: Record<string, string> = {
  none: 'Public', basic: 'Basic auth', token: 'Token', aws_ecr: 'AWS ECR',
};
const AUTH_TYPE_STYLE: Record<string, React.CSSProperties> = {
  none:    { color: '#a1a1aa', background: 'rgba(161,161,170,0.08)', border: '1px solid rgba(161,161,170,0.15)' },
  basic:   { color: '#60a5fa', background: 'rgba(59,130,246,0.1)',   border: '1px solid rgba(59,130,246,0.2)'  },
  token:   { color: '#a78bfa', background: 'rgba(124,58,237,0.1)',   border: '1px solid rgba(124,58,237,0.2)'  },
  aws_ecr: { color: '#fb923c', background: 'rgba(249,115,22,0.1)',   border: '1px solid rgba(249,115,22,0.2)'  },
};

const PROVIDER_LABEL: Record<string, string> = {
  trivy: 'Trivy',
  artifactory_xray: 'Artifactory Xray',
};

const PROVIDER_STYLE: Record<string, React.CSSProperties> = {
  trivy: { color: '#22c55e', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' },
  artifactory_xray: { color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' },
};

function HealthBadge({ status, message }: { status: string; message: string }) {
  const cfg = ({
    healthy:   { color: '#34d399', bg: 'rgba(16,185,129,0.1)',   border: 'rgba(16,185,129,0.2)',   label: 'Healthy'   },
    unhealthy: { color: '#f87171', bg: 'rgba(239,68,68,0.1)',    border: 'rgba(239,68,68,0.2)',    label: 'Unhealthy' },
    unknown:   { color: '#a1a1aa', bg: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.15)', label: 'Unknown'   },
  } as Record<string, { color: string; bg: string; border: string; label: string }>)[status] ?? { color: '#a1a1aa', bg: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.15)', label: status };
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full" style={{color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`}} title={message}>
      <span className="w-1.5 h-1.5 rounded-full" style={{background: cfg.color}} />
      {cfg.label}
    </span>
  );
}

export default function RegistriesPage() {
  const [registries, setRegistries] = useState<RegistryWithHealth[]>([]);
  const [capabilities, setCapabilities] = useState<ScannerCapabilities>(getDefaultScannerCapabilities());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<RegistryWithHealth | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [xrayUrl, setXrayUrl] = useState('');
  const [xrayArtifactoryId, setXrayArtifactoryId] = useState('default');
  const [authType, setAuthType] = useState<'none' | 'basic' | 'token' | 'aws_ecr'>('none');
  const [scanProvider, setScanProvider] = useState<'trivy' | 'artifactory_xray'>('trivy');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listRegistriesWithCapabilities();
      setRegistries(response.data);
      setCapabilities(response.capabilities);
    }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditing(null); setName(''); setUrl(''); setXrayUrl(''); setXrayArtifactoryId('default'); setAuthType('none'); setScanProvider(capabilities.enable_trivy ? 'trivy' : 'artifactory_xray'); setUsername(''); setPassword(''); setFormError('');
    modal.open();
  }
  function openEdit(r: RegistryWithHealth) {
    setEditing(r); setName(r.name); setUrl(r.url); setXrayUrl(r.xray_url ?? ''); setXrayArtifactoryId(r.xray_artifactory_id ?? 'default'); setAuthType(r.auth_type ?? 'none'); setScanProvider(r.scan_provider ?? 'trivy'); setUsername(r.username ?? ''); setPassword(''); setFormError('');
    modal.open();
  }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setFormError(''); setSaving(true);
    try {
      const payload = {
        name,
        url,
        xray_url: scanProvider === 'artifactory_xray' ? xrayUrl || undefined : undefined,
        xray_artifactory_id: scanProvider === 'artifactory_xray' ? xrayArtifactoryId || 'default' : undefined,
        auth_type: authType,
        scan_provider: scanProvider,
        username,
        ...(password ? { password } : {}),
      };
      if (editing) { await updateRegistry(editing.id, payload); toast.success('Registry updated'); }
      else { await createRegistry(payload); toast.success('Registry added'); }
      modal.close(); await load();
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSaving(false); }
  }
  async function handleDelete(id: string) {
    const ok = await confirm({
      title: 'Delete registry?',
      message: 'The registry configuration will be permanently removed.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteRegistry(id).catch(() => {});
    toast.success('Registry deleted');
    load();
  }
  async function handleTest(id: string) {
    setTesting(id);
    try {
      await testRegistry(id);
      toast.success('Connection test passed');
      await load();
    } catch {
      toast.error('Connection test failed');
      await load();
    } finally { setTesting(null); }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Registries</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Configure private Docker registries and choose the scan provider per registry.</p>
        </div>
        <button
          onClick={openCreate}
          className="btn-primary inline-flex items-center gap-2"
          type="button"
        >
          <PlusSignIcon size={15} /> Add Registry
        </button>
      </div>

      {error ? <FormAlert description={error} title="Registry loading failed" /> : null}

      <div className="rounded-2xl px-4 py-3 text-sm flex items-start gap-3"
        style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.18)', color: 'var(--text-secondary)' }}>
        <div className="mt-0.5 w-2 h-2 rounded-full shrink-0" style={{ background: '#60a5fa' }} />
        <div className="space-y-1">
          <p className="font-medium text-zinc-800 dark:text-zinc-100">Provider choice is configured here in the frontend.</p>
          <p className="text-zinc-600 dark:text-zinc-400">You do not need to edit backend/config.yaml to assign a registry to Trivy or Artifactory Xray. Provider selection, Xray base URL, and Artifactory ID are stored with the registry record in JustScan.</p>
          <p className="text-zinc-600 dark:text-zinc-400">Registry health is checked automatically every 15 minutes, and you can still run a manual test from the actions menu.</p>
        </div>
      </div>

      {loading ? (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">URL</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Provider</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Auth</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Username</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Health</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 3 }).map((_, i) => <TableRowSkeleton key={i} cols={7} />)}
            </tbody>
          </table>
        </div>
      ) : registries.length === 0 ? (
        <EmptyState
          icon={<ServerStack01Icon size={28} />}
          title="No registries configured"
          description="Add a private Docker registry and choose whether JustScan should use its local Trivy scanner or the Artifactory Xray provider for that registry."
          action={{ label: '+ Add Registry', onClick: openCreate }}
        />
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">URL</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Provider</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Auth</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Username</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Health</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {registries.map((r, i) => (
                <tr key={r.id} style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-200">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">{r.url}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-md"
                      style={PROVIDER_STYLE[r.scan_provider ?? 'trivy']}>
                      {PROVIDER_LABEL[r.scan_provider ?? 'trivy']}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-md"
                      style={AUTH_TYPE_STYLE[r.auth_type ?? 'none']}>
                      {AUTH_TYPE_LABEL[r.auth_type ?? 'none']}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">{r.username || <span className="text-zinc-400 dark:text-zinc-700">—</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <HealthBadge status={r.health_status ?? 'unknown'} message={r.health_message ?? ''} />
                      {r.last_health_check_at && (
                        <span className="text-[10px] text-zinc-500">
                          {timeAgo(r.last_health_check_at)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end">
                      <RowActionsMenu
                        label={`Open actions menu for ${r.name}`}
                        items={[
                          { id: 'test', label: testing === r.id ? 'Testing…' : 'Test connection', icon: <TestTube01Icon size={15} />, disabled: testing === r.id, onAction: () => { void handleTest(r.id); } },
                          { id: 'edit', label: 'Edit registry', icon: <PencilEdit01Icon size={15} />, onAction: () => openEdit(r) },
                          { id: 'delete', label: 'Delete registry', icon: <Delete01Icon size={15} />, variant: 'danger', onAction: () => { void handleDelete(r.id); } },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">{editing ? 'Edit Registry' : 'Add Registry'}</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="registry-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError ? <FormAlert description={formError} title="Registry save failed" /> : null}
                  <FormField label="Name" onChange={(e) => setName(e.target.value)} placeholder="My Registry" required value={name} />
                  <FormField className="font-mono" label="URL" onChange={(e) => setUrl(e.target.value)} placeholder="https://registry.example.com" required value={url} />
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Scan Provider</label>
                    <Select selectedKey={scanProvider} onSelectionChange={k => setScanProvider(k as 'trivy' | 'artifactory_xray')}>
                      <Select.Trigger className={inputCls}>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-zinc-400 shrink-0"><ServerStack01Icon size={15} /></span>
                          <Select.Value />
                        </div>
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="trivy" isDisabled={!capabilities.enable_trivy}>Trivy (built-in JustScan scanner)</ListBox.Item>
                          <ListBox.Item id="artifactory_xray">Artifactory Xray</ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      This is stored in JustScan and does not require editing backend/config.yaml.
                    </p>
                    {!capabilities.enable_trivy && scanProvider === 'trivy' && editing && (
                      <p className="text-xs" style={{ color: '#f59e0b' }}>
                        This registry must be switched to Artifactory Xray before saving changes.
                      </p>
                    )}
                  </div>
                  {scanProvider === 'artifactory_xray' && (
                    <>
                      <FormField
                        className="font-mono"
                        description="Leave empty to reuse the registry URL. Set this when your Docker registry host differs from the JFrog platform/Xray host."
                        label="Xray Base URL"
                        onChange={(e) => setXrayUrl(e.target.value)}
                        placeholder="https://jfrog.example.com"
                        value={xrayUrl}
                      />
                      <FormField
                        description="This prefixes artifact summary paths in Xray. In most JFrog setups the correct value is default."
                        label="Artifactory ID"
                        onChange={(e) => setXrayArtifactoryId(e.target.value)}
                        placeholder="default"
                        value={xrayArtifactoryId}
                      />
                    </>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Auth Type</label>
                    <Select selectedKey={authType} onSelectionChange={k => setAuthType(k as 'none' | 'basic' | 'token' | 'aws_ecr')}>
                      <Select.Trigger className={inputCls}>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-zinc-400 shrink-0"><Shield01Icon size={15} /></span>
                          <Select.Value />
                        </div>
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="none">None (public registry)</ListBox.Item>
                          <ListBox.Item id="basic">Basic (username / password)</ListBox.Item>
                          <ListBox.Item id="token">Token</ListBox.Item>
                          <ListBox.Item id="aws_ecr">AWS ECR</ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                  {scanProvider === 'artifactory_xray' && (
                    <div className="rounded-xl px-3 py-2.5 text-xs"
                      style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)', color: '#d97706' }}>
                      Xray scans require image references that map cleanly to an Artifactory repository path, for example <span className="font-mono">test-images/debian:12-slim</span> or <span className="font-mono">registry.example.com/test-images/debian:12-slim</span>.
                    </div>
                  )}
                  <FormField label="Username" onChange={(e) => setUsername(e.target.value)} placeholder="Optional" value={username} />
                  <FormField
                    description={editing ? 'Leave blank to keep the stored password unchanged.' : 'Optional unless your registry provider requires credentials.'}
                    label="Password"
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={editing ? '••••••••' : 'Optional'}
                    type="password"
                    value={password}
                  />
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button onClick={modal.close} className="btn-secondary" type="button">
                  Cancel
                </button>
                <button type="submit" form="registry-form" disabled={saving} className="btn-primary disabled:opacity-60">
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {editing ? 'Save' : 'Add'}
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </div>
  );
}
