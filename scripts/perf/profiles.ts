export interface Phase {
  name: string;
  seconds: number;
  perSecond: number;
  p95Ms: number;
  p99Ms: number;
  maxErrorRate: number;
}

const api = (name: string, seconds: number, perSecond: number, p95Ms: number, p99Ms: number): Phase =>
  ({ name, seconds, perSecond, p95Ms, p99Ms, maxErrorRate: 0.01 });
const ingest = (name: string, seconds: number, perSecond: number, p95Ms: number, p99Ms: number): Phase =>
  ({ name, seconds, perSecond, p95Ms, p99Ms, maxErrorRate: 0 });

export const profiles = {
  api: {
    performance: [api('baseline', 100, 4, 150, 300)],
    load: [api('normal', 60, 8, 200, 400), api('high', 45, 24, 300, 600)],
    spike: [api('before', 50, 8, 200, 400), api('peak', 10, 64, 600, 1_200), api('recovery', 50, 8, 200, 400)],
  },
  ingest: {
    performance: [ingest('baseline', 10, 25, 150, 300)],
    load: [ingest('normal', 15, 100, 200, 400), ingest('high', 15, 300, 300, 600)],
    spike: [ingest('before', 10, 100, 200, 400), ingest('peak', 5, 800, 600, 1_200), ingest('recovery', 10, 100, 200, 400)],
  },
};
