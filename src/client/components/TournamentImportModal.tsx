import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { getAuthHeaders } from '../context/AuthContext';
import { Button, Label, Modal, Select } from './ui';
import { readAdminOperationError } from '../utils/admin-operation-error';

/**
 * "Import from spreadsheet" on the tournament page (roadmap #11): upload a
 * sheet, see what will happen, then add everyone to this tournament. Rows
 * marked Y / Yes / X / 1 in an event column are entered in that event.
 */

type MappingKey =
  | 'firstName' | 'lastName' | 'name' | 'gender' | 'dateOfBirth' | 'age' | 'belt'
  | 'danRank' | 'weight' | 'height' | 'school' | 'specialNeeds' | 'patterns' | 'sparring';
type Mapping = Partial<Record<MappingKey, string>>;

interface ImportSummary {
  rowsReady: number;
  newCompetitors: number;
  matchedCompetitors: number;
  registrationsToCreate: number;
  waitlisted: number;
  registrationsUpdated: number;
  events: { patterns: number; sparring: number };
  skippedCount: number;
  skipped: Array<{ row: number; name: string | null; reason: string }>;
  planLimit: { limit: number; current: number; requested: number } | null;
}

interface ImportResponse {
  sheetName: string;
  headerRow: number;
  headers: string[];
  mapping: Mapping;
  missing: string[];
  summary: ImportSummary | null;
  committed: boolean;
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const OTHER_COLUMNS: Array<{ key: MappingKey; label: string }> = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'name', label: 'Full name (instead of first and last)' },
  { key: 'gender', label: 'Gender' },
  { key: 'dateOfBirth', label: 'Date of birth' },
  { key: 'age', label: 'Age (if there is no date of birth)' },
  { key: 'belt', label: 'Belt' },
  { key: 'danRank', label: 'Dan rank' },
  { key: 'weight', label: 'Weight' },
  { key: 'height', label: 'Height' },
  { key: 'school', label: 'School' },
  { key: 'specialNeeds', label: 'Special needs' },
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function TournamentImportModal({
  tournamentId,
  eventLabels,
  onClose,
}: {
  tournamentId: string;
  eventLabels: { patterns: string; sparring: string };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const idPrefix = useId();
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ImportSummary | null>(null);

  const request = useMutation({
    mutationFn: async (input: { fileBase64: string; fileName: string; mapping?: Mapping; previous?: ImportResponse | null; commit: boolean }) => {
      const res = await fetch(`/api/tournaments/${tournamentId}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          fileBase64: input.fileBase64,
          fileName: input.fileName,
          commit: input.commit,
          ...(input.mapping && input.previous
            ? { columnMapping: input.mapping, sheetName: input.previous.sheetName, headerRow: input.previous.headerRow }
            : {}),
        }),
      });
      if (!res.ok) throw new Error(await readAdminOperationError(res, 'The spreadsheet could not be imported. Please try again.'));
      return res.json() as Promise<ImportResponse>;
    },
  });

  const runPreview = (source: { name: string; base64: string }, nextMapping?: Mapping, previous?: ImportResponse | null) => {
    setError(null);
    request.mutate(
      { fileBase64: source.base64, fileName: source.name, mapping: nextMapping, previous, commit: false },
      {
        onSuccess: (data) => {
          setPreview(data);
          setMapping(data.mapping);
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'The spreadsheet could not be read.'),
      },
    );
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    setError(null);
    setPreview(null);
    if (picked.size > MAX_FILE_BYTES) {
      setError('This file is too big (25 MB at most). Split it into smaller files.');
      return;
    }
    try {
      const source = { name: picked.name, base64: await readFileAsBase64(picked) };
      setFile(source);
      runPreview(source);
    } catch {
      setError('This file could not be read. Check the file and try again.');
    }
  };

  const changeColumn = (key: MappingKey, value: string) => {
    if (!file) return;
    const next = { ...mapping, [key]: value || undefined };
    setMapping(next);
    runPreview(file, next, preview);
  };

  const commit = () => {
    if (!file || !preview) return;
    setError(null);
    request.mutate(
      { fileBase64: file.base64, fileName: file.name, mapping, previous: preview, commit: true },
      {
        onSuccess: async (data) => {
          setDone(data.summary);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['registrations', tournamentId] }),
            queryClient.invalidateQueries({ queryKey: ['tournament', tournamentId] }),
            queryClient.invalidateQueries({ queryKey: ['competitors'] }),
          ]);
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'The spreadsheet could not be imported.'),
      },
    );
  };

  const summary = preview?.summary ?? null;
  const toImport = summary ? summary.registrationsToCreate + summary.registrationsUpdated : 0;
  const canCommit = Boolean(summary && toImport > 0 && !summary.planLimit && preview?.missing.length === 0);
  const busy = request.isPending;

  const columnSelect = (key: MappingKey, label: string) => {
    const selectId = `${idPrefix}-${key}`;
    return (
      <div key={key}>
        <Label htmlFor={selectId} className="text-xs sm:text-sm">{label}</Label>
        <Select
          id={selectId}
          value={mapping[key] ?? ''}
          onChange={(e) => changeColumn(key, e.target.value)}
          disabled={busy}
          className="w-full text-sm"
        >
          <option value="">Not in this file</option>
          {(preview?.headers ?? []).map((header) => (
            <option key={header} value={header}>{header}</option>
          ))}
        </Select>
      </div>
    );
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      closeDisabled={busy}
      // A plain-string title gives the dialog its accessible name.
      title="Import from spreadsheet"
      size="xl"
      footer={done ? (
        <Button variant="primary" onClick={onClose} className="w-full sm:w-auto">Close</Button>
      ) : (
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy} className="w-full sm:w-auto">Cancel</Button>
          {summary && (
            <Button variant="success" onClick={commit} loading={busy} disabled={busy || !canCommit} className="w-full sm:w-auto">
              {`Import ${plural(toImport, 'competitor', 'competitors')}`}
            </Button>
          )}
        </>
      )}
    >
      {error && (
        <div role="alert" aria-live="assertive" className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger dark:border-danger/50 dark:bg-danger/20">
          {error}
        </div>
      )}

      {done ? (
        <div role="status" className="space-y-2 text-sm text-surface-700 dark:text-surface-300">
          <p className="text-base font-semibold text-surface-900 dark:text-surface-100">Import finished</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>{plural(done.registrationsToCreate, 'competitor', 'competitors')} added to this tournament{done.waitlisted > 0 ? ` (${done.waitlisted} on the waiting list)` : ''}</li>
            {done.registrationsUpdated > 0 && <li>{plural(done.registrationsUpdated, 'registration', 'registrations')} got another event</li>}
            {done.skippedCount > 0 && <li>{plural(done.skippedCount, 'row', 'rows')} skipped</li>}
          </ul>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="space-y-3 text-sm text-surface-600 dark:text-surface-400">
            <p>
              One row per competitor. Put <strong>Y</strong> (or Yes, X, 1) in the <strong>{eventLabels.patterns}</strong> and/or{' '}
              <strong>{eventLabels.sparring}</strong> column for each event they enter.
            </p>
            <p>People already in your competitor list are matched by name and date of birth. Their saved details are not changed.</p>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <label className="inline-flex">
                <span className="sr-only">Choose a spreadsheet to import</span>
                <input
                  type="file"
                  accept=".xlsx,.xlsm,.xls,.csv"
                  onChange={handleFile}
                  disabled={busy}
                  className="block w-full text-sm text-surface-700 dark:text-surface-300 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-700 dark:file:bg-primary-900/30 dark:file:text-primary-300"
                />
              </label>
              <a href="/api/competitors/template" className="inline-flex items-center text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400">
                <Download className="h-4 w-4 mr-1" aria-hidden="true" />
                Download the template
              </a>
            </div>
            {file && <p className="text-xs">File: {file.name}{busy ? ' (checking...)' : ''}</p>}
          </div>

          {preview && (
            <>
              {preview.missing.length > 0 && (
                <div role="alert" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-surface-800 dark:border-warning/50 dark:bg-warning/20 dark:text-surface-100">
                  We could not find these columns: {preview.missing.join(', ')}. Pick them below.
                </div>
              )}

              {summary && (
                <section aria-label="What will happen" className="rounded-lg border border-surface-200 dark:border-surface-700 p-4 text-sm text-surface-700 dark:text-surface-300">
                  <h3 className="font-semibold text-surface-900 dark:text-surface-100 mb-2">What will happen</h3>
                  <ul className="space-y-1">
                    <li>
                      <strong>{plural(summary.registrationsToCreate, 'competitor', 'competitors')}</strong> will be added to this tournament
                      {summary.waitlisted > 0 && ` (${summary.waitlisted} on the waiting list, because the tournament is full)`}
                    </li>
                    <li>{plural(summary.newCompetitors, 'is new', 'are new')} to your competitor list</li>
                    <li>{plural(summary.matchedCompetitors, 'is', 'are')} already in your list</li>
                    {summary.registrationsUpdated > 0 && (
                      <li>{plural(summary.registrationsUpdated, 'already registered competitor gets', 'already registered competitors get')} another event</li>
                    )}
                    <li>
                      {eventLabels.patterns}: {summary.events.patterns} · {eventLabels.sparring}: {summary.events.sparring}
                    </li>
                  </ul>
                  {summary.planLimit && (
                    <p role="alert" className="mt-3 text-danger">
                      Your plan allows {summary.planLimit.limit} competitors per tournament. You have {summary.planLimit.current} and this file
                      would add {summary.planLimit.requested}. Remove some rows or upgrade your plan.
                    </p>
                  )}
                  {summary.skippedCount > 0 && (
                    <details className="mt-3">
                      <summary className="cursor-pointer font-medium">{plural(summary.skippedCount, 'row', 'rows')} will be skipped</summary>
                      <ul className="mt-2 max-h-48 overflow-y-auto space-y-1 text-xs">
                        {summary.skipped.map((s) => (
                          <li key={`${s.row}-${s.reason}`}>Row {s.row}{s.name ? ` (${s.name})` : ''}: {s.reason}</li>
                        ))}
                        {summary.skippedCount > summary.skipped.length && (
                          <li>...and {summary.skippedCount - summary.skipped.length} more</li>
                        )}
                      </ul>
                    </details>
                  )}
                  {toImport === 0 && !summary.planLimit && (
                    <p className="mt-3">Nothing to import. Check that the event columns have Y in them.</p>
                  )}
                </section>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {columnSelect('patterns', `${eventLabels.patterns} column`)}
                {columnSelect('sparring', `${eventLabels.sparring} column`)}
              </div>
              <details open={preview.missing.length > 0}>
                <summary className="cursor-pointer text-sm font-medium text-surface-700 dark:text-surface-300">Check the other columns</summary>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {OTHER_COLUMNS.map(({ key, label }) => columnSelect(key, label))}
                </div>
              </details>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
