'use client';

import type { SBOMComponent, SBOMComponentDetail, SBOMGraph, Vulnerability } from '@/lib/api';
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import * as dagre from '@dagrejs/dagre';
import { Button, Card, Chip, Drawer, Label, ListBox, SearchField, Select, Table, type SortDescriptor, useOverlayState } from '@heroui/react';
import { Download01Icon, GitBranchIcon, PackageIcon, ShareKnowledgeIcon } from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

type SBOMWorkspaceProps = {
  loadComponents: (query?: string) => Promise<{ data: SBOMComponent[]; total: number; document?: SBOMGraph['document'] }>;
  loadGraph: (focus?: string) => Promise<SBOMGraph>;
  loadComponent: (componentId: string) => Promise<SBOMComponentDetail>;
  downloadHref?: string;
  readOnly?: boolean;
};

type View = 'inventory' | 'tree' | 'graph';
type PackageNodeData = { component: SBOMComponent; onOpen: (component: SBOMComponent) => void };

function packageLabel(component: SBOMComponent) {
  return component.group ? `${component.group}/${component.name}` : component.name;
}

function PackageNode({ data }: NodeProps<Node<PackageNodeData>>) {
  const count = data.component.vulnerability_count ?? 0;
  return (
    <div
      className="nodrag nopan min-w-48 cursor-pointer rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-zinc-950 shadow-sm transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
      role="button"
      tabIndex={0}
      aria-label={`Open ${packageLabel(data.component)} ${data.component.version}`}
      onClick={() => data.onOpen(data.component)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); data.onOpen(data.component); } }}
    >
      <Handle type="target" position={Position.Left} className="!border-divider !bg-surface-secondary" />
      <div className="flex items-start justify-between gap-2">
        <span className="max-w-36 truncate text-sm font-medium">{packageLabel(data.component)}</span>
        {count > 0 ? <Chip size="sm" color="danger" variant="soft">{count}</Chip> : null}
      </div>
      <p className="mt-1 truncate font-mono text-xs text-muted">{data.component.version || 'No version'}</p>
      <Handle type="source" position={Position.Right} className="!border-divider !bg-surface-secondary" />
    </div>
  );
}

const nodeTypes = { package: PackageNode };

function graphLayout(graph: SBOMGraph, onOpen: (component: SBOMComponent) => void): { nodes: Node<PackageNodeData>[]; edges: Edge[] } {
  const layout = new dagre.graphlib.Graph();
  layout.setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 80, marginx: 32, marginy: 32 });
  graph.nodes.forEach((component) => layout.setNode(component.id, { width: 192, height: 76 }));
  graph.edges.forEach((edge) => layout.setEdge(edge.from_component_id, edge.to_component_id));
  dagre.layout(layout);
  return {
    nodes: graph.nodes.map((component) => {
      const position = layout.node(component.id) ?? { x: 0, y: 0 };
      return { id: component.id, type: 'package', position: { x: position.x - 96, y: position.y - 38 }, data: { component, onOpen } };
    }),
    edges: graph.edges.map((edge) => ({ id: edge.id, source: edge.from_component_id, target: edge.to_component_id, type: 'smoothstep', style: { stroke: 'var(--divider)', strokeWidth: 1.5 } })),
  };
}

export function SBOMWorkspace({ loadComponents, loadGraph, loadComponent, downloadHref }: SBOMWorkspaceProps) {
  const [view, setView] = useState<View>('inventory');
  const [query, setQuery] = useState('');
  const [components, setComponents] = useState<SBOMComponent[]>([]);
  const [total, setTotal] = useState(0);
  const [document, setDocument] = useState<SBOMGraph['document']>();
  const [graph, setGraph] = useState<SBOMGraph>({ nodes: [], edges: [], truncated: false });
  const [loading, setLoading] = useState(true);
  const [graphLoading, setGraphLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [selected, setSelected] = useState<SBOMComponentDetail | null>(null);
  const [ecosystem, setEcosystem] = useState('all');
  const [vulnerableOnly, setVulnerableOnly] = useState(false);
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({ column: 'package', direction: 'ascending' });
  const drawer = useOverlayState();

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      loadComponents(query || undefined)
        .then((result) => {
          if (!alive) return;
          setComponents(result.data ?? []);
          setTotal(result.total ?? 0);
          setDocument(result.document);
        })
        .catch(() => alive && setComponents([]))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [loadComponents, query]);

  useEffect(() => {
    if (view === 'inventory') return;
    let alive = true;
    loadGraph()
      .then((result) => {
        if (!alive) return;
        setGraph(result);
        setDocument((current) => result.document ?? current);
      })
      .catch(() => alive && setGraph({ nodes: [], edges: [], truncated: false }))
      .finally(() => alive && setGraphLoading(false));
    return () => { alive = false; };
  }, [view, loadGraph]);

  const ecosystems = useMemo(() => [...new Set(components.map((component) => component.ecosystem || component.type).filter(Boolean))].sort(), [components]);
  const visibleComponents = useMemo(() => {
    const filtered = components.filter((component) => (ecosystem === 'all' || (component.ecosystem || component.type) === ecosystem) && (!vulnerableOnly || (component.vulnerability_count ?? 0) > 0));
    return [...filtered].sort((first, second) => {
      const column = String(sortDescriptor.column);
      const value = (component: SBOMComponent) => column === 'package' ? packageLabel(component) : column === 'vulnerabilities' ? String(component.vulnerability_count ?? 0).padStart(8, '0') : String(component[column as keyof SBOMComponent] ?? '');
      const comparison = value(first).localeCompare(value(second), undefined, { numeric: true, sensitivity: 'base' });
      return sortDescriptor.direction === 'descending' ? -comparison : comparison;
    });
  }, [components, ecosystem, vulnerableOnly, sortDescriptor]);
  const byID = useMemo(() => new Map(graph.nodes.map((component) => [component.id, component])), [graph.nodes]);
  const childMap = useMemo(() => {
    const value = new Map<string, string[]>();
    graph.edges.forEach((edge) => value.set(edge.from_component_id, [...(value.get(edge.from_component_id) ?? []), edge.to_component_id]));
    return value;
  }, [graph.edges]);
  const roots = graph.nodes.filter((component) => component.is_root || !graph.edges.some((edge) => edge.to_component_id === component.id));
  const graphAvailable = graph.edges.length > 0;
  const sourceLabel = document?.source === 'trivy_fallback' ? 'Trivy fallback' : document?.source === 'xray' ? 'JFrog Xray' : document?.source === 'trivy' ? 'Trivy' : 'Legacy inventory';

  const openComponent = useCallback(async (component: SBOMComponent) => {
    setDetailError('');
    setDetailLoading(true);
    setSelected({ component, dependencies: [], dependents: [], vulnerabilities: [] });
    drawer.open();
    try {
      const detail = await loadComponent(component.id);
      setSelected({
        ...detail,
        dependencies: detail.dependencies ?? [],
        dependents: detail.dependents ?? [],
        vulnerabilities: detail.vulnerabilities ?? [],
      });
    } catch {
      setDetailError('Package details could not be loaded. The basic package evidence is still shown; retry after the scan API is available.');
    } finally {
      setDetailLoading(false);
    }
  }, [drawer, loadComponent]);
  const flow = useMemo(() => graphLayout(graph, openComponent), [graph, openComponent]);

  function selectView(nextView: View) {
    if (nextView !== 'inventory') setGraphLoading(true);
    setView(nextView);
  }

  return <div className="space-y-4">
    {document?.diagnostic ? <Card className="border border-warning/30 bg-warning/10 p-4 text-sm text-warning-foreground"><div className="flex items-start gap-3"><PackageIcon className="mt-0.5 shrink-0" size={18} /><p>{document.diagnostic}</p></div></Card> : null}
    <Card className="surface-panel p-4"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="flex flex-wrap gap-2"><Chip variant="soft" color="accent">{total} packages</Chip><Chip variant="soft" color={document?.graph_complete ? 'success' : 'warning'}>{document?.graph_complete ? 'Dependency graph complete' : 'Dependency graph unavailable or partial'}</Chip><Chip variant="soft">Source: {sourceLabel}</Chip></div><div className="flex flex-wrap gap-2">{(['inventory', 'tree', 'graph'] as View[]).map((item) => <Button key={item} size="sm" variant={view === item ? 'primary' : 'secondary'} onPress={() => selectView(item)}>{item === 'inventory' ? <PackageIcon size={16} /> : item === 'tree' ? <GitBranchIcon size={16} /> : <ShareKnowledgeIcon size={16} />}{item[0].toUpperCase() + item.slice(1)}</Button>)}{downloadHref && document ? <Button size="sm" variant="secondary" onPress={() => { window.location.assign(downloadHref); }}><Download01Icon size={16} />CycloneDX</Button> : null}</div></div></Card>

    {view === 'inventory' ? <><div className="flex flex-col gap-3 lg:flex-row lg:items-center"><SearchField value={query} onChange={setQuery} variant="secondary" aria-label="Search packages" className="flex-1"><SearchField.Group><SearchField.SearchIcon /><SearchField.Input placeholder="Search packages, versions, or ecosystems…" /><SearchField.ClearButton /></SearchField.Group></SearchField><Select value={ecosystem} onChange={(value) => setEcosystem(typeof value === 'string' ? value : 'all')} variant="secondary" aria-label="Filter by ecosystem" className="min-w-48"><Label className="sr-only">Ecosystem</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger><Select.Popover><ListBox><ListBox.Item id="all">All ecosystems</ListBox.Item>{ecosystems.map((item) => <ListBox.Item key={item} id={item}>{item}</ListBox.Item>)}</ListBox></Select.Popover></Select><Button size="sm" variant={vulnerableOnly ? 'danger' : 'secondary'} onPress={() => setVulnerableOnly((value) => !value)}>Vulnerable only</Button></div><Card className="surface-panel overflow-hidden"><Table variant="secondary"><Table.ScrollContainer><Table.Content aria-label="SBOM package inventory" className="min-w-[820px] table-fixed" sortDescriptor={sortDescriptor} onSortChange={setSortDescriptor}><Table.Header><Table.Column id="package" allowsSorting isRowHeader className="w-[34%]">Package</Table.Column><Table.Column id="version" allowsSorting className="w-[12%]">Version</Table.Column><Table.Column id="ecosystem" allowsSorting className="w-[10%]">Type</Table.Column><Table.Column id="dependency_depth" allowsSorting className="w-[14%]">Relationship</Table.Column><Table.Column id="vulnerabilities" allowsSorting className="w-[12%]">Vulnerabilities</Table.Column><Table.Column id="license" allowsSorting className="w-[18%]">License</Table.Column></Table.Header><Table.Body>{loading ? <Table.Row id="loading"><Table.Cell colSpan={6}><div className="py-10 text-center text-sm text-muted">Loading package evidence…</div></Table.Cell></Table.Row> : visibleComponents.length === 0 ? <Table.Row id="empty"><Table.Cell colSpan={6}><div className="py-10 text-center text-sm text-muted">No packages match these filters.</div></Table.Cell></Table.Row> : visibleComponents.map((component) => <Table.Row key={component.id} id={component.id} className="hover:bg-surface-secondary"><Table.Cell className="max-w-0"><Button variant="ghost" className="-mx-2 h-auto w-full min-w-0 justify-start px-2 py-1 text-left" aria-label={`Open ${packageLabel(component)} ${component.version}`} onPress={() => void openComponent(component)}><span className="min-w-0 w-full"><span className="block truncate font-medium">{packageLabel(component)}</span><span className="block truncate font-mono text-xs text-muted">{component.package_url || component.bom_ref || 'No package URL'}</span></span></Button></Table.Cell><Table.Cell className="truncate">{component.version || '—'}</Table.Cell><Table.Cell className="truncate"><Chip size="sm" variant="soft">{component.ecosystem || component.type}</Chip></Table.Cell><Table.Cell className="truncate">{component.is_root ? 'Root' : component.dependency_depth != null ? `Depth ${component.dependency_depth}` : 'Unknown'}</Table.Cell><Table.Cell><Chip size="sm" variant="soft" color={(component.vulnerability_count ?? 0) > 0 ? 'danger' : 'default'}>{component.vulnerability_count ?? 0}</Chip></Table.Cell><Table.Cell className="truncate">{component.licenses?.join(', ') || component.license || '—'}</Table.Cell></Table.Row>)}</Table.Body></Table.Content></Table.ScrollContainer></Table></Card></> : null}

    {view === 'tree' ? <Card className="surface-panel p-4">{graphLoading ? <p className="text-sm text-muted">Loading dependency relationships…</p> : !graphAvailable ? <div className="space-y-2"><p className="font-medium">Dependency relationships are not available for this scan.</p><p className="text-sm text-muted">This is a legacy package inventory created before JustScan retained CycloneDX dependency data. Packages remain clickable below; re-scan the artifact to generate its dependency tree.</p><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{graph.nodes.map((component) => <Button key={component.id} variant="secondary" className="justify-start" onPress={() => void openComponent(component)}><PackageIcon size={15} /><span className="truncate">{packageLabel(component)} {component.version}</span></Button>)}</div></div> : <><p className="mb-3 text-sm text-muted">Expand the dependency story from the scanned artifact. A package can occur under more than one parent; cycles are marked instead of repeated.</p><div className="space-y-1">{roots.map((root) => <TreeNode key={root.id} component={root} byID={byID} childMap={childMap} onOpen={openComponent} ancestry={new Set()} />)}</div></>}</Card> : null}

    {view === 'graph' ? <Card className="surface-panel overflow-hidden">{graphLoading ? <div className="flex h-[420px] items-center justify-center text-sm text-muted">Loading dependency graph…</div> : !graphAvailable ? <div className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center"><GitBranchIcon size={28} className="text-muted" /><p className="mt-4 font-medium">No dependency graph is available for this scan.</p><p className="mt-2 max-w-lg text-sm text-muted">The legacy inventory has package records but no declared relationships. Re-scan to generate a CycloneDX dependency graph; package details are still available from Inventory or Tree.</p></div> : <><div className="h-[min(65vh,680px)] min-h-[420px]"><ReactFlow nodes={flow.nodes} edges={flow.edges} nodeTypes={nodeTypes} fitView nodesDraggable={false} nodesConnectable={false}><Background color="var(--divider)" gap={18} /><Controls /></ReactFlow></div>{graph.truncated ? <div className="border-t border-divider px-4 py-3 text-sm text-warning">Graph is capped for performance. Open a package from inventory to inspect its immediate neighborhood.</div> : null}</>}</Card> : null}

    {selected ? <Drawer.Backdrop isOpen={drawer.isOpen} onOpenChange={drawer.setOpen} variant="blur"><Drawer.Content placement="right"><Drawer.Dialog className="flex h-full w-[min(100vw,44rem)] flex-col"><Drawer.Header><div className="min-w-0"><Drawer.Heading>{packageLabel(selected.component)}</Drawer.Heading><p className="mt-1 break-all font-mono text-xs text-muted">{selected.component.package_url || selected.component.bom_ref || 'No package URL'}</p></div><Drawer.CloseTrigger /></Drawer.Header><Drawer.Body className="space-y-6">{detailError ? <Card className="border border-warning/30 bg-warning/10 p-3 text-sm text-warning-foreground">{detailError}</Card> : null}<section><h3 className="text-sm font-semibold">Package evidence</h3><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><Detail label="Version" value={selected.component.version} /><Detail label="Ecosystem" value={selected.component.ecosystem || selected.component.type} /><Detail label="Supplier" value={selected.component.supplier} /><Detail label="Licenses" value={selected.component.licenses?.join(', ') || selected.component.license} /></dl></section>{detailLoading ? <p className="text-sm text-muted">Loading package relationships and vulnerabilities…</p> : <><section><h3 className="text-sm font-semibold">Dependency context</h3><p className="mt-2 text-sm text-muted">{selected.component.is_root ? 'This is the scanned artifact root.' : selected.component.dependency_depth != null ? `This package is ${selected.component.dependency_depth} edges from the SBOM root.` : 'The source SBOM did not provide a complete path to this package.'}</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><Detail label="Dependencies" value={selected.dependencies.map(packageLabel).join(', ')} /><Detail label="Required by" value={selected.dependents.map(packageLabel).join(', ')} /></div></section><section><h3 className="text-sm font-semibold">Vulnerabilities caused by this package</h3>{selected.vulnerabilities.length ? <div className="mt-3 space-y-2">{selected.vulnerabilities.map((vulnerability: Vulnerability) => <div key={vulnerability.id} className="rounded-xl border border-divider p-3"><div className="flex items-center justify-between gap-3"><span className="font-mono text-sm">{vulnerability.vuln_id}</span><Chip size="sm" variant="soft" color={vulnerability.severity === 'CRITICAL' || vulnerability.severity === 'HIGH' ? 'danger' : 'warning'}>{vulnerability.severity}</Chip></div><p className="mt-1 text-sm text-muted">{vulnerability.fixed_version ? `Fixed in ${vulnerability.fixed_version}` : 'No fix currently reported'}</p></div>)}</div> : <p className="mt-2 text-sm text-muted">No linked findings were reported for this package.</p>}</section></>}</Drawer.Body></Drawer.Dialog></Drawer.Content></Drawer.Backdrop> : null}
  </div>;
}

function Detail({ label, value }: { label: string; value?: string }) { return <div className="rounded-xl border border-divider p-3"><dt className="text-xs font-medium text-muted">{label}</dt><dd className="mt-1 break-words">{value || '—'}</dd></div>; }

function TreeNode({ component, byID, childMap, onOpen, depth = 0, ancestry }: { component: SBOMComponent; byID: Map<string, SBOMComponent>; childMap: Map<string, string[]>; onOpen: (component: SBOMComponent) => Promise<void>; depth?: number; ancestry: Set<string> }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const childNodes = (childMap.get(component.id) ?? []).flatMap((id) => { const child = byID.get(id); return child ? [child] : []; });
  const nextAncestry = new Set(ancestry).add(component.id);
  return <div style={{ marginLeft: depth ? 20 : 0 }}><div className="flex min-h-9 items-center gap-2 rounded-lg px-2 hover:bg-surface-secondary"><Button isIconOnly size="sm" variant="ghost" isDisabled={!childNodes.length} aria-label={expanded ? `Collapse ${packageLabel(component)}` : `Expand ${packageLabel(component)}`} onPress={() => setExpanded(!expanded)}>{childNodes.length ? (expanded ? '−' : '+') : '·'}</Button><Button size="sm" variant="ghost" onPress={() => void onOpen(component)} className="min-w-0 justify-start"><span className="truncate">{packageLabel(component)}</span><span className="font-mono text-xs text-muted">{component.version}</span></Button>{(component.vulnerability_count ?? 0) > 0 ? <Chip size="sm" variant="soft" color="danger">{component.vulnerability_count}</Chip> : null}</div>{expanded ? childNodes.map((child) => nextAncestry.has(child.id) ? <div key={`${component.id}-${child.id}`} className="ml-8 py-1 text-xs text-muted">↳ {packageLabel(child)} (cycle)</div> : <TreeNode key={`${component.id}-${child.id}`} component={child} byID={byID} childMap={childMap} onOpen={onOpen} depth={depth + 1} ancestry={nextAncestry} />) : null}</div>;
}
