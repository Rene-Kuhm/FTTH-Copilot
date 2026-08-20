import { handleSignup } from '@/lib/auth/server';
export const runtime = 'nodejs';
export async function POST(req: Request): Promise<Response> {
  return handleSignup(req);
}
