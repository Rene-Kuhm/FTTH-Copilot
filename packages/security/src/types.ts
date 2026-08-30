import type { EventCategory } from './classify';

/** A security event, in the shape the SOC detectors consume. */
export interface SecurityEvent {
  /** Occurred-at timestamp in epoch milliseconds. */
  t: number;
  category: EventCategory;
  sourceIp: string | null;
  message: string;
}

export type SecurityFindingKind =
  | 'brute_force'
  | 'access_after_failures'
  | 'config_change';

export interface SecurityFinding {
  id: string;
  kind: SecurityFindingKind;
  severity: 'warning' | 'critical';
  sourceIp: string | null;
  title: string;
  description: string;
  detectedAt: string;
}
