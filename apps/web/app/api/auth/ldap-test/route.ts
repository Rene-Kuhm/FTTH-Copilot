/**
 * LDAP Diagnostic Endpoint
 *
 * GET /api/auth/ldap-test
 *
 * Runs a connectivity check against the LDAP/AD server using the configured
 * service account. Does NOT authenticate a user — use /api/auth/login with
 * LDAP credentials for actual authentication.
 *
 * Requires admin role.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/server';
import { diagnoseLdap } from '@ftth-copilot/soc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Only OWNER or ADMIN can run diagnostics
  if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const result = await diagnoseLdap();
  return NextResponse.json(result);
}
