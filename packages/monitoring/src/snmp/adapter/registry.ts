/**
 * Deterministic OLT Adapter Registry (Roadmap Fase 2).
 *
 * Manages registered vendor adapters and resolves them with deterministic priority:
 * 1. Disambiguation check (ambiguous identity falls back to standard adapter).
 * 2. Exact vendor ID match with supports() verification.
 * 3. IANA PEN match with supports() verification.
 * 4. Standard baseline adapter fallback.
 */

import type { ResolvedDeviceIdentity } from '../identity';
import type { DecodedSnmpNotification } from '../types';
import type { OltVendorAdapter } from './contract';
import { StandardOltAdapter } from './standard';
import { HuaweiOltAdapter } from './huawei';
import { ZteOltAdapter } from './zte';
import { NokiaOltAdapter } from './nokia';
import { FiberhomeOltAdapter } from './fiberhome';

export class OltAdapterRegistry {
  private readonly adapters = new Map<string, OltVendorAdapter>();
  private readonly standardAdapter = new StandardOltAdapter();

  constructor() {
    this.register(this.standardAdapter);
  }

  /**
   * Registers a vendor adapter.
   */
  register(adapter: OltVendorAdapter): void {
    this.adapters.set(adapter.vendorId.toLowerCase(), adapter);
  }

  /**
   * Retrieves an adapter by vendor ID.
   */
  getAdapter(vendorId: string): OltVendorAdapter | undefined {
    return this.adapters.get(vendorId.toLowerCase());
  }

  /**
   * Lists all registered vendor IDs.
   */
  listVendors(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Resolves the appropriate adapter with deterministic precedence.
   */
  resolve(
    notification: DecodedSnmpNotification,
    identity: ResolvedDeviceIdentity,
  ): OltVendorAdapter {
    // 1. Ambiguous identity must NEVER invoke foreign/vendor-specific parsing
    if (identity.isAmbiguous) {
      return this.standardAdapter;
    }

    // 2. Direct vendor ID match
    const directMatch = this.adapters.get(identity.vendor.toLowerCase());
    if (directMatch && directMatch.supports(notification, identity)) {
      return directMatch;
    }

    // 3. IANA PEN match
    if (identity.pen !== undefined) {
      for (const adapter of this.adapters.values()) {
        if (
          adapter.supportedPens.includes(identity.pen) &&
          adapter.supports(notification, identity)
        ) {
          return adapter;
        }
      }
    }

    // 4. Baseline standard fallback
    return this.standardAdapter;
  }
}

export const defaultAdapterRegistry = new OltAdapterRegistry();
defaultAdapterRegistry.register(new HuaweiOltAdapter());
defaultAdapterRegistry.register(new ZteOltAdapter());
defaultAdapterRegistry.register(new NokiaOltAdapter());
defaultAdapterRegistry.register(new FiberhomeOltAdapter());
