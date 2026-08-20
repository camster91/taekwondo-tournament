import { useState, useMemo } from 'react';
import { Search, X, Check, AlertCircle, Play, Clock, CheckCircle } from 'lucide-react';
import type { ApiMatch } from '../utils/api-types';
import {
  formatMatchCompetitorName,
  filterFeaturedMatches,
} from '../utils/featured-match';
import { Badge } from './ui';

interface FeaturedMatchPickerProps {
  matches: ApiMatch[];
  selectedMatchId: string;
  onSelectMatch: (matchId: string) => void;
  disabled?: boolean;
}

export default function FeaturedMatchPicker({
  matches,
  selectedMatchId,
  onSelectMatch,
  disabled = false,
}: FeaturedMatchPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const selectedMatch = useMemo(
    () => matches.find((m) => m.id === selectedMatchId),
    [matches, selectedMatchId]
  );

  const filteredMatches = useMemo(
    () => filterFeaturedMatches(matches, searchQuery),
    [matches, searchQuery]
  );

  const statusBadge = (status: ApiMatch['status']) => {
    switch (status) {
      case 'in_progress':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
            <Play className="h-3 w-3" /> In Progress
          </span>
        );
      case 'ready':
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
            <Clock className="h-3 w-3" /> Scheduled
          </span>
        );
      case 'completed':
      case 'bye':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 dark:text-slate-400">
            <CheckCircle className="h-3 w-3" /> {status === 'bye' ? 'Bye' : 'Completed'}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-3 w-full">
      {/* Selected match preview summary */}
      {selectedMatchId && (
        <div
          className={`p-3 rounded-lg border text-sm flex items-start justify-between gap-3 ${
            selectedMatch
              ? selectedMatch.status === 'completed' || selectedMatch.status === 'bye'
                ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                : 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800'
              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
          }`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Selected Featured Match
              </span>
              {selectedMatch && statusBadge(selectedMatch.status)}
            </div>
            {selectedMatch ? (
              <div>
                <p className="font-medium text-slate-900 dark:text-white truncate">
                  {formatMatchCompetitorName(selectedMatch.competitor1)} vs{' '}
                  {formatMatchCompetitorName(selectedMatch.competitor2)}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  {selectedMatch._divisionName ? `${selectedMatch._divisionName} · ` : ''}
                  Match #{selectedMatch.matchNumber}
                  {selectedMatch.ringNumber != null ? ` · Ring ${selectedMatch.ringNumber}` : ' · Unassigned Ring'}
                </p>
                {(selectedMatch.status === 'completed' || selectedMatch.status === 'bye') && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5" /> Note: This match is already finished. You may want to choose an active or upcoming match.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-red-700 dark:text-red-400 flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5" /> Configured match ID ({selectedMatchId}) was not found in active divisions. Please pick a new match.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onSelectMatch('')}
            disabled={disabled}
            className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 p-1"
            title="Clear selection"
            aria-label="Clear selected match"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Search and Picker Combobox / List */}
      <div className="space-y-2">
        <label
          htmlFor="featured-match-search"
          className="block text-sm font-medium text-slate-700 dark:text-slate-300"
        >
          Search & Pick Match
        </label>
        <div className="relative">
          <input
            id="featured-match-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by competitor, division, match #, or ring..."
            disabled={disabled || matches.length === 0}
            className="h-10 pl-9 pr-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 w-full focus:ring-2 focus:ring-primary-500"
          />
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {matches.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
            No matches found in this tournament. Generate brackets first.
          </p>
        ) : filteredMatches.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
            No matches match &quot;{searchQuery}&quot;.
          </p>
        ) : (
          <div
            role="listbox"
            aria-label="Available matches"
            className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            {filteredMatches.map((m) => {
              const isSelected = m.id === selectedMatchId;
              const comp1 = formatMatchCompetitorName(m.competitor1);
              const comp2 = formatMatchCompetitorName(m.competitor2);

              return (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={disabled}
                  onClick={() => onSelectMatch(m.id)}
                  className={`w-full text-left px-3 py-2.5 transition-colors flex items-center justify-between gap-3 text-sm ${
                    isSelected
                      ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-900 dark:text-primary-100'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-800 dark:text-slate-200'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">
                        {comp1} vs {comp2}
                      </span>
                      {statusBadge(m.status)}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                      {m._divisionName ? `${m._divisionName} · ` : ''}
                      Match #{m.matchNumber}
                      {m.ringNumber != null ? ` · Ring ${m.ringNumber}` : ' · Unassigned Ring'}
                    </p>
                  </div>
                  {isSelected && (
                    <Check className="h-4 w-4 text-primary-600 dark:text-primary-400 flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
