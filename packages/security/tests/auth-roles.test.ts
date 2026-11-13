import { describe, it, expect } from 'vitest';
import { mapGroupsToRole, parseRoleMap } from '../src/auth-roles';

describe('auth-roles', () => {
  it('parses default role map when input is omitted or empty', () => {
    const map = parseRoleMap();
    expect(map.get('cn=noc-admins')).toBe('ADMIN');
    expect(map.get('cn=noc-ops')).toBe('OPERATOR');
    expect(map.get('cn=noc-members')).toBe('MEMBER');
  });

  it('ignores malformed entries and invalid roles', () => {
    const map = parseRoleMap('CN=Owners:OWNER,badentry,CN=Fake:SUPERUSER,CN=Ops:operator');
    expect(map.get('cn=owners')).toBe('OWNER');
    expect(map.get('cn=ops')).toBe('OPERATOR');
    expect(map.has('cn=fake')).toBe(false);
    expect(map.size).toBe(2);
  });

  it('picks the highest privilege role when a user belongs to multiple groups', () => {
    const map = parseRoleMap('CN=NOC-Members:MEMBER,CN=NOC-Ops:OPERATOR,CN=NOC-Admins:ADMIN,CN=Owners:OWNER');
    expect(mapGroupsToRole(['CN=NOC-Members', 'CN=NOC-Admins'], map)).toBe('ADMIN');
    expect(mapGroupsToRole(['CN=NOC-Ops', 'CN=Owners'], map)).toBe('OWNER');
  });

  it('falls back to MEMBER when no group matches', () => {
    const map = parseRoleMap('CN=NOC-Admins:ADMIN');
    expect(mapGroupsToRole(['CN=Unrelated'], map)).toBe('MEMBER');
  });
});
