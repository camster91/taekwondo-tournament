type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function fetchAuthenticatedBlob(
  fetcher: Fetcher,
  url: string,
  expectedContentType: string,
  headers: HeadersInit,
): Promise<Blob> {
  const response = await fetcher(url, { headers });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof body?.error === 'string' && body.error.trim()
      ? body.error
      : `Export failed (${response.status})`);
  }
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
  if (contentType !== expectedContentType.toLowerCase()) {
    throw new Error('Export returned an unexpected file type');
  }
  const blob = await response.blob();
  if (blob.size === 0) throw new Error('Export returned an empty file');
  if (expectedContentType.toLowerCase() === 'application/pdf') {
    const signature = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer());
    if (signature !== '%PDF-') throw new Error('Export did not contain a valid PDF');
  }
  if (expectedContentType.toLowerCase() === 'application/json') {
    try {
      JSON.parse(await blob.text());
    } catch {
      throw new Error('Export did not contain valid JSON');
    }
  }
  return blob;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
