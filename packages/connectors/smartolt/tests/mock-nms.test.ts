import { describe, expect, it } from 'vitest';
import { smartoltMockResponse } from '../src/mock-nms';

describe('smartoltMockResponse', () => {
  it('returns the get_olts response shape', () => {
    const res = smartoltMockResponse('/api/system/get_olts');
    expect(res.status).toBe(200);
    const body = res.body as { status: boolean; response: Array<{ id: string }> };
    expect(body.status).toBe(true);
    expect(body.response[0]?.id).toBe('OLT-MOCK-1');
  });

  it('returns the get_all_onus_details response shape', () => {
    const res = smartoltMockResponse('/api/onu/get_all_onus_details');
    expect(res.status).toBe(200);
    const body = res.body as { status: boolean; onus: Array<{ unique_external_id: string }> };
    expect(body.status).toBe(true);
    expect(body.onus[0]?.unique_external_id).toBe('ONU-MOCK-1');
  });

  it('returns 404 for unknown paths', () => {
    expect(smartoltMockResponse('/api/unknown').status).toBe(404);
  });
});
