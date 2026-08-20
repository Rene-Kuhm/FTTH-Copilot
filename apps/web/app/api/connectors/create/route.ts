import { createConnector } from '@/lib/connectors/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

const schema = z.object({
  provider: z.enum(['SMARTOLT', 'MIKROWISP', 'NETSENSE']),
  label: z.string().min(1).max(80),
  apiKey: z.string().min(1).max(500),
  baseUrl: z.string().url().optional().nullable(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }
  const result = await createConnector(parsed.data);
  if (!result) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  return NextResponse.json({ connector: result }, { status: 201 });
}
