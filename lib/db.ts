import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  railwaySeatPool?: Pool;
  railwaySeatSchemaPromise?: Promise<void>;
  railwayLunchSchemaPromise?: Promise<void>;
};

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is missing. Add a PostgreSQL service and expose its DATABASE_URL to this service.",
  );
}

export const pool =
  globalForDb.railwaySeatPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.PGSSL === "true"
        ? { rejectUnauthorized: false }
        : undefined,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.railwaySeatPool = pool;
}

export function ensureSchema() {
  if (!globalForDb.railwaySeatSchemaPromise) {
    globalForDb.railwaySeatSchemaPromise = pool
      .query(
        `CREATE TABLE IF NOT EXISTS reservations (
          seat_key TEXT PRIMARY KEY,
          section TEXT NOT NULL,
          row_number INTEGER NOT NULL,
          seat_number INTEGER NOT NULL,
          name TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          reservation_key TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`,
      )
      .then(() => undefined)
      .catch((error) => {
        globalForDb.railwaySeatSchemaPromise = undefined;
        throw error;
      });
  }
  return globalForDb.railwaySeatSchemaPromise;
}

export function ensureLunchSchema() {
  if (!globalForDb.railwayLunchSchemaPromise) {
    globalForDb.railwayLunchSchemaPromise = pool
      .query(
        `CREATE TABLE IF NOT EXISTS lunch_reservations (
          seat_key TEXT PRIMARY KEY,
          table_id TEXT NOT NULL,
          seat_number INTEGER NOT NULL,
          name TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS lunch_messages (
          id BIGSERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS parking_plates (
          plate TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        -- 早期版本會把 ABC-1234 與 ABC1234 存成兩筆，這裡統一成無符號寫法。
        DELETE FROM parking_plates a
          USING parking_plates b
          WHERE a.created_at > b.created_at
            AND UPPER(REGEXP_REPLACE(a.plate, '[^A-Za-z0-9]', '', 'g'))
              = UPPER(REGEXP_REPLACE(b.plate, '[^A-Za-z0-9]', '', 'g'));
        UPDATE parking_plates
          SET plate = UPPER(REGEXP_REPLACE(plate, '[^A-Za-z0-9]', '', 'g'))
          WHERE plate <> UPPER(REGEXP_REPLACE(plate, '[^A-Za-z0-9]', '', 'g'));`,
      )
      .then(() => undefined)
      .catch((error) => {
        globalForDb.railwayLunchSchemaPromise = undefined;
        throw error;
      });
  }
  return globalForDb.railwayLunchSchemaPromise;
}
