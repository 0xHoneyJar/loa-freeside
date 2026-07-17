import type { OrderStore } from './store.js';
import { InMemoryOrderStore } from './store.js';
import { PostgresOrderStore } from './store-postgres.js';

export async function createOrderStore(): Promise<OrderStore> {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    return PostgresOrderStore.connect(url, { migrate: process.env.RUN_MIGRATIONS === 'true' });
  }
  return new InMemoryOrderStore();
}
