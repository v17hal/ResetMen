import type { ReactNode } from 'react';

import { cn } from '../cn.js';
import { EmptyState, SkeletonList } from './states.js';

export interface Column<Row> {
  key: string;
  header: ReactNode;
  /** Rendered per row. Return a string for plain cells; anything for badges and buttons. */
  cell: (row: Row) => ReactNode;
  /** Right-align money and counts so digits line up down the column. */
  align?: 'left' | 'right';
  /** Hidden below `sm`. Use for anything the phone layout can live without. */
  hideOnMobile?: boolean;
  className?: string;
}

export interface DataTableProps<Row> {
  columns: ReadonlyArray<Column<Row>>;
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  loading?: boolean;
  empty?: { title: string; description?: ReactNode };
  onRowClick?: (row: Row) => void;
  className?: string;
}

/**
 * The admin list table.
 *
 * Scrolls inside its own container rather than letting the page scroll sideways — a table
 * that pushes the whole layout wider is unusable on the phone the counter actually has.
 *
 * `onRowClick` renders a real `<button>` in the first cell rather than putting a handler on
 * the `<tr>`. A clickable row that cannot be reached by keyboard is the most common
 * accessibility failure in an admin panel, and the least visible.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  loading = false,
  empty,
  onRowClick,
  className,
}: DataTableProps<Row>) {
  if (loading) return <SkeletonList rows={5} className={className} />;

  if (rows.length === 0) {
    return (
      <EmptyState
        title={empty?.title ?? 'Nothing here yet'}
        description={empty?.description}
        className={className}
      />
    );
  }

  return (
    <div
      className={cn(
        'overflow-x-auto rounded-lg border border-border bg-surface',
        className,
      )}
    >
      <table className="w-full border-collapse text-body-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-base py-sm text-caption font-medium uppercase tracking-wide text-text-muted',
                  column.align === 'right' ? 'text-right' : 'text-left',
                  column.hideOnMobile === true && 'hidden sm:table-cell',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-border last:border-0 hover:bg-surface2"
            >
              {columns.map((column, columnIndex) => (
                <td
                  key={column.key}
                  className={cn(
                    'px-base py-sm text-text align-middle',
                    column.align === 'right' ? 'text-right tabular-nums' : 'text-left',
                    column.hideOnMobile === true && 'hidden sm:table-cell',
                    column.className,
                  )}
                >
                  {columnIndex === 0 && onRowClick !== undefined ? (
                    <button
                      type="button"
                      onClick={() => onRowClick(row)}
                      className="min-h-touch-admin w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
                    >
                      {column.cell(row)}
                    </button>
                  ) : (
                    column.cell(row)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
