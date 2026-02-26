import { z } from 'zod';
import type { ConnectionBase } from './types';
import type { IConnectionModule } from './types';

/**
 * Registry of connection modules. Holds all registered modules and exposes
 * schema (discriminated union), type list for CLI, and lookup by typeId.
 */
export class ConnectionRegistry<TConnection extends ConnectionBase> {
  private modules = new Map<string, IConnectionModule<TConnection>>();

  register(module: IConnectionModule<TConnection>): void {
    if (this.modules.has(module.typeId)) {
      throw new Error(`Connection module "${module.typeId}" is already registered`);
    }
    this.modules.set(module.typeId, module);
  }

  getConnectionTypes(): { typeId: string; label: string }[] {
    return Array.from(this.modules.values()).map((m) => ({
      typeId: m.typeId,
      label: m.label,
    }));
  }

  getModule(typeId: string): IConnectionModule<TConnection> | undefined {
    return this.modules.get(typeId);
  }

  getWebhookUrl(connection: TConnection): string {
    const module = this.modules.get(connection.type);
    if (!module) {
      throw new Error(`Unknown connection type: ${connection.type}`);
    }
    return module.getWebhookUrl(connection);
  }

  /**
   * Build a Zod discriminated union from all registered module schemas.
   * Must be called after all modules are registered.
   */
  getConnectionSchema(): z.ZodType<TConnection> {
    const schemas = Array.from(this.modules.values()).map((m) => m.schema);
    if (schemas.length === 0) {
      throw new Error('No connection modules registered; cannot build ConnectionSchema');
    }
    // Union of all module schemas (each has type discriminator); cast for generic TConnection
    const union = z.union(schemas as [z.ZodType<TConnection>, z.ZodType<TConnection>, ...z.ZodType<TConnection>[]]);
    return union as z.ZodType<TConnection>;
  }
}
