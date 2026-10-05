/**
 * GET  /api/fiber-plans       — list all plans for the current tenant
 * POST /api/fiber-plans       — upload a new fiber plan
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
]);

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

const createSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(1000).optional(),
  connectionId: z.string().cuid().optional(),
});

/** GET /api/fiber-plans */
export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const plans = await prisma.fiberPlan.findMany({
    where: { tenantId: user.tenantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      fileUrl: true,
      mimeType: true,
      widthPx: true,
      heightPx: true,
      fileSizeBytes: true,
      connectionId: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { zones: true } },
    },
  });

  return NextResponse.json({
    plans: plans.map((p) => ({
      ...p,
      zoneCount: p._count.zones,
      _count: undefined,
    })),
    count: plans.length,
  });
}

/** POST /api/fiber-plans — multipart form-data upload */
export async function POST(req: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Failed to parse form data' }, { status: 400 });
  }

  const name = formData.get('name') as string | null;
  const description = formData.get('description') as string | null;
  const connectionId = formData.get('connectionId') as string | null;
  const file = formData.get('file') as File | null;
  const widthPxRaw = formData.get('widthPx');
  const heightPxRaw = formData.get('heightPx');

  // Validate required fields
  if (!name || name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}. Allowed: PNG, JPEG, GIF, WebP, SVG, PDF` },
      { status: 400 },
    );
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB` },
      { status: 400 },
    );
  }

  // Optional connectionId validation
  if (connectionId) {
    const connection = await prisma.nmsConnection.findFirst({
      where: { id: connectionId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!connection) {
      return NextResponse.json({ error: 'connectionId not found' }, { status: 400 });
    }
  }

  // Save file to disk
  const ext = (file.name.split('.').pop() ?? '').replace(/[^a-zA-Z0-9]/g, '');
  const storedFilename = `${randomUUID()}.${ext}`;
  const uploadDir = join(process.cwd(), 'public', 'uploads', 'fiber-plans');

  try {
    await mkdir(uploadDir, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(join(uploadDir, storedFilename), buffer);
  } catch (err) {
    console.error('[fiber-plans] Failed to write file:', err);
    return NextResponse.json({ error: 'Failed to save file' }, { status: 500 });
  }

  const widthPx = widthPxRaw ? parseInt(String(widthPxRaw), 10) : null;
  const heightPx = heightPxRaw ? parseInt(String(heightPxRaw), 10) : null;

  const plan = await prisma.fiberPlan.create({
    data: {
      tenantId: user.tenantId,
      connectionId: connectionId || null,
      name: name.trim(),
      description: description?.trim() || null,
      fileUrl: `/uploads/fiber-plans/${storedFilename}`,
      mimeType: file.type,
      widthPx: isNaN(widthPx as number) ? null : widthPx,
      heightPx: isNaN(heightPx as number) ? null : heightPx,
      fileSizeBytes: BigInt(file.size),
    },
    select: {
      id: true,
      name: true,
      description: true,
      fileUrl: true,
      mimeType: true,
      widthPx: true,
      heightPx: true,
      fileSizeBytes: true,
      connectionId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(
    {
      plan: {
        ...plan,
        fileSizeBytes: plan.fileSizeBytes?.toString(),
      },
    },
    { status: 201 },
  );
}
