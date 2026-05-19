import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pg from 'pg';

import type { GatewaySecretStore, SecretEntry } from '../interfaces.js';
import * as schema from '../schema.js';
import { gatewaySecrets } from '../schema.js';
import {
  decryptString as decrypt,
  encryptString as encrypt,
  secretsKeyFromEnv,
} from './secret-crypto.js';
import type { DrizzleDb } from './index.js';

export class DbGatewaySecretStore implements GatewaySecretStore {
  private pool?: pg.Pool;

  private constructor(
    private readonly db: DrizzleDb,
    private readonly key: Buffer,
  ) {}

  static async open(databaseUrl?: string): Promise<DbGatewaySecretStore> {
    const url = databaseUrl ?? process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL environment variable is required');
    const pool = new pg.Pool({ connectionString: url });
    await pool.query('SELECT 1');
    const db = drizzle(pool, { schema });
    const store = new DbGatewaySecretStore(db, secretsKeyFromEnv());
    store.pool = pool;
    return store;
  }

  static withDb(db: DrizzleDb): DbGatewaySecretStore {
    return new DbGatewaySecretStore(db, secretsKeyFromEnv());
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }

  async listEntries(): Promise<Record<string, SecretEntry>> {
    const rows = await this.db.select().from(gatewaySecrets);
    const out: Record<string, SecretEntry> = {};
    for (const row of rows) {
      try {
        out[row.name] = {
          value: decrypt(this.key, row.valueCiphertext),
          passThrough: true, // Gateway secrets are always available for injection
        };
      } catch {
        // Decryption failure — key may have changed. Skip rather than crash.
      }
    }
    return out;
  }

  async get(name: string): Promise<string | undefined> {
    const [row] = await this.db.select().from(gatewaySecrets)
      .where(eq(gatewaySecrets.name, name));
    if (!row) return undefined;
    try {
      return decrypt(this.key, row.valueCiphertext);
    } catch {
      return undefined;
    }
  }

  async set(name: string, value: string): Promise<void> {
    const ciphertext = encrypt(this.key, value);
    const now = new Date().toISOString();
    await this.db.insert(gatewaySecrets)
      .values({
        name,
        valueCiphertext: ciphertext,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [gatewaySecrets.name],
        set: {
          valueCiphertext: ciphertext,
          updatedAt: now,
        },
      });
  }

  async delete(name: string): Promise<void> {
    await this.db.delete(gatewaySecrets)
      .where(eq(gatewaySecrets.name, name));
  }
}
