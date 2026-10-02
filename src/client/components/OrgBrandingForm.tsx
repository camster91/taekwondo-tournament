// Organization name + colour shown to parents on public pages and emails.
// The logo upload lives next to this in OrganizationSettings.
import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthHeaders } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button, Input, Label } from './ui';

const DEFAULT_COLOR = '#DC2626';
const HEX = /^#[0-9A-Fa-f]{6}$/;

/** WCAG contrast ratio of white text on this colour. */
export function whiteTextContrast(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (luminance + 0.05);
}

interface Props {
  organizationId: string;
  organizationName: string;
  brandName: string | null | undefined;
  brandPrimaryColor: string | null | undefined;
  brandLogoUrl: string | null | undefined;
  canEdit: boolean;
}

export default function OrgBrandingForm({ organizationId, organizationName, brandName, brandPrimaryColor, brandLogoUrl, canEdit }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(brandName ?? '');
  const [color, setColor] = useState(brandPrimaryColor || DEFAULT_COLOR);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(brandName ?? '');
    setColor(brandPrimaryColor || DEFAULT_COLOR);
  }, [brandName, brandPrimaryColor]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/organizations/${organizationId}/branding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ brandName: name.trim() || null, brandPrimaryColor: color }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; details?: { message?: string }[] };
        throw new Error(body.details?.[0]?.message || body.error || 'Could not save branding');
      }
    },
    onMutate: () => setError(null),
    onSuccess: async () => {
      toast.success('Branding saved. Parents will see it on your public pages.');
      await queryClient.invalidateQueries({ queryKey: ['organizations', 'current'] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save branding'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!HEX.test(color)) {
      setError('Pick a colour like #1D4ED8.');
      return;
    }
    save.mutate();
  };

  const shownName = name.trim() || organizationName;
  const previewColor = HEX.test(color) ? color : DEFAULT_COLOR;

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="org-brand-name">Name parents see</Label>
        <Input
          id="org-brand-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={organizationName}
          maxLength={120}
          disabled={!canEdit}
          aria-describedby="org-brand-name-help"
        />
        <p id="org-brand-name-help" className="mt-1 text-xs text-surface-500 dark:text-surface-400">
          Shown on registration pages, the parent portal and emails. Leave blank to use {organizationName}.
        </p>
      </div>
      <div>
        <Label htmlFor="org-brand-color">Brand colour</Label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            aria-label="Pick brand colour"
            value={previewColor}
            onChange={(e) => setColor(e.target.value.toUpperCase())}
            disabled={!canEdit}
            className="h-10 w-14 cursor-pointer rounded border border-surface-200 bg-white p-1 dark:border-surface-700 dark:bg-surface-900"
          />
          <Input
            id="org-brand-color"
            value={color}
            onChange={(e) => setColor(e.target.value.trim())}
            maxLength={7}
            disabled={!canEdit}
            className="max-w-[8rem] font-mono"
          />
        </div>
      </div>

      {HEX.test(color) && whiteTextContrast(color) < 4.5 && (
        <p className="text-sm text-warning">
          This colour is light, so white text on buttons and headers may be hard to read. A darker shade works better.
        </p>
      )}

      <div aria-hidden="true" className="overflow-hidden rounded-lg border border-surface-200 dark:border-surface-700">
        <div className="flex items-center gap-3 px-4 py-3 text-white" style={{ backgroundColor: previewColor }}>
          {brandLogoUrl && <img src={brandLogoUrl} alt="" className="h-8 w-auto rounded bg-white p-0.5" />}
          <span className="font-semibold [overflow-wrap:anywhere]">{shownName}</span>
        </div>
        <div className="bg-white px-4 py-3 text-sm text-surface-700 dark:bg-surface-900 dark:text-surface-200">
          Preview of the header parents see.
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {canEdit ? (
        <Button type="submit" variant="primary" loading={save.isPending} disabled={save.isPending}>Save branding</Button>
      ) : (
        <p className="text-sm text-surface-600 dark:text-surface-300">Your role in this organization can't change branding.</p>
      )}
    </form>
  );
}
