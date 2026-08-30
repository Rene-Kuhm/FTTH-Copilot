#!/usr/bin/env tsx
/**
 * Mock NMS HTTP server: serves SmartOLT- and Mikrowisp-shaped responses
 * locally so the live connectors (SmartOltClient / MikrowispClient) can run
 * without a real NMS.
 *
 *   pnpm test:mock-nms          # listens on :5515
 *   MOCK_NMS_PORT=5516 pnpm test:mock-nms
 *
 * Then configure an NmsConnection with baseUrl:
 *   SmartOLT:  http://127.0.0.1:5515/smartolt
 *   Mikrowisp: http://127.0.0.1:5515/mikrowisp
 *
 * Requests are routed by URL prefix:
 *   /smartolt/...  → SmartOLT shapes (get_olts, get_all_onus_details, ...)
 *   /mikrowisp/... → Mikrowisp shapes (GetRouters, GetMonitoreo, ...)
 */
import http from 'node:http';
import { smartoltMockResponse } from '@ftth-copilot/connectors-smartolt';
import { mikrowispMockResponse } from '@ftth-copilot/connectors-mikrowisp';

const PORT = Number.parseInt(process.env['MOCK_NMS_PORT'] ?? '5515', 10);

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';
  const path = url.split('?')[0]!;

  let mockResponse;
  let strippedPath;
  if (path.startsWith('/smartolt/')) {
    strippedPath = '/' + path.slice('/smartolt/'.length);
    mockResponse = smartoltMockResponse(strippedPath);
  } else if (path.startsWith('/mikrowisp/')) {
    strippedPath = '/' + path.slice('/mikrowisp/'.length);
    mockResponse = mikrowispMockResponse(strippedPath);
  } else {
    mockResponse = { status: 404, body: { error: 'unknown provider; prefix with /smartolt/ or /mikrowisp/' } };
    strippedPath = path;
  }

  res.writeHead(mockResponse.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(mockResponse.body));
  console.log(`<-- ${req.method} ${path}  ->  ${mockResponse.status}`);
});

server.listen(PORT, () => {
  console.log(`Mock NMS listening on http://0.0.0.0:${PORT}`);
  console.log('  SmartOLT:  GET/POST /smartolt/api/system/get_olts');
  console.log('             GET/POST /smartolt/api/onu/get_all_onus_details');
  console.log('  Mikrowisp: POST /mikrowisp/GetRouters  (token in JSON body)');
  console.log('             POST /mikrowisp/GetMonitoreo');
});
