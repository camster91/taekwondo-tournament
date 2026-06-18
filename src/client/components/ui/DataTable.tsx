import type { HTMLAttributes, ReactNode, TdHTMLAttributes } from 'react';
import { Children, isValidElement } from 'react';

interface DataTableProps {
  children: ReactNode;
  density?: 'comfortable' | 'compact';
  className?: string;
}

export default function DataTable({
  children,
  density = 'comfortable',
  className = '',
}: DataTableProps) {
  return (
    <div className={['overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800', className].filter(Boolean).join(' ')}>
      <table className="w-full text-sm">
        {children}
      </table>
    </div>
  );
}

type TheadProps = HTMLAttributes<HTMLTableSectionElement> & {
  density?: 'comfortable' | 'compact';
};

// Returns true if any direct child is a React element whose root tag is
// `th` or `tr` — in that case the caller is providing pre-wrapped header
// cells or a header row, and we should NOT auto-wrap.
function alreadyWrapped(children: ReactNode): boolean {
  let found = false;
  Children.forEach(children, (child) => {
    if (found) return;
    if (isValidElement(child)) {
      // ValidElement.props has a .type that's a string for HTML elements
      // and a function/class for components.
      const t = child.type as unknown;
      if (typeof t === 'string' && (t === 'th' || t === 'tr')) {
        found = true;
      } else if (typeof t === 'function') {
        // Component types — check the displayName as a hint. TableRow and
        // SortableHeader both render their own <tr>/<th>.
        const name = (t as { displayName?: string; name?: string }).displayName || (t as { name?: string }).name || '';
        if (name === 'TableRow' || name === 'SortableHeader') {
          found = true;
        }
      }
    }
  });
  return found;
}

export function TableHead({
  children,
  density = 'comfortable',
  className = '',
  ...rest
}: TheadProps) {
  const spacing = density === 'compact' ? 'px-3 py-1.5' : 'px-4 py-2.5';

  // Pass-through mode: caller is providing their own <tr>/<th> structure.
  // The legacy auto-wrap mode handled callers that passed bare strings or
  // numbers (one per column). We preserve that path because several
  // pages still use it; new callers can just use TableRow/SortableHeader.
  if (alreadyWrapped(children)) {
    return (
      <thead
        {...rest}
        className={[
          'bg-slate-50/50 dark:bg-slate-800/30 border-b border-slate-200 dark:border-slate-800',
          className,
        ].filter(Boolean).join(' ')}
      >
        {children}
      </thead>
    );
  }

  return (
    <thead
      {...rest}
      className={[
        'bg-slate-50/50 dark:bg-slate-800/30 border-b border-slate-200 dark:border-slate-800',
        className,
      ].filter(Boolean).join(' ')}
    >
      {Array.isArray(children)
        ? (
          <tr>
            {children.map((child, i) =>
              child ? (
                <th
                  key={i}
                  scope="col"
                  className={[
                    spacing,
                    'text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-left',
                  ].join(' ')}
                >
                  {child}
                </th>
              ) : null,
            )}
          </tr>
        )
        : children}
    </thead>
  );
}

type TbodyProps = HTMLAttributes<HTMLTableSectionElement> & {
  density?: 'comfortable' | 'compact';
};

export function TableBody({
  children,
  density = 'comfortable',
  className = '',
  ...rest
}: TbodyProps) {
  const spacing = density === 'compact' ? 'px-3 py-1.5' : 'px-4 py-2.5';

  // Pass-through mode: caller is providing their own <TableRow>s (which
  // render their own <tr>). Auto-wrap mode (legacy) accepted arrays of
  // cell values and built the row for the caller; preserve that for
  // back-compat.
  if (alreadyWrapped(children)) {
    return (
      <tbody
        {...rest}
        className={[
          'divide-y divide-slate-100 dark:divide-slate-800/60',
          className,
        ].filter(Boolean).join(' ')}
      >
        {children}
      </tbody>
    );
  }

  return (
    <tbody
      {...rest}
      className={[
        'divide-y divide-slate-100 dark:divide-slate-800/60',
        className,
      ].filter(Boolean).join(' ')}
    >
      {Array.isArray(children)
        ? children.map((row, i) =>
            row ? (
              <tr
                key={i}
                className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors last:border-b-0"
              >
                {Array.isArray(row)
                  ? row.map((cell, j) =>
                      cell !== null && cell !== undefined ? (
                        <td
                          key={j}
                          className={[spacing, 'text-sm text-slate-700 dark:text-slate-300'].join(' ')}
                        >
                          {cell}
                        </td>
                      ) : null,
                    )
                  : row}
              </tr>
            ) : null,
          )
        : children}
    </tbody>
  );
}

type TrProps = HTMLAttributes<HTMLTableRowElement>;

export function TableRow({ children, className = '', ...rest }: TrProps) {
  return (
    <tr
      {...rest}
      className={[
        'hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors last:border-b-0',
        className,
      ].filter(Boolean).join(' ')}
    >
      {children}
    </tr>
  );
}

type TdProps = TdHTMLAttributes<HTMLTableCellElement> & {
  density?: 'comfortable' | 'compact';
};

export function TableCell({
  children,
  density = 'comfortable',
  className = '',
  ...rest
}: TdProps) {
  const spacing = density === 'compact' ? 'px-3 py-1.5' : 'px-4 py-2.5';
  return (
    <td
      {...rest}
      className={[
        spacing,
        'text-sm text-slate-700 dark:text-slate-300',
        className,
      ].filter(Boolean).join(' ')}
    >
      {children}
    </td>
  );
}