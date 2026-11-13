import { isOidcEnabled } from '@/lib/auth/oidc';
import { LoginPageClient } from '@/components/LoginPageClient';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawError = params['error'];
  const oidcError = typeof rawError === 'string' ? rawError : null;
  const rawMfa = params['mfa'];
  const rawTempToken = params['tempToken'];
  const mfaTempToken =
    rawMfa === 'required' && typeof rawTempToken === 'string' ? rawTempToken : null;

  return (
    <LoginPageClient
      oidcEnabled={isOidcEnabled()}
      initialOidcError={oidcError}
      initialMfaTempToken={mfaTempToken}
    />
  );
}
