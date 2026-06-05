import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, RotateCcw, AlertTriangle, X, Search, Calendar, User } from 'lucide-react';
import Spinner from '../components/ui/Spinner';
import { useAuth } from '../context/AuthContext';

interface TrashItem {
  id: string;
  firstName: string;
  lastName: string;
  schoolDojang: string | null;
  belt: string;
  gender: string;
  dateOfBirth: string;
  deletedAt: string | null;
  _count?: { registrations: number };
}

function daysAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export default function Trash() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [purgingId, setPurgingId] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const { data, isLoading, error } = useQuery({
    queryKey: ['competitors', 'trash'],
    queryFn: async () => {
      const res = await fetch('/api/competitors?trash=true&limit=200', { headers });
      if (!res.ok) throw new Error('Failed to fetch trash');
      return res.json();
    },
  });

  const restore = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/competitors/${id}/restore`, { method: 'POST', headers });
      if (!res.ok) throw new Error('Restore failed');
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['competitors'] }),
  });

  const purge = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/competitors/${id}/purge`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error('Purge failed');
      return res;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['competitors'] }),
  });

  const filtered = (data?.competitors || []).filter((c: TrashItem) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.firstName.toLowerCase().includes(q) ||
      c.lastName.toLowerCase().includes(q) ||
      (c.schoolDojang || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-sm font-medium mb-1">
            <Trash2 className="h-4 w-4" />
            Recently deleted
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Trash</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            Soft-deleted competitors. Restore brings them back. Hard-delete is permanent.
            Auto-purge runs after 7 days.
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">
            {data?.total ?? 0}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            in trash
          </div>
        </div>
      </div>

      {/* Warning banner when items are old */}
      {data?.competitors?.some((c: TrashItem) => c.deletedAt && daysAgo(c.deletedAt) >= 6) && (
        <div className="mb-4 flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Some items will be auto-purged within 24 hours. Restore them now if you still need them.
          </p>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4 w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or school..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : error ? (
        <div className="text-center py-12 text-red-600 dark:text-red-400">Failed to load trash.</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-lg mb-4">
            <Trash2 className="h-8 w-8 text-white" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Trash is empty</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Deleted competitors will show up here for 7 days before being permanently purged.
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
          {filtered.map((c: TrashItem) => {
            const days = c.deletedAt ? daysAgo(c.deletedAt) : 0;
            const isOld = days >= 6;
            return (
              <div key={c.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-4 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
 <div className="h-10 w-10 rounded-full bg-gradient-to-br from-gray-300 to-gray-400 dark:from-gray-600 dark:to-gray-700 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                  {c.firstName[0]}{c.lastName[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold text-gray-900 dark:text-white truncate">
                      {c.firstName} {c.lastName}
                    </div>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                      {c.belt}
                    </span>
                    {c.gender && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                        {c.gender}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {c.schoolDojang && <span>{c.schoolDojang}</span>}
                    {c._count?.registrations !== undefined && (
                      <span>{c._count.registrations} registration{c._count.registrations === 1 ? '' : 's'}</span>
                    )}
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {days === 0 ? 'today' : `${days}d ago`}
                    </span>
                    {isOld && (
                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                        <AlertTriangle className="h-3 w-3" />
                        auto-purge soon
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => restore.mutate(c.id)}
                    disabled={restore.isPending}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition-colors"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restore
                  </button>
                  {purgingId === c.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => purge.mutate(c.id)}
                        disabled={purge.isPending}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                      >
                        Yes, delete
                      </button>
                      <button
                        onClick={() => setPurgingId(null)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setPurgingId(c.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/30 dark:hover:text-red-300 transition-colors"
                      title="Hard-delete (permanent)"
                    >
                      <X className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
