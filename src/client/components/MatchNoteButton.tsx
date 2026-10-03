// Scorekeeper "Note" badge: a competitor in the match being scored has a
// special-needs note. Tapping it shows the note right below. The notes come
// from GET /api/brackets/match/:matchId/special-needs (scorekeeper+ only),
// never from public data. Sits outside the winner-select card so it is not
// a button inside a button.
import { useId, useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';

export default function MatchNoteButton({ name, note }: { name: string; note: string }) {
  const [open, setOpen] = useState(false);
  const noteId = useId();

  return (
    <div className="mt-2" data-testid="match-special-needs">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={noteId}
        className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-200 text-sm font-semibold hover:bg-amber-500/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
      >
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        Note<span className="sr-only"> for {name}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      <p
        id={noteId}
        hidden={!open}
        className="mt-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-100 break-words"
      >
        {note}
      </p>
    </div>
  );
}
