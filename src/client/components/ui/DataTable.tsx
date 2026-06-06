import type { ReactNode } from 'react';

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

export function TableHead({
  children,
  density = 'comfortable',
}: {
  children: ReactNode;
  density?: 'comfortable' | 'compact';
}) {
  const spacing = density === 'compact' ? 'px-3 py-1.5' : 'px-4 py-2.5';
  return (
    <thead className="bg-slate-50/50 dark:bg-slate-800/30 border-b border-slate-200 dark:border-slate-800">
      <tr>
        {Array.isArray(children)
          ? children.map((child, i) =>
              child ? (
                <th
                  key={i}
                  className={[
                    spacing,
                    'text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-left',
                  ].join(' ')}
                >
                  {child}
                </th>
              ) : null,
            )
          : <th className={['px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-left'].join(' ')}>{children}</th>}
      </tr>
    </thead>
  );
}

export function TableBody({
  children,
  density = 'comfortable',
}: {
  children: ReactNode;
  density?: 'comfortable' | 'compact';
}) {
  const spacing = density === 'compact' ? 'px-3 py-1.5' : 'px-4 py-2.5';
  return (
    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
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