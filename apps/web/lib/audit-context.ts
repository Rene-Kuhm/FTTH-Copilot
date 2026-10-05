/**
 * Build an AuditContext from a Next.js Request + authenticated user.
 * Extracts IP from x-forwarded-for or connection info, and user-agent.
 */
import type { NextRequest } from 'next/server';
import type { AuditContext } from '@ftth-copilot/soc';

export function buildAuditContext(
  req: NextRequest,
  user: { id: string; email: string; role: string; tenantId: string },
): AuditContext {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0]!.trim() : req.headers.get('x-real-ip') ?? 'unknown';
  const userAgent = req.headers.get('user-agent') ?? undefined;

  return {
    tenantId: user.tenantId,
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    ipAddress: ip,
    userAgent,
  };
}
