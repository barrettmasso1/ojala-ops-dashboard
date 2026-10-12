import { spawnSync } from "node:child_process";
import mysql from "mysql2/promise";

const target = { host: "127.0.0.1", port: 4000, user: "root", database: "ojala_phase1_rehearsal" };
const databaseUrl = `mysql://${target.user}@${target.host}:${target.port}/${target.database}`;
const connection = await mysql.createConnection(target);
try {
  const [versionRows] = await connection.query("SELECT VERSION() AS version, DATABASE() AS databaseName");
  if (!/tidb/i.test(String(versionRows[0]?.version ?? "")) || versionRows[0]?.databaseName !== target.database) {
    throw new Error("Refusing migration: local TiDB rehearsal target verification failed");
  }
  const [[before]] = await connection.query("SELECT COUNT(*) AS count FROM __drizzle_migrations");
  const migration = spawnSync("pnpm", ["drizzle-kit", "migrate"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  if (migration.status !== 0) throw new Error(`Drizzle migration failed: ${migration.stderr || migration.stdout}`);
  const [[after]] = await connection.query("SELECT COUNT(*) AS count FROM __drizzle_migrations");
  process.stdout.write(JSON.stringify({
    migrated: true,
    target,
    migrationLedgerBefore: Number(before.count),
    migrationLedgerAfter: Number(after.count),
    appliedMigrationCount: Number(after.count) - Number(before.count),
  }, null, 2) + "\n");
} finally {
  await connection.end();
}
