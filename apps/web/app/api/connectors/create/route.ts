import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSafeNmsBaseUrl, UnsafeNmsUrlError } from '@ftth-copilot/connectors-core';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import { createConnector } from '@/lib/connectors/server';

export const runtime = 'nodejs';

const schema = z.object({
  provider: z.enum(['SMARTOLT', 'MIKROWISP', 'NETSENSE']),
  label: z.string().trim().min(1).max(80),
  apiKey: z.string().trim().min(1).max(500),
  baseUrl: z.string().url(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'manage_connectors')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { provider, label, apiKey } = parsed.data;
  if (provider === 'NETSENSE') {
    return NextResponse.json(
      { error: 'NetSense todavía no está implementado.' },
      { status: 422 },
    );
  }

  let baseUrl: string;
  try {
    baseUrl = await assertSafeNmsBaseUrl(parsed.data.baseUrl);
  } catch (error) {
    if (error instanceof UnsafeNmsUrlError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const result = await createConnector({ provider, label, apiKey, baseUrl });
  if (!result) {
    return NextResponse.json({ error: 'Not authenticated or not authorized' }, { status: 403 });
  }
  return NextResponse.json({ connector: result }, { status: 201 });
}
