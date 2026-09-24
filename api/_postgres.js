import { Pool } from "pg";

const POOL_OPTIONS = Object.freeze({
  max: 4,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  allowExitOnIdle: true,
});

let pool;
let poolUrl;

function postgresError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 500;
  return error;
}

function normalizeDatabaseUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const sslMode = String(url.searchParams.get("sslmode") || "").toLowerCase();

    if (["prefer", "require", "verify-ca"].includes(sslMode)) {
      url.searchParams.set("sslmode", "verify-full");
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}

function getDatabaseUrl() {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();

  if (!databaseUrl) {
    throw postgresError(
      "Falta DATABASE_URL para el runtime Postgres.",
      "POSTGRES_DATABASE_URL_MISSING"
    );
  }

  return normalizeDatabaseUrl(databaseUrl);
}

export function getPostgresPool() {
  const databaseUrl = getDatabaseUrl();

  if (!pool || poolUrl !== databaseUrl) {
    if (pool) {
      void pool.end().catch(() => undefined);
    }

    pool = new Pool({
      connectionString: databaseUrl,
      ...POOL_OPTIONS,
    });
    poolUrl = databaseUrl;

    pool.on("error", (error) => {
      console.error("Postgres idle client error:", error?.message || "unknown error");
    });
  }

  return pool;
}

export async function postgresQuery(text, params = []) {
  return getPostgresPool().query(text, params);
}

export async function withPostgresTransaction(work, options = {}) {
  if (typeof work !== "function") {
    throw new TypeError("withPostgresTransaction requiere una funcion.");
  }

  const client = await getPostgresPool().connect();

  try {
    await client.query("BEGIN");

    if (options.isolationLevel) {
      const isolationLevel = String(options.isolationLevel).trim().toUpperCase();
      const allowedLevels = new Set([
        "READ COMMITTED",
        "REPEATABLE READ",
        "SERIALIZABLE",
      ]);

      if (!allowedLevels.has(isolationLevel)) {
        throw new Error(`Isolation level no soportado: ${isolationLevel}`);
      }

      await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
    }

    if (options.readOnly === true) {
      await client.query("SET TRANSACTION READ ONLY");
    }

    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original error.
    }

    throw error;
  } finally {
    client.release();
  }
}
