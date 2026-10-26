'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';

import type { SBOMComponent, SBOMComponentDetail, SBOMGraph, Vulnerability } from '@/lib/api';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import * as dagre from '@dagrejs/dagre';
import {
  Button,
  Card,
  Checkbox,
  Popover,
  Tabs,
  Tooltip,
  Chip,
  Drawer,
  Label,
  ListBox,
  SearchField,
  Select,
  Table,
  type SortDescriptor,
  useOverlayState,
} from '@/components/ui';
import { Download01Icon, FilterIcon, GitBranchIcon, PackageIcon } from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type SBOMWorkspaceProps = {
  loadComponents: (
    query?: string
  ) => Promise<{ data: SBOMComponent[]; total: number; document?: SBOMGraph['document'] }>;
  loadGraph: (focus?: string) => Promise<SBOMGraph>;
  loadComponent: (componentId: string) => Promise<SBOMComponentDetail>;
  downloadHref?: string;
  readOnly?: boolean;
  focusPackage?: { packageName: string; version?: string; requestId: number } | null;
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
      className="nodrag nopan min-w-48 cursor-pointer rounded-xl border border-border bg-card px-3 py-2.5 text-foreground shadow-sm transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:border-border dark:bg-muted dark:text-foreground dark:hover:bg-muted"
      role="button"
      tabIndex={0}
      aria-label={`Open ${packageLabel(data.component)} ${data.component.version}`}
      onClick={() => data.onOpen(data.component)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          data.onOpen(data.component);
        }
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!border-divider !bg-surface-secondary"
      />
      <div className="flex items-start justify-between gap-2">
        <span className="max-w-36 truncate text-sm font-medium">
          {packageLabel(data.component)}
        </span>
        {count > 0 ? (
          <Chip size="sm" color="danger" variant="soft">
            {count}
          </Chip>
        ) : null}
      </div>
      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
        {data.component.version || 'No version'}
      </p>
      <Handle
        type="source"
        position={Position.Right}
        className="!border-divider !bg-surface-secondary"
      />
    </div>
  );
}

const nodeTypes = { package: PackageNode };

// Older scans and some providers serialize empty collections as null. Keep the
// presentation layer tolerant of those historical/API variants.
function normalizeGraph(graph?: Partial<SBOMGraph> | null): SBOMGraph {
  return {
    document: graph?.document,
    nodes: graph?.nodes ?? [],
    edges: graph?.edges ?? [],
    truncated: Boolean(graph?.truncated),
  };
}

function graphLayout(
  graph: SBOMGraph,
  onOpen: (component: SBOMComponent) => void
): { nodes: Node<PackageNodeData>[]; edges: Edge[] } {
  const layout = new dagre.graphlib.Graph();
  layout.setDefaultEdgeLabel(() => ({}));
  layout.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 80, marginx: 32, marginy: 32 });
  graph.nodes.forEach((component) => layout.setNode(component.id, { width: 192, height: 76 }));
  graph.edges.forEach((edge) => layout.setEdge(edge.from_component_id, edge.to_component_id));
  dagre.layout(layout);
  return {
    nodes: graph.nodes.map((component) => {
      const position = layout.node(component.id) ?? { x: 0, y: 0 };
      return {
        id: component.id,
        type: 'package',
        position: { x: position.x - 96, y: position.y - 38 },
        data: { component, onOpen },
      };
    }),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.from_component_id,
      target: edge.to_component_id,
      type: 'smoothstep',
      style: { stroke: 'var(--divider)', strokeWidth: 1.5 },
    })),
  };
}

export function SBOMWorkspace({
  loadComponents,
  loadGraph,
  loadComponent,
  downloadHref,
  focusPackage,
}: SBOMWorkspaceProps) {
  const [view, setView] = useState<View>('inventory');
  const [query, setQuery] = useState(() => focusPackage?.packageName ?? '');
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
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: 'package',
    direction: 'ascending',
  });
  const drawer = useOverlayState();
  const handledFocusRequestRef = useRef<number | null>(null);

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
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [loadComponents, query]);

  useEffect(() => {
    if (view === 'inventory') return;
    let alive = true;
    loadGraph()
      .then((result) => {
        if (!alive) return;
        const normalized = normalizeGraph(result);
        setGraph(normalized);
        setDocument((current) => normalized.document ?? current);
      })
      .catch(() => alive && setGraph({ nodes: [], edges: [], truncated: false }))
      .finally(() => alive && setGraphLoading(false));
    return () => {
      alive = false;
    };
  }, [view, loadGraph]);

  const ecosystems = useMemo(
    () =>
      [
        ...new Set(
          components.flatMap((component) => {
            const value = component.ecosystem || component.type;
            return value ? [value] : [];
          })
        ),
      ].sort(),
    [components]
  );
  const visibleComponents = useMemo(() => {
    const filtered = components.filter(
      (component) =>
        (ecosystem === 'all' || (component.ecosystem || component.type) === ecosystem) &&
        (!vulnerableOnly || (component.vulnerability_count ?? 0) > 0)
    );
    return [...filtered].sort((first, second) => {
      const column = String(sortDescriptor.column);
      const value = (component: SBOMComponent) =>
        column === 'package'
          ? packageLabel(component)
          : column === 'vulnerabilities'
            ? String(component.vulnerability_count ?? 0).padStart(8, '0')
            : String(component[column as keyof SBOMComponent] ?? '');
      const comparison = value(first).localeCompare(value(second), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      return sortDescriptor.direction === 'descending' ? -comparison : comparison;
    });
  }, [components, ecosystem, vulnerableOnly, sortDescriptor]);
  const inventoryRows = useMemo(() => {
    const occurrences = new Map<string, number>();
    return visibleComponents.map((component) => {
      const identity =
        component.id ||
        component.bom_ref ||
        component.package_url ||
        `${component.name}@${component.version}`;
      const occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      return { component, rowID: `package-${identity}-${occurrence}` };
    });
  }, [visibleComponents]);
  const byID = useMemo(
    () => new Map(graph.nodes.map((component) => [component.id, component])),
    [graph.nodes]
  );
  const childMap = useMemo(() => {
    const value = new Map<string, string[]>();
    graph.edges.forEach((edge) =>
      value.set(edge.from_component_id, [
        ...(value.get(edge.from_component_id) ?? []),
        edge.to_component_id,
      ])
    );
    return value;
  }, [graph.edges]);
  const roots = graph.nodes.filter(
    (component) =>
      component.is_root || !graph.edges.some((edge) => edge.to_component_id === component.id)
  );
  const graphAvailable = graph.edges.length > 0;
  const sourceLabel =
    document?.source === 'trivy_fallback'
      ? 'Trivy fallback'
      : document?.source === 'xray'
        ? 'JFrog Xray'
        : document?.source === 'trivy'
          ? 'Trivy'
          : 'Legacy inventory';

  const openComponent = useCallback(
    async (component: SBOMComponent) => {
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
        setDetailError(
          'Package details could not be loaded. The basic package evidence is still shown; retry after the scan API is available.'
        );
      } finally {
        setDetailLoading(false);
      }
    },
    [drawer, loadComponent]
  );

  useEffect(() => {
    if (!focusPackage || loading || handledFocusRequestRef.current === focusPackage.requestId)
      return;
    const exactMatch = components.find(
      (component) =>
        packageLabel(component) === focusPackage.packageName &&
        (!focusPackage.version || component.version === focusPackage.version)
    );
    const packageMatch = components.find(
      (component) => packageLabel(component) === focusPackage.packageName
    );
    handledFocusRequestRef.current = focusPackage.requestId;
    if (exactMatch ?? packageMatch) {
      const timer = window.setTimeout(() => {
        void openComponent(exactMatch ?? packageMatch!);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [components, focusPackage, loading, openComponent]);
  const flow = useMemo(() => graphLayout(graph, openComponent), [graph, openComponent]);

  function selectView(nextView: View) {
    if (nextView !== 'inventory') setGraphLoading(true);
    setView(nextView);
  }

  return (
    <div className="space-y-4">
      {document?.diagnostic ? (
        <Card className="border border-warning/30 bg-warning/10 p-4 text-sm text-warning-foreground">
          <div className="flex items-start gap-3">
            <PackageIcon className="mt-0.5 shrink-0" size={18} />
            <p>{document.diagnostic}</p>
          </div>
        </Card>
      ) : null}
      <Card className="overflow-hidden gap-0 py-0">
        <div className="border-b border-border p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium">Packages &amp; SBOM</h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {total.toLocaleString()} packages
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {sourceLabel} ·{' '}
                {document
                  ? document.graph_complete
                    ? 'Complete dependency graph'
                    : 'Partial dependency graph'
                  : 'Loading inventory'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Tabs selectedKey={view} onSelectionChange={(key) => selectView(String(key) as View)}>
                <Tabs.List aria-label="SBOM view">
                  {(['inventory', 'tree', 'graph'] as View[]).map((item) => (
                    <Tabs.Tab key={item} id={item}>
                      {item[0].toUpperCase() + item.slice(1)}
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
                {(['inventory', 'tree', 'graph'] as View[]).map((item) => (
                  <Tabs.Panel key={item} id={item} className="hidden" />
                ))}
              </Tabs>
              {downloadHref && document ? (
                <Tooltip>
                  <Tooltip.Trigger>
                    <Button
                      aria-label="Download CycloneDX SBOM"
                      variant="ghost"
                      size="icon"
                      onPress={() => window.location.assign(downloadHref)}
                    >
                      <Download01Icon size={16} />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content>Download CycloneDX SBOM</Tooltip.Content>
                </Tooltip>
              ) : null}
            </div>
          </div>
        </div>

        {view === 'inventory' ? (
          <>
            <div className="flex flex-col gap-2 border-b border-border p-3 lg:flex-row lg:items-center">
              <SearchField
                value={query}
                onChange={setQuery}
                variant="secondary"
                aria-label="Search packages"
                className="flex-1"
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="Search packages, versions, or ecosystems…" />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <Popover>
                <Popover.Trigger>
                  <Button variant="outline">
                    <FilterIcon size={15} />
                    Filters
                    {ecosystem !== 'all' || vulnerableOnly
                      ? ` (${Number(ecosystem !== 'all') + Number(vulnerableOnly)})`
                      : ''}
                  </Button>
                </Popover.Trigger>
                <Popover.Content
                  placement="bottom end"
                  className="w-64 space-y-4 p-4"
                  aria-label="Package filters"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Package filters</h3>
                    {ecosystem !== 'all' || vulnerableOnly ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => {
                          setEcosystem('all');
                          setVulnerableOnly(false);
                        }}
                      >
                        Reset
                      </Button>
                    ) : null}
                  </div>
                  <Select
                    value={ecosystem}
                    onChange={(value) => setEcosystem(typeof value === 'string' ? value : 'all')}
                    variant="secondary"
                    aria-label="Filter by ecosystem"
                    className="w-full"
                  >
                    <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Ecosystem
                    </Label>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        <ListBox.Item id="all">All ecosystems</ListBox.Item>
                        {ecosystems.map((item) => (
                          <ListBox.Item key={item} id={item}>
                            {item}
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                  <Checkbox isSelected={vulnerableOnly} onChange={setVulnerableOnly}>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <span>Vulnerable packages only</span>
                  </Checkbox>
                </Popover.Content>
              </Popover>
            </div>
            <div>
              <Table variant="secondary">
                <Table.ScrollContainer className="rounded-none border-0">
                  <Table.Content
                    aria-label="SBOM package inventory"
                    className="min-w-[1120px] table-fixed [&_td]:px-3 [&_td]:py-3 [&_th]:px-3"
                    sortDescriptor={sortDescriptor}
                    onSortChange={setSortDescriptor}
                  >
                    <Table.Header>
                      <Table.Column id="package" allowsSorting isRowHeader className="w-auto">
                        Package
                      </Table.Column>
                      <Table.Column id="version" allowsSorting className="w-[160px]">
                        Version
                      </Table.Column>
                      <Table.Column id="ecosystem" allowsSorting className="w-[112px]">
                        Type
                      </Table.Column>
                      <Table.Column id="dependency_depth" allowsSorting className="w-[144px]">
                        Relationship
                      </Table.Column>
                      <Table.Column id="vulnerabilities" allowsSorting className="w-[160px]">
                        Vulnerabilities
                      </Table.Column>
                      <Table.Column id="license" allowsSorting className="w-[180px]">
                        License
                      </Table.Column>
                    </Table.Header>
                    <Table.Body
                      key={loading ? 'loading' : inventoryRows.length === 0 ? 'empty' : 'packages'}
                    >
                      {loading ? (
                        <Table.Row id="loading">
                          <Table.Cell colSpan={6}>
                            <div className="py-10 text-center text-sm text-muted-foreground">
                              Loading package evidence…
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      ) : inventoryRows.length === 0 ? (
                        <Table.Row id="empty">
                          <Table.Cell colSpan={6}>
                            <div className="py-10 text-center text-sm text-muted-foreground">
                              No packages match these filters.
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      ) : (
                        inventoryRows.map(({ component, rowID }) => (
                          <Table.Row key={rowID} id={rowID} className="hover:bg-surface-secondary">
                            <Table.Cell className="max-w-0">
                              <Button
                                variant="ghost"
                                className="h-auto w-full min-w-0 justify-start rounded-sm p-0 text-left"
                                aria-label={`Open ${packageLabel(component)} ${component.version}`}
                                onPress={() => void openComponent(component)}
                              >
                                <span className="min-w-0 w-full">
                                  <span className="block truncate font-medium">
                                    {packageLabel(component)}
                                  </span>
                                  <span className="block truncate font-mono text-xs text-muted-foreground">
                                    {component.package_url || component.bom_ref || 'No package URL'}
                                  </span>
                                </span>
                              </Button>
                            </Table.Cell>
                            <Table.Cell className="truncate font-mono text-xs">
                              <span title={component.version}>{component.version || '—'}</span>
                            </Table.Cell>
                            <Table.Cell className="truncate">
                              <Chip size="sm" variant="soft">
                                {component.ecosystem || component.type}
                              </Chip>
                            </Table.Cell>
                            <Table.Cell className="truncate">
                              {component.is_root
                                ? 'Root'
                                : component.dependency_depth != null
                                  ? `Depth ${component.dependency_depth}`
                                  : 'Unknown'}
                            </Table.Cell>
                            <Table.Cell>
                              <Chip
                                size="sm"
                                variant="soft"
                                color={
                                  (component.vulnerability_count ?? 0) > 0 ? 'danger' : 'default'
                                }
                              >
                                {component.vulnerability_count ?? 0}
                              </Chip>
                            </Table.Cell>
                            <Table.Cell className="truncate">
                              {component.licenses?.join(', ') || component.license || '—'}
                            </Table.Cell>
                          </Table.Row>
                        ))
                      )}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            </div>
          </>
        ) : null}

        {view === 'tree' ? (
          <div className="p-4">
            {graphLoading ? (
              <p className="text-sm text-muted-foreground">Loading dependency relationships…</p>
            ) : !graphAvailable ? (
              <div className="space-y-2">
                <p className="font-medium">
                  Dependency relationships are not available for this scan.
                </p>
                <p className="text-sm text-muted-foreground">
                  This is a legacy package inventory created before JustScan retained CycloneDX
                  dependency data. Packages remain clickable below; re-scan the artifact to generate
                  its dependency tree.
                </p>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {graph.nodes.map((component) => (
                    <Button
                      key={component.id}
                      variant="secondary"
                      className="justify-start"
                      onPress={() => void openComponent(component)}
                    >
                      <PackageIcon size={15} />
                      <span className="truncate">
                        {packageLabel(component)} {component.version}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <p className="mb-3 text-sm text-muted-foreground">
                  Expand the dependency story from the scanned artifact. A package can occur under
                  more than one parent; cycles are marked instead of repeated.
                </p>
                <div className="space-y-1">
                  {roots.map((root) => (
                    <TreeNode
                      key={root.id}
                      component={root}
                      byID={byID}
                      childMap={childMap}
                      onOpen={openComponent}
                      ancestry={new Set()}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        ) : null}

        {view === 'graph' ? (
          <div>
            {graphLoading ? (
              <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">
                Loading dependency graph…
              </div>
            ) : !graphAvailable ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center">
                <GitBranchIcon size={28} className="text-muted-foreground" />
                <p className="mt-4 font-medium">No dependency graph is available for this scan.</p>
                <p className="mt-2 max-w-lg text-sm text-muted-foreground">
                  The legacy inventory has package records but no declared relationships. Re-scan to
                  generate a CycloneDX dependency graph; package details are still available from
                  Inventory or Tree.
                </p>
              </div>
            ) : (
              <>
                <div className="h-[min(65vh,680px)] min-h-[420px]">
                  <ReactFlow
                    nodes={flow.nodes}
                    edges={flow.edges}
                    nodeTypes={nodeTypes}
                    fitView
                    nodesDraggable={false}
                    nodesConnectable={false}
                  >
                    <Background color="var(--divider)" gap={18} />
                    <Controls />
                  </ReactFlow>
                </div>
                {graph.truncated ? (
                  <div className="border-t border-divider px-4 py-3 text-sm text-warning-foreground">
                    Graph is capped for performance. Open a package from inventory to inspect its
                    immediate neighborhood.
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </Card>

      {selected ? (
        <Drawer.Backdrop isOpen={drawer.isOpen} onOpenChange={drawer.setOpen} variant="blur">
          <Drawer.Content placement="right">
            <Drawer.Dialog className="flex h-full w-[min(100vw,44rem)] flex-col">
              <Drawer.Header>
                <div className="min-w-0">
                  <Drawer.Heading>{packageLabel(selected.component)}</Drawer.Heading>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {selected.component.package_url ||
                      selected.component.bom_ref ||
                      'No package URL'}
                  </p>
                </div>
                <Drawer.CloseTrigger />
              </Drawer.Header>
              <Drawer.Body className="space-y-6">
                {detailError ? (
                  <Card className="border border-warning/30 bg-warning/10 p-3 text-sm text-warning-foreground">
                    {detailError}
                  </Card>
                ) : null}
                <section>
                  <h3 className="text-sm font-semibold">Package evidence</h3>
                  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                    <Detail label="Version" value={selected.component.version} />
                    <Detail
                      label="Ecosystem"
                      value={selected.component.ecosystem || selected.component.type}
                    />
                    <Detail label="Supplier" value={selected.component.supplier} />
                    <Detail
                      label="Licenses"
                      value={selected.component.licenses?.join(', ') || selected.component.license}
                    />
                  </dl>
                </section>
                {detailLoading ? (
                  <p className="text-sm text-muted-foreground">
                    Loading package relationships and vulnerabilities…
                  </p>
                ) : (
                  <>
                    <section>
                      <h3 className="text-sm font-semibold">Dependency context</h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {selected.component.is_root
                          ? 'This is the scanned artifact root.'
                          : selected.component.dependency_depth != null
                            ? `This package is ${selected.component.dependency_depth} edges from the SBOM root.`
                            : 'The source SBOM did not provide a complete path to this package.'}
                      </p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Detail
                          label="Dependencies"
                          value={selected.dependencies.map(packageLabel).join(', ')}
                        />
                        <Detail
                          label="Required by"
                          value={selected.dependents.map(packageLabel).join(', ')}
                        />
                      </div>
                    </section>
                    <section>
                      <h3 className="text-sm font-semibold">
                        Vulnerabilities caused by this package
                      </h3>
                      {selected.vulnerabilities.length ? (
                        <div className="mt-3 space-y-2">
                          {selected.vulnerabilities.map((vulnerability: Vulnerability) => (
                            <div
                              key={vulnerability.id}
                              className="rounded-xl border border-divider p-3"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-mono text-sm">{vulnerability.vuln_id}</span>
                                <Chip
                                  size="sm"
                                  variant="soft"
                                  color={
                                    vulnerability.severity === 'CRITICAL' ||
                                    vulnerability.severity === 'HIGH'
                                      ? 'danger'
                                      : 'warning'
                                  }
                                >
                                  {vulnerability.severity}
                                </Chip>
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {vulnerability.fixed_version
                                  ? `Fixed in ${vulnerability.fixed_version}`
                                  : 'No fix currently reported'}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">
                          No linked findings were reported for this package.
                        </p>
                      )}
                    </section>
                  </>
                )}
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-xl border border-divider p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words">{value || '—'}</dd>
    </div>
  );
}

function TreeNode({
  component,
  byID,
  childMap,
  onOpen,
  depth = 0,
  ancestry,
}: {
  component: SBOMComponent;
  byID: Map<string, SBOMComponent>;
  childMap: Map<string, string[]>;
  onOpen: (component: SBOMComponent) => Promise<void>;
  depth?: number;
  ancestry: Set<string>;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const childNodes = (childMap.get(component.id) ?? []).flatMap((id) => {
    const child = byID.get(id);
    return child ? [child] : [];
  });
  const nextAncestry = new Set(ancestry).add(component.id);
  return (
    <div style={{ marginLeft: depth ? 20 : 0 }}>
      <div className="flex min-h-9 min-w-0 items-center gap-2 rounded-md px-2 hover:bg-muted/40">
        {childNodes.length > 0 ? (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${packageLabel(component)}`}
            onPress={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </Button>
        ) : (
          <span aria-hidden className="size-6 shrink-0" />
        )}
        <Button
          size="sm"
          variant="ghost"
          onPress={() => void onOpen(component)}
          className="h-auto min-w-0 flex-1 shrink justify-start gap-2 whitespace-normal px-0 py-1 text-left"
        >
          <span className="truncate">{packageLabel(component)}</span>
          <span className="font-mono text-xs text-muted-foreground">{component.version}</span>
        </Button>
        {(component.vulnerability_count ?? 0) > 0 ? (
          <Chip size="sm" variant="soft" color="danger">
            {component.vulnerability_count}
          </Chip>
        ) : null}
      </div>
      {expanded
        ? childNodes.map((child) =>
            nextAncestry.has(child.id) ? (
              <div
                key={`${component.id}-${child.id}`}
                className="ml-8 py-1 text-xs text-muted-foreground"
              >
                ↳ {packageLabel(child)} (cycle)
              </div>
            ) : (
              <TreeNode
                key={`${component.id}-${child.id}`}
                component={child}
                byID={byID}
                childMap={childMap}
                onOpen={onOpen}
                depth={depth + 1}
                ancestry={nextAncestry}
              />
            )
          )
        : null}
    </div>
  );
}
