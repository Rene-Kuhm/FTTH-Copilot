import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateAndIssueLdapSession } from '@/lib/auth/ldap-login';

export const runtime = 'nodejs';

const ldapLoginSchema = z.object({
  username: z.string().min(1).max(254),
  password: z.string().min(1).max(128),
  code: z.string().min(6).max(8).optional(),
});

export async function POST(req: Request): Promise<Response> {
  if (process.env['LDAP_ENABLED'] !== 'true') {
    return NextResponse.json(
      { error: 'LDAP authentication is not enabled' },
      { status: 404 },
    );
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ldapLoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  return authenticateAndIssueLdapSession({
    req,
    username: parsed.data.username,
    password: parsed.data.password,
    code: parsed.data.code,
  });
}
