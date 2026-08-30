export interface MockNmsResponse {
  status: number;
  body: unknown;
}

/**
 * Returns the SmartOLT-shaped response for a request path, matching the real
 * API shapes `SmartOltClient.realFetch` consumes (`get_olts` → `{ status, response }`,
 * `get_all_onus_details` → `{ status, onus }`). Lets the live connector run
 * against a local fake NMS with no physical OLTs/ONUs.
 */
export function smartoltMockResponse(path: string): MockNmsResponse {
  if (path.includes('get_olts')) {
    return {
      status: 200,
      body: {
        status: true,
        response: [{ id: 'OLT-MOCK-1', name: 'Mock OLT 1', ip: '10.0.0.1' }],
      },
    };
  }

  if (path.includes('get_all_onus_details')) {
    return {
      status: 200,
      body: {
        status: true,
        onus: [
          {
            unique_external_id: 'ONU-MOCK-1',
            sn: 'SNMOCK0001',
            olt_id: 'OLT-MOCK-1',
            name: 'Cliente Mock',
            status: 'online',
            signal: '-21.5',
            signal_1490: '2.0',
            last_status_change: '2026-08-30T00:00:00Z',
          },
        ],
      },
    };
  }

  return { status: 404, body: { status: false } };
}
