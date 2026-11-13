import { handleOidcCallback } from '@/lib/auth/oidc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  return handleOidcCallback(req);
}
