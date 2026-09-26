import { Router } from 'express';
import type { Request, Response } from 'express-serve-static-core';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireRole, type AuthenticatedRequest } from '../middleware/auth.js';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { existsSync } from 'fs';
import { decodeStrictBase64, sniffRasterImageType, SAFE_RASTER_EXTENSIONS } from '../utils/image-sniff.js';

const router = Router();

// Logo storage configuration
const LOGO_STORAGE_PATH = '/opt/cursor/logos';
// Raster formats only. SVG is refused: it is an active document that can
// run script / navigate when opened directly from /logos on the app
// origin. The stored type is always the one sniffed from the bytes.
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
const UNSUPPORTED_IMAGE_ERROR = 'Unsupported image type. Upload a PNG, JPEG, GIF, or WebP logo (SVG is not accepted).';
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

/**
 * Headers for files served from /logos. Logos are inert raster images:
 * a locked-down, sandboxed CSP means a legacy SVG uploaded before SVG
 * was rejected cannot run script or navigate on the app origin when
 * opened directly.
 */
export const LOGO_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
};

export function setLogoResponseHeaders(res: { setHeader(name: string, value: string): unknown }): void {
  for (const [name, value] of Object.entries(LOGO_RESPONSE_HEADERS)) {
    res.setHeader(name, value);
  }
}

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
 * Body: { data: string, mimeType?: string }
 * The stored format is determined from the decoded bytes (PNG, JPEG,
 * GIF, WebP only); SVG and anything without a raster signature is 415.
 */
router.post('/:orgId/logo-base64', authenticate, requireRole('admin', 'director'), async (req: AuthenticatedRequest, res: Response) => {
  const prisma: PrismaClient = req.app.locals.prisma;
  const { orgId } = req.params;
  const { data, mimeType } = req.body;

  try {
    // Validation
    if (!data || typeof data !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid base64 data field' });
    }
    // The declared type is advisory only; an explicitly unsupported one
    // (e.g. image/svg+xml) is refused up front.
    if (mimeType !== undefined && (typeof mimeType !== 'string' || !ALLOWED_MIME_TYPES.includes(mimeType.toLowerCase()))) {
      return res.status(415).json({ error: UNSUPPORTED_IMAGE_ERROR });
    }

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

    // Decode base64 data (optionally wrapped in a data: URL, whose
    // declared type is ignored like the mimeType field).
    const matches = data.match(/^data:([A-Za-z0-9.+/-]+);base64,(.+)$/s);
    const buffer = decodeStrictBase64(matches ? matches[2] : data);
    if (!buffer) {
      return res.status(400).json({ error: 'Logo data must be valid base64' });
    }

    // Check file size
    if (buffer.length > MAX_FILE_SIZE) {
      return res.status(413).json({
        error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      });
    }

    // Identify the real format from the magic bytes. SVG/HTML/XML and
    // any mislabelled payload have no raster signature and are refused.
    const sniffedType = sniffRasterImageType(buffer);
    if (!sniffedType) {
      return res.status(415).json({ error: UNSUPPORTED_IMAGE_ERROR });
    }

    // Generate unique filename; the extension comes from the sniffed type
    // so express.static serves it with a matching raster Content-Type.
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const ext = SAFE_RASTER_EXTENSIONS[sniffedType];
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
