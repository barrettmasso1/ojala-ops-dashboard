import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { startHandoffAnalysisWorker, stopHandoffAnalysisWorker } from "../handoffAnalysisWorker";
import { receiverProcedureAllowed } from "./receiverPolicy";

/** Optional deployment of the SAME receiver/DB contract, not a proxy around another site's controls. */
async function startReceiver() {
  const required = ["DATABASE_URL", "BUILT_IN_FORGE_API_URL", "BUILT_IN_FORGE_API_KEY", "OJALA_EXPECTED_DATABASE_FINGERPRINT"];
  if (required.some(name => !process.env[name])) throw new Error("receiver_configuration_incomplete");
  const configuredDatabase = new URL(process.env.DATABASE_URL!);
  const actualFingerprint = createHash("sha256").update([
    configuredDatabase.hostname, configuredDatabase.port || "3306", decodeURIComponent(configuredDatabase.pathname.slice(1)),
  ].join("\n")).digest("hex");
  if (actualFingerprint !== process.env.OJALA_EXPECTED_DATABASE_FINGERPRINT) throw new Error("unexpected_database_target");
  const db = await getDb();
  if (!db) throw new Error("receiver_database_unavailable");
  // Read-only schema compatibility check. Never run migrations or create a second database.
  await db.execute(sql`SELECT id, storeId, cupEventId, imageSha256, captureMetadataJson,
    sourceDetail, analysisLeaseToken, nextRetryAt FROM frigateHandoffVisualEvents LIMIT 0`);
  await db.execute(sql`SELECT id, storeId, credentialVerifier, revokedAt FROM storeCredentials LIMIT 0`);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "13mb" }));
  app.get("/healthz", (_req, res) => res.json({ status: "ok", service: "ojala-ingestion", dataRole: "existing_application_database" }));
  app.use("/api/trpc", (req, res, next) => {
    if (!receiverProcedureAllowed(req.path, req.method)) {
      res.status(404).json({ error: "not_found" }); return;
    }
    next();
  }, createExpressMiddleware({ router: appRouter, createContext }));
  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  app.use(((_error, _req, res, _next) => {
    res.status(400).json({ error: "invalid_request" });
  }) as express.ErrorRequestHandler);
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("invalid_receiver_port");
  const server = createServer(app);
  server.listen(port, "0.0.0.0", () => {
    console.info("[Ojala receiver] Started with existing application schema; machine credentials required.");
    startHandoffAnalysisWorker();
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => {
    stopHandoffAnalysisWorker();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
startReceiver().catch(() => {
  // Raw database/provider exceptions can contain credentials. Never print them.
  console.error("[Ojala receiver] Startup refused: configuration or existing schema unavailable.");
  process.exitCode = 1;
});
