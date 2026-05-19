import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pg from 'pg';

import type { ModelProviderStore } from '../interfaces.js';
import type { ModelProviderRecord } from '../types.js';
import * as schema from '../schema.js';
import { modelProviders } from '../schema.js';
import type { DrizzleDb } from './index.js';

export class DbModelProviderStore implements ModelProviderStore {
  private pool?: pg.Pool;

  constructor(private readonly db: DrizzleDb) {}

  static async open(databaseUrl?: string): Promise<DbModelProviderStore> {
    const url = databaseUrl ?? process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL environment variable is required');
    const pool = new pg.Pool({ connectionString: url });
    await pool.query('SELECT 1');
    const db = drizzle(pool, { schema });
    const store = new DbModelProviderStore(db);
    store.pool = pool;
    return store;
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }

  async list(enabledOnly?: boolean): Promise<ModelProviderRecord[]> {
    const rows = enabledOnly
      ? await this.db.select().from(modelProviders)
          .where(eq(modelProviders.enabled, true))
      : await this.db.select().from(modelProviders);
    return rows.map(mapRow);
  }

  async get(id: string): Promise<ModelProviderRecord | undefined> {
    const [row] = await this.db.select().from(modelProviders)
      .where(eq(modelProviders.id, id));
    return row ? mapRow(row) : undefined;
  }

  async create(record: Omit<ModelProviderRecord, 'createdAt' | 'updatedAt'>): Promise<ModelProviderRecord> {
    const now = new Date().toISOString();
    const [row] = await this.db.insert(modelProviders)
      .values({
        id: record.id,
        name: record.name,
        provider: record.provider,
        model: record.model,
        maxTokens: record.maxTokens,
        baseUrl: record.baseUrl,
        api: record.api,
        thinking: record.thinking,
        secretName: record.secretName,
        enabled: record.enabled,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return mapRow(row!);
  }

  async update(
    id: string,
    patch: Partial<Pick<ModelProviderRecord, 'name' | 'provider' | 'model' | 'maxTokens' | 'baseUrl' | 'api' | 'thinking' | 'secretName' | 'enabled'>>,
  ): Promise<ModelProviderRecord | undefined> {
    const now = new Date().toISOString();
    const [row] = await this.db.update(modelProviders)
      .set({ ...patch, updatedAt: now })
      .where(eq(modelProviders.id, id))
      .returning();
    return row ? mapRow(row) : undefined;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(modelProviders)
      .where(eq(modelProviders.id, id));
  }
}

const mapRow = (row: typeof modelProviders.$inferSelect): ModelProviderRecord => ({
  id: row.id,
  name: row.name,
  provider: row.provider,
  model: row.model,
  maxTokens: row.maxTokens,
  baseUrl: row.baseUrl,
  api: row.api,
  thinking: row.thinking,
  secretName: row.secretName,
  enabled: row.enabled,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
