import { handleMe } from '@/lib/auth/server';
export const runtime = 'nodejs';
export async function GET(req: Request): Promise<Response> {
  return handleMe(req);
}
