'use client';

import { Pagination } from './primitives';
import { cn } from '@/lib/utils';

export function pagerItems(page: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const items: Array<number | 'ellipsis'> = [1];
  if (page > 3) items.push('ellipsis');
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  for (let i = start; i <= end; i += 1) items.push(i);
  if (page < totalPages - 2) items.push('ellipsis');
  items.push(totalPages);
  return items;
}

/**
 * Footer for paged lists and tables: "Showing 1–25 of 140" and page controls.
 * It renders nothing when everything fits on one page, and stacks on phones.
 */
export function TablePager({
  page,
  pageSize,
  total,
  onPageChange,
  noun = 'items',
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Plural noun for the summary, e.g. "scans". */
  noun?: string;
  className?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div
      data-slot="table-pager"
      className={cn(
        'flex flex-col items-center gap-3 border-t border-border px-4 py-3 sm:flex-row sm:justify-between',
        className
      )}
    >
      <span className="text-sm text-muted-foreground tabular-nums">
        Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} {noun}
      </span>
      <Pagination size="sm">
        <Pagination.Content>
          <Pagination.Item>
            <Pagination.Previous
              isDisabled={page <= 1}
              onPress={() => onPageChange(Math.max(1, page - 1))}
            >
              <Pagination.PreviousIcon />
              <span className="hidden sm:inline">Previous</span>
            </Pagination.Previous>
          </Pagination.Item>
          {pagerItems(page, totalPages).map((item, index) =>
            item === 'ellipsis' ? (
              <Pagination.Item key={`ellipsis-${index}`}>
                <Pagination.Ellipsis />
              </Pagination.Item>
            ) : (
              <Pagination.Item key={item}>
                <Pagination.Link isActive={item === page} onPress={() => onPageChange(item)}>
                  {item}
                </Pagination.Link>
              </Pagination.Item>
            )
          )}
          <Pagination.Item>
            <Pagination.Next
              isDisabled={page >= totalPages}
              onPress={() => onPageChange(Math.min(totalPages, page + 1))}
            >
              <span className="hidden sm:inline">Next</span>
              <Pagination.NextIcon />
            </Pagination.Next>
          </Pagination.Item>
        </Pagination.Content>
      </Pagination>
    </div>
  );
}
