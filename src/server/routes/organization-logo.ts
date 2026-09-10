import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireRole, type AuthenticatedRequest } from '../middleware/auth.js';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { existsSync } from 'fs';
import { fileTypeFromBuffer } from 'file-type';

const router = Router();

// Logo storage configuration
const LOGO_STORAGE_PATH = '/opt/cursor/logos';
// SH-2: SVG is rejected entirely. SVG can carry <script> event handlers
// and `javascript:` hrefs that fire when the image is rendered, which
// combined with the CSP's `style-src 'unsafe-inline'` allowed stored XSS
// across tenants. Use only raster formats that have unambiguous magic bytes
// and that file-type can validate against the actual buffer.
const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);
// Extension is derived from the *sniffed* MIME, never the client header.
const EXTENSION_BY_MIME: ReadonlyMap<string, string> = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
]);
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

// Ensure logo directory exists
async function ensureLogoDirectory() {
  if (!existsSync(LOGO_STORAGE_PATH)) {
    await fs.mkdir(LOGO_STORAGE_PATH, { recursive: true, mode: 0o755 });
  }
}

/**
 * POST /api/organizations/:orgId/logo - Upload organization logo (P1-11)
 * 
 * Accepts multipart/form-data with a single 'logo' file field.
 * Stores the file on disk and updates Organization.brandLogoUrl.
 */
router.post('/:orgId/logo', authenticate, requireRole('admin', 'director'), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { orgId } = req.params;

  try {
    // Verify organization exists and user has access
    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, slug: true, brandLogoUrl: true },
    });

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // For non-admin users, verify org membership
    if (req.user!.role !== 'admin') {
      const member = await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId: req.user!.id } },
      });
      if (!member) {
        return res.status(403).json({ error: 'You do not have access to this organization' });
      }
    }

    // Parse multipart form data
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Content-Type must be multipart/form-data' });
    }

    // Read the raw body (Express doesn't parse multipart by default)
    // For production, this should use a proper multipart parser like multer
    // For now, return a simple error asking for base64
    return res.status(501).json({
      error: 'Logo upload requires multipart parsing. Use POST /api/organizations/:orgId/logo-base64 instead.',
    });
  } catch (error) {
    console.error('Logo upload error:', error);
    return res.status(500).json({ error: 'Failed to upload logo' });
  }
});

/**
 * POST /api/organizations/:orgId/logo-base64 - Upload organization logo (P1-11, simplified)
 * 
 * Accepts JSON body with base64-encoded image data.
 * Body: { data: string, mimeType: string }
 */
router.post('/:orgId/logo-base64', authenticate, requireRole('admin', 'director'), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { orgId } = req.params;
  const { data } = req.body;

  try {
    // Validation
    if (!data || typeof data !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid base64 data field' });
    }
    // The client-supplied `mimeType` (if any) is intentionally NOT trusted.
    // The actual image type is determined by sniffing the decoded bytes
    // below — see SH-2 fix. Storing a server-controlled value closes the
    // SVG upload vector where a malicious director could push `<script>`
    // and `javascript:` hrefs that fire when the logo renders.

    // Verify organization exists and user has access
    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, slug: true, brandLogoUrl: true },
    });

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // For non-admin users, verify org membership
    if (req.user!.role !== 'admin') {
      const member = await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId: req.user!.id } },
      });
      if (!member) {
        return res.status(403).json({ error: 'You do not have access to this organization' });
      }
    }

    // Decode base64 data
    const matches = data.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    const base64Data = matches ? matches[2] : data;
    const buffer = Buffer.from(base64Data, 'base64');

    // Check file size
    if (buffer.length > MAX_FILE_SIZE) {
      return res.status(413).json({
        error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      });
    }

    // Magic-byte sniff: detect the real MIME from the decoded bytes.
    // Rejects SVG (and any other non-allowlisted type) regardless of what
    // the client claims. file-type returns `undefined` when the buffer
    // is too small or doesn't match a known signature — treat as reject.
    const detected = await fileTypeFromBuffer(new Uint8Array(buffer));
    if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
      return res.status(400).json({
        error: 'Unsupported image type. Allowed: PNG, JPEG, GIF, WebP.',
      });
    }

    // Generate unique filename — extension comes from the *sniffed* MIME,
    // never from the client header.
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const ext = EXTENSION_BY_MIME.get(detected.mime)!;
    const filename = `${organization.slug}-${hash}.${ext}`;

    // Ensure directory exists
    await ensureLogoDirectory();

    // Write file to disk
    const filePath = path.join(LOGO_STORAGE_PATH, filename);
    await fs.writeFile(filePath, buffer);

    // Delete old logo if it exists and is different
    if (organization.brandLogoUrl && organization.brandLogoUrl !== `/logos/${filename}`) {
      const oldFilename = path.basename(organization.brandLogoUrl);
      const oldPath = path.join(LOGO_STORAGE_PATH, oldFilename);
      await fs.unlink(oldPath).catch(() => {
        // Ignore errors if old file doesn't exist
      });
    }

    // Update organization with new logo URL
    const logoUrl = `/logos/${filename}`;
    await prisma.organization.update({
      where: { id: orgId },
      data: { brandLogoUrl: logoUrl },
    });

    res.json({
      logoUrl,
      message: 'Logo uploaded successfully',
    });
  } catch (error) {
    console.error('Logo upload error:', error);
    return res.status(500).json({ error: 'Failed to upload logo' });
  }
});

/**
 * DELETE /api/organizations/:orgId/logo - Remove organization logo (P1-11)
 */
router.delete('/:orgId/logo', authenticate, requireRole('admin', 'director'), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { orgId } = req.params;

  try {
    // Verify organization exists and user has access
    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, brandLogoUrl: true },
    });

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // For non-admin users, verify org membership
    if (req.user!.role !== 'admin') {
      const member = await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId: req.user!.id } },
      });
      if (!member) {
        return res.status(403).json({ error: 'You do not have access to this organization' });
      }
    }

    // Delete logo file if it exists
    if (organization.brandLogoUrl) {
      const filename = path.basename(organization.brandLogoUrl);
      const filePath = path.join(LOGO_STORAGE_PATH, filename);
      await fs.unlink(filePath).catch(() => {
        // Ignore errors if file doesn't exist
      });
    }

    // Clear logo URL in database
    await prisma.organization.update({
      where: { id: orgId },
      data: { brandLogoUrl: null },
    });

    res.json({ message: 'Logo removed successfully' });
  } catch (error) {
    console.error('Logo removal error:', error);
    return res.status(500).json({ error: 'Failed to remove logo' });
  }
});

export default router;
