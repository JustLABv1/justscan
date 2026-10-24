'use client';

import { useState } from 'react';
import { FileCode2, SearchCheck } from 'lucide-react';
import {
  Button,
  Card,
  Checkbox,
  Chip,
  Label,
  ListBox,
  SearchField,
  Select,
  Table,
} from '@/components/ui';
import type { GitRepositoryRunCandidate } from '@/lib/api';

export function DiscoveryReviewTable({
  pending,
  handled,
  selectedIds,
  busy,
  onSelect,
  onSelectMany,
  onClear,
  onIgnoreSelected,
  onReview,
}: {
  pending: GitRepositoryRunCandidate[];
  handled: GitRepositoryRunCandidate[];
  selectedIds: ReadonlySet<string>;
  busy: boolean;
  onSelect: (id: string, selected: boolean) => void;
  onSelectMany: (selected: boolean, ids: string[]) => void;
  onClear: () => void;
  onIgnoreSelected: () => void;
  onReview: (candidate: GitRepositoryRunCandidate) => void;
}) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState('pending');
  const items = (view === 'pending' ? pending : handled).filter((candidate) =>
    `${candidate.path} ${candidate.detected_type} ${candidate.confidence}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  );
  const selectedCount = pending.filter((candidate) => selectedIds.has(candidate.id)).length;
  const selectedVisible = items.filter((candidate) => selectedIds.has(candidate.id)).length;
  const allVisibleSelected = items.length > 0 && selectedVisible === items.length;
  return (
    <Card className="overflow-hidden gap-0 py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
        <div>
          <h2 className="text-sm font-medium">Discovery review</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Classify deployment markers or select paths to ignore.
          </p>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {pending.length} pending · {handled.length} handled
        </span>
      </div>
      <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row">
        <SearchField
          aria-label="Search discovery markers"
          value={query}
          onChange={setQuery}
          className="min-w-0 flex-1"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search paths or detected types…" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <Select
          aria-label="Discovery review status"
          value={view}
          onChange={(value) => setView(String(value))}
          className="sm:w-44"
        >
          <Label className="sr-only">Review status</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="pending">Needs review ({pending.length})</ListBox.Item>
              <ListBox.Item id="handled">Resolved &amp; ignored ({handled.length})</ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
      {view === 'pending' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
          <Checkbox
            aria-label="Select all visible discovery markers"
            isSelected={allVisibleSelected}
            isIndeterminate={selectedVisible > 0 && !allVisibleSelected}
            isDisabled={busy || items.length === 0}
            onChange={(selected) =>
              onSelectMany(
                selected,
                items.map((candidate) => candidate.id)
              )
            }
            className="min-h-8"
          >
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <span className="text-xs">Select visible ({items.length})</span>
          </Checkbox>
          <div className="flex items-center gap-2">
            <span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">
              {selectedCount} selected
            </span>
            {selectedCount > 0 ? (
              <Button
                aria-label="Clear discovery selection"
                variant="ghost"
                size="sm"
                isDisabled={busy}
                onPress={onClear}
              >
                Clear
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              isDisabled={selectedCount === 0}
              isPending={busy}
              onPress={onIgnoreSelected}
            >
              Ignore selected
            </Button>
          </div>
        </div>
      ) : null}
      <Table>
        <Table.ScrollContainer className="rounded-none border-0">
          <Table.Content
            aria-label="Discovery markers"
            className="min-w-[680px] table-fixed [&_td]:px-4 [&_td]:py-2 [&_th]:px-4"
          >
            <Table.Header>
              <Table.Column isRowHeader className="w-auto">
                Source path
              </Table.Column>
              <Table.Column className="w-[160px]">Detection</Table.Column>
              <Table.Column className="w-32">State</Table.Column>
              <Table.Column className="w-28">
                <span className="sr-only">Actions</span>
              </Table.Column>
            </Table.Header>
            <Table.Body>
              {items.length === 0 ? (
                <Table.Row id="empty-markers">
                  <Table.Cell colSpan={4}>
                    <div className="flex flex-col items-center gap-2 py-12 text-center">
                      <SearchCheck className="size-6 text-muted-foreground" />
                      <p className="text-sm font-medium">
                        {query
                          ? 'No matching markers'
                          : view === 'pending'
                            ? 'Nothing needs a decision'
                            : 'No resolved or ignored markers'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {query
                          ? 'Try another path or detected type.'
                          : 'Discovery decisions appear here after a dry run.'}
                      </p>
                      {query ? (
                        <Button variant="ghost" size="sm" onPress={() => setQuery('')}>
                          Clear search
                        </Button>
                      ) : null}
                    </div>
                  </Table.Cell>
                </Table.Row>
              ) : (
                items.map((candidate) => (
                  <Table.Row
                    key={candidate.id}
                    id={candidate.id}
                    className={
                      candidate.status === 'unresolved' && selectedIds.has(candidate.id)
                        ? 'bg-muted/50'
                        : ''
                    }
                  >
                    <Table.Cell>
                      {candidate.status === 'unresolved' ? (
                        <Checkbox
                          isSelected={selectedIds.has(candidate.id)}
                          isDisabled={busy}
                          onChange={(selected) => onSelect(candidate.id, selected)}
                          className="min-h-10 w-full min-w-0 py-1"
                        >
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <span className="min-w-0 whitespace-normal break-all font-mono text-xs">
                            {candidate.path}
                          </span>
                        </Checkbox>
                      ) : (
                        <div className="flex min-w-0 items-center gap-2 py-2">
                          <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
                          <code className="whitespace-normal break-all text-xs">
                            {candidate.path}
                          </code>
                        </div>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <p className="whitespace-normal text-xs">
                        {candidate.detected_type.replaceAll('_', ' ')}
                      </p>
                      <p className="mt-1 whitespace-normal text-xs text-muted-foreground">
                        {candidate.confidence} confidence
                      </p>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={
                          candidate.status === 'unresolved'
                            ? 'warning'
                            : candidate.status === 'ignored'
                              ? 'default'
                              : 'success'
                        }
                      >
                        {candidate.status === 'unresolved'
                          ? 'Needs review'
                          : candidate.status.replaceAll('_', ' ')}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      {candidate.status === 'unresolved' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          isDisabled={busy}
                          onPress={() => onReview(candidate)}
                        >
                          Resolve
                        </Button>
                      ) : null}
                    </Table.Cell>
                  </Table.Row>
                ))
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        {items.length} {view === 'pending' ? 'pending' : 'handled'} markers shown
        {view === 'pending' && selectedCount > selectedVisible
          ? ' · Selection includes markers outside this search'
          : ''}
      </div>
    </Card>
  );
}
