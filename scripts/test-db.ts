/** Disposable real PostgreSQL tests. Never reads SUPABASE_URL or resets a remote DB. */
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { runDatabaseTests } from "../tests/integration/workflow-db";

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (address === null || typeof address === "string") return reject(new Error("Could not allocate local test port"));
      const port = address.port;
      socket.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function main() {
  const workspace = process.cwd();
  const databaseDir = await mkdtemp(path.join(workspace, ".test-db-"));
  const password = randomBytes(24).toString("hex");
  const port = await availablePort();
  const postgres = new EmbeddedPostgres({ databaseDir, user: "postgres", password, port,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    persistent: true, createPostgresUser: false, postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "timezone=UTC"],
    onLog: () => undefined, onError: (error) => console.error(String(error)) });
  let started = false;
  let admin: Pool | undefined;
  let server: Pool | undefined;
  try {
    await postgres.initialise();
    await postgres.start();
    started = true;
    const connection = { host: "127.0.0.1", port, user: "postgres", password, database: "postgres", max: 20,
      connectionTimeoutMillis: 5000, statement_timeout: 10000, query_timeout: 15000 };
    admin = new Pool(connection);
    await admin.query("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema extensions; create extension pgcrypto with schema extensions;");
    const files = (await readdir(path.join(workspace, "supabase/migrations"))).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      await admin.query(await readFile(path.join(workspace, "supabase/migrations", file), "utf8"));
      console.log(`Applied ${file} to disposable PostgreSQL.`);
    }
    server = new Pool({ ...connection, options: "-c role=service_role" });
    console.log(`Database engine: ${(await admin.query("select version()" )).rows[0].version}`);
    await runDatabaseTests(admin, server, connection);
  } finally {
    await server?.end();
    await admin?.end();
    if (started) await postgres.stop();
    const resolved = path.resolve(databaseDir);
    if (path.dirname(resolved) !== path.resolve(workspace) || !path.basename(resolved).startsWith(".test-db-")) {
      throw new Error("Refusing cleanup outside disposable test directory");
    }
    await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

main().then(() => {
  // All gates and awaited database cleanup completed. Windows transpiler helpers
  // can retain handles after that point; end the verified run explicitly.
  process.exit(0);
}).catch((error: unknown) => {
  console.error("Real database tests failed:", error instanceof Error ? error.message : String(error));
  // embedded-postgres installs an exit hook; an explicit status is needed to preserve failure.
  process.exit(1);
});
