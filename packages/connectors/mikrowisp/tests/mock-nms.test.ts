import { describe, expect, it } from 'vitest';
import { mikrowispMockResponse } from '../src/mock-nms';

describe('mikrowispMockResponse', () => {
  it('returns the GetRouters response shape', () => {
    const res = mikrowispMockResponse('/GetRouters');
    expect(res.status).toBe(200);
    const body = res.body as { estado: string; routers: Array<{ id: string }> };
    expect(body.estado).toBe('exito');
    expect(body.routers[0]?.id).toBe('RT-MOCK-1');
  });

  it('returns the GetMonitoreo response shape', () => {
    const res = mikrowispMockResponse('/GetMonitoreo');
    expect(res.status).toBe(200);
    const body = res.body as { estado: string; equipos: Array<{ id: string }> };
    expect(body.estado).toBe('exito');
    expect(body.equipos[0]?.id).toBe('EQ-MOCK-1');
  });

  it('returns 404 for unknown paths', () => {
    expect(mikrowispMockResponse('/Unknown').status).toBe(404);
  });
});
