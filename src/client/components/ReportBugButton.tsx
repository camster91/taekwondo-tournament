// "Report a bug" button for the top bar. Opens a short form; the report is
// saved as a support ticket (source "bug-report") with the current page and
// browser filled in automatically, so it can be sorted later on the
// Support Tickets page.
import { useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { Bug } from 'lucide-react';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button, Input, Label, Modal, Select, Textarea } from './ui';

type Severity = 'low' | 'normal' | 'high';

const emptyForm = { title: '', whatHappened: '', expected: '', severity: 'normal' as Severity };

export default function ReportBugButton() {
  const location = useLocation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (sending) return;
    setOpen(false);
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/support/bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          title: form.title,
          whatHappened: form.whatHappened,
          expected: form.expected || null,
          severity: form.severity,
          page: `${location.pathname}${location.search}`.slice(0, 255),
          browser: navigator.userAgent.slice(0, 300),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || 'The report could not be sent. Please try again.');
      }
      setForm(emptyForm);
      setOpen(false);
      toast.success('Thanks! Your bug report was sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The report could not be sent. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="p-2 text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white rounded-md hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
        aria-label="Report a bug"
        title="Report a bug"
      >
        <Bug className="h-4 w-4" />
      </button>

      {open && (
        <Modal
          isOpen={open}
          onClose={close}
          title="Report a bug"
          subtitle="Tell us what went wrong. We include this page's address automatically."
          footer={
            <>
              <Button variant="secondary" type="button" onClick={close} disabled={sending} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                form="report-bug-form"
                loading={sending}
                disabled={sending || form.title.trim().length < 3 || form.whatHappened.trim().length < 5}
                className="w-full sm:w-auto"
              >
                Send report
              </Button>
            </>
          }
        >
          <form id="report-bug-form" onSubmit={submit} className="space-y-4">
            {error && (
              <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <div>
              <Label htmlFor="bug-title">Short title</Label>
              <Input
                id="bug-title"
                value={form.title}
                maxLength={120}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Bracket PDF has no names"
                required
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="bug-what">What happened?</Label>
              <Textarea
                id="bug-what"
                value={form.whatHappened}
                maxLength={2000}
                rows={4}
                onChange={(e) => setForm({ ...form, whatHappened: e.target.value })}
                placeholder="What did you click, and what went wrong?"
                required
              />
            </div>
            <div>
              <Label htmlFor="bug-expected">What did you expect? (optional)</Label>
              <Textarea
                id="bug-expected"
                value={form.expected}
                maxLength={1000}
                rows={2}
                onChange={(e) => setForm({ ...form, expected: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="bug-severity">How bad is it?</Label>
              <Select
                id="bug-severity"
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })}
              >
                <option value="low">Small annoyance</option>
                <option value="normal">Gets in the way</option>
                <option value="high">Stops me from working</option>
              </Select>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
