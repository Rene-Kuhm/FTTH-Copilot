import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ROLE_MAP_ENTRIES,
  mapGroupsToRole,
  parseRoleMap,
} from '../src/auth-roles';

describe('auth-roles', () => {
  describe('parseRoleMap', () => {
    it('parses comma-separated group:ROLE entries case-insensitively', () => {
      const map = parseRoleMap('CN=NOC-Owners:OWNER, noc-admins : admin , ops:OPERATOR');
      expect(map.get('cn=noc-owners')).toBe('OWNER');
      expect(map.get('noc-admins')).toBe('ADMIN');
      expect(map.get('ops')).toBe('OPERATOR');
      expect(map.size).toBe(3);
    });

    it('falls back to default entries when input is undefined or blank', () => {
      const fromUndefined = parseRoleMap(undefined);
      const fromBlank = parseRoleMap('   ');
      expect(fromUndefined.get('cn=noc-admins')).toBe('ADMIN');
      expect(fromUndefined.get('cn=noc-ops')).toBe('OPERATOR');
      expect(fromUndefined.get('cn=noc-members')).toBe('MEMBER');
      expect(fromBlank.size).toBe(DEFAULT_ROLE_MAP_ENTRIES.length);
    });

    it('ignores malformed entries and invalid roles', () => {
      const map = parseRoleMap('badentry, :ADMIN, group:SUPERUSER, valid:OPERATOR', []);
      expect(map.size).toBe(1);
      expect(map.get('valid')).toBe('OPERATOR');
    });

    it('preserves colons inside group names or URNs', () => {
      const map = parseRoleMap('urn:ftth:admins:ADMIN', []);
      expect(map.get('urn:ftth:admins')).toBe('ADMIN');
    });
  });

  describe('mapGroupsToRole', () => {
    it('picks the highest-privilege role when a user belongs to multiple groups', () => {
      const map = parseRoleMap('members:MEMBER,ops:OPERATOR,admins:ADMIN,owners:OWNER', []);
      expect(mapGroupsToRole(['members', 'admins', 'ops'], map)).toBe('ADMIN');
      expect(mapGroupsToRole(['ops', 'owners'], map)).toBe('OWNER');
    });

    it('matches groups case-insensitively and trims whitespace', () => {
      const map = parseRoleMap('CN=NOC-Admins:ADMIN', []);
      expect(mapGroupsToRole(['  cn=noc-admins  '], map)).toBe('ADMIN');
    });

    it('falls back to defaultRole when no group matches', () => {
      const map = parseRoleMap('admins:ADMIN', []);
      expect(mapGroupsToRole(['other-group'], map)).toBe('MEMBER');
      expect(mapGroupsToRole([], map, 'OPERATOR')).toBe('OPERATOR');
    });
  });
});
