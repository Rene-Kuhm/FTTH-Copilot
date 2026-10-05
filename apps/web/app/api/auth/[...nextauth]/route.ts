/**
 * NextAuth route handler (stub)
 *
 * To enable NextAuth with OIDC:
 * 1. Install: pnpm add next-auth
 * 2. Set environment variables:
 *    - NEXTAUTH_URL=https://your-domain.com/api/auth
 *    - NEXTAUTH_SECRET=<random-secret>
 *    - NEXTAUTH_OIDC_ISSUER=https://your-idp.com
 *    - NEXTAUTH_OIDC_CLIENT_ID=<client-id>
 *    - NEXTAUTH_OIDC_CLIENT_SECRET=<client-secret>
 *
 * Then uncomment the actual implementation below.
 *
 * For now, use the existing /api/auth/login endpoint.
 */
import { NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    error: 'NextAuth not configured',
    message: 'Use POST /api/auth/login for authentication',
    instructions: 'To enable SSO/OIDC, install next-auth and configure environment variables.',
  }, { status: 501 });
}

export async function POST(): Promise<NextResponse> {
  return NextResponse.json({
    error: 'NextAuth not configured',
    message: 'Use POST /api/auth/login for authentication',
    instructions: 'To enable SSO/OIDC, install next-auth and configure environment variables.',
  }, { status: 501 });
}

/*
// Uncomment when next-auth is installed:
//
// import NextAuth from 'next-auth';
// import CredentialsProvider from 'next-auth/providers/credentials';
// import { prisma, verifyPassword, issueToken } from '@ftth-copilot/db';
//
// const handler = NextAuth({
//   providers: [
//     CredentialsProvider({
//       name: 'Credentials',
//       credentials: {
//         email: { label: 'Email', type: 'email' },
//         password: { label: 'Password', type: 'password' },
//       },
//       async authorize(credentials) {
//         if (!credentials?.email || !credentials?.password) return null;
//         const user = await prisma.user.findUnique({
//           where: { email: credentials.email },
//         });
//         if (!user) return null;
//         const ok = await verifyPassword(credentials.password, user.passwordHash);
//         if (!ok) return null;
//         return { id: user.id, email: user.email, name: user.name, role: user.role };
//       },
//     }),
//   ],
//   callbacks: {
//     async jwt({ token, user }) {
//       if (user) {
//         token.id = user.id;
//         token.role = user.role;
//         token.tenantId = (user as { tenantId?: string }).tenantId;
//       }
//       return token;
//     },
//     async session({ session, token }) {
//       if (session.user) {
//         (session.user as { id?: string }).id = token.id as string;
//         (session.user as { role?: string }).role = token.role as string;
//         (session.user as { tenantId?: string }).tenantId = token.tenantId as string;
//       }
//       return session;
//     },
//   },
//   session: { strategy: 'jwt' },
//   secret: process.env['NEXTAUTH_SECRET'] ?? 'dev-secret-change-in-production',
// });
//
// export { handler as GET, handler as POST };
*/
