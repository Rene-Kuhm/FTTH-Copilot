import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * Tests for `POST /api/users` (security audit issue #5).
 *
 *  1. The schema enforces email uniqueness *globally* while the route only
 *     pre-checks it within the tenant. A collision with a user of another
 *     tenant therefore surfaces as a Prisma P2002 on `user.create`; it must
 *     be translated into a 409 with a clean body, not an unhandled 500.
 *  2. The existing per-tenant pre-check must keep answering 409 with its own
 *     message and must not reach the database write.
 *  3. Any other error keeps propagating untouched.
 */

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  userFindFirst: vi.fn(),
  userCreate: vi.fn(),
  hashPassword: vi.fn(),
  auditUserCreated: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/auth/permissions', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    user: {
      findFirst: mocks.userFindFirst,
      create: mocks.userCreate,
    },
  },
  hashPassword: mocks.hashPassword,
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, code: string) {
        super(message);
        this.code = code;
      }
    },
  },
}));

vi.mock('@ftth-copilot/soc', () => ({
  auditUser: { created: mocks.auditUserCreated },
}));

const { POST } = await import('@/app/api/users/route');

const fakeUser = {
  id: 'user-1',
  email: 'owner@isp.example',
  role: 'OWNER',
  tenantId: 'tenant-1',
  tenant: 'ISP Corp',
};

const BODY = {
  email: 'new@isp.example',
  password: 'super-secret-1',
  name: 'New Operator',
  role: 'OPERATOR',
};

function request(payload: unknown = BODY): NextRequest {
  return new Request('http://localhost/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    body: JSON.stringify(payload),
  }) as unknown as NextRequest;
}

/** Build the P2002 the database raises when the email already exists. */
async function uniqueViolation(): Promise<Error> {
  const { Prisma } = await import('@ftth-copilot/db');
  const Ctor = (
    Prisma as unknown as {
      PrismaClientKnownRequestError: new (message: string, code: string) => Error;
    }
  ).PrismaClientKnownRequestError;
  return new Ctor('Unique constraint failed on the fields: (`email`)', 'P2002');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(fakeUser);
  mocks.hasPermission.mockReturnValue(true);
  mocks.hashPassword.mockResolvedValue('hashed:super-secret-1');
  mocks.auditUserCreated.mockResolvedValue(undefined);
  mocks.userFindFirst.mockResolvedValue(null);
});

describe('POST /api/users', () => {
  it('returns 409 when the email already exists in a different tenant', async () => {
    // No row in this tenant: the per-tenant pre-check passes.
    mocks.userFindFirst.mockResolvedValue(null);
    // The global unique constraint on `email` still rejects the insert.
    mocks.userCreate.mockRejectedValue(await uniqueViolation());

    const res = await POST(request());

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'Email already in use' });
    expect(mocks.userCreate).toHaveBeenCalledTimes(1);
    // Rejected create means no user landed: the audit log must not run.
    expect(mocks.auditUserCreated).not.toHaveBeenCalled();
  });

  it('returns 409 without writing when the email exists in this tenant', async () => {
    mocks.userFindFirst.mockResolvedValue({ id: 'user-9', email: BODY.email });
    mocks.userCreate.mockResolvedValue({ id: 'never' });

    const res = await POST(request());

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'Email already in use in this tenant',
    });
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it('propagates non-P2002 database errors untouched', async () => {
    mocks.userFindFirst.mockResolvedValue(null);
    mocks.userCreate.mockRejectedValue(new Error('database is on fire'));

    await expect(POST(request())).rejects.toThrow('database is on fire');
  });

  it('still creates the user and returns 201 on a free email', async () => {
    mocks.userFindFirst.mockResolvedValue(null);
    const created = {
      id: 'user-2',
      email: BODY.email,
      name: BODY.name,
      role: BODY.role,
      createdAt: new Date('2026-10-17T10:00:00Z'),
    };
    mocks.userCreate.mockResolvedValue(created);

    const res = await POST(request());

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ user: { id: 'user-2' } });
    expect(mocks.auditUserCreated).toHaveBeenCalledWith(expect.anything(), 'user-2');
  });
});
