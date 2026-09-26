/**
 * Magic-byte image type detection for user uploads.
 *
 * Upload endpoints must never trust the client's declared MIME type or
 * file extension: a director could label an SVG (which can carry
 * `<script>`, event handlers and `javascript:` links) as `image/png`,
 * or an HTML file as anything at all. Only raster formats with an
 * unambiguous binary signature are accepted; everything else (SVG,
 * XML, HTML, PDF, ICO, BMP, text) is rejected by construction because
 * it has no matching signature here.
 */

export type SafeRasterMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export const SAFE_RASTER_EXTENSIONS: Readonly<Record<SafeRasterMimeType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buffer: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, i) => buffer[offset + i] === byte);
}

function asciiAt(buffer: Uint8Array, offset: number, text: string): boolean {
  return startsWith(buffer, Array.from(text, (c) => c.charCodeAt(0)), offset);
}

/** Returns the detected raster MIME type, or null for anything else. */
export function sniffRasterImageType(buffer: Uint8Array): SafeRasterMimeType | null {
  if (startsWith(buffer, PNG_SIGNATURE)) return 'image/png';
  // JPEG: SOI marker followed by the first segment marker byte.
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (asciiAt(buffer, 0, 'GIF87a') || asciiAt(buffer, 0, 'GIF89a')) return 'image/gif';
  // WebP: RIFF <size:4> WEBP
  if (asciiAt(buffer, 0, 'RIFF') && asciiAt(buffer, 8, 'WEBP')) return 'image/webp';
  return null;
}

/**
 * Strict base64 decode. `Buffer.from(x, 'base64')` silently skips
 * invalid characters, so malformed input would otherwise decode to
 * arbitrary bytes instead of being rejected.
 */
export function decodeStrictBase64(input: string): Buffer | null {
  const compact = input.replace(/\s+/g, '');
  if (compact.length === 0 || compact.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  return Buffer.from(compact, 'base64');
}
