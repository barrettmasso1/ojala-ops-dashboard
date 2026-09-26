import { and, eq, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { frigateCameraZones, storeCredentials, stores, users } from "../drizzle/schema";
import { getDb } from "./db";
import { createStaffPasswordVerifier, generateFrigateApiKey, hashFrigateApiKey } from "./storeCredentials";
import { parseHandoffZoneGeometry, parseStoredHandoffZoneGeometry, serializeHandoffZoneGeometry, type HandoffZoneGeometry } from "./handoffZoneGeometry";

export type StoreProfileInput = {
  nombre: string;
  timezone: string;
  horarioApertura: string | null;
  horarioCierre: string | null;
  duenoEmail: string;
  posType: "none" | "square" | "toast" | "shopify" | "other";
  cupSizes: string[];
};

function profileValues(input: StoreProfileInput) {
  return {
    nombre: input.nombre.trim(),
    timezone: input.timezone,
    horarioApertura: input.horarioApertura,
    horarioCierre: input.horarioCierre,
    duenoEmail: input.duenoEmail.trim().toLowerCase(),
    posType: input.posType,
    cupSizesJson: JSON.stringify(input.cupSizes),
  };
}

function publicProfile(store: typeof stores.$inferSelect) {
  let cupSizes: string[] = [];
  try { cupSizes = JSON.parse(store.cupSizesJson ?? "[]"); } catch { /* legacy data */ }
  return {
    id: store.id, nombre: store.nombre, timezone: store.timezone,
    horarioApertura: store.horarioApertura, horarioCierre: store.horarioCierre,
    duenoEmail: store.duenoEmail, posType: store.posType, cupSizes,
    isActive: store.isActive === 1,
  };
}

export async function getStoreProfile(storeId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!row) throw new Error("Store not found");
  return publicProfile(row);
}

export async function updateStoreProfile(storeId: number, input: Omit<StoreProfileInput, "timezone" | "cupSizes">) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(stores).set({
    nombre: input.nombre.trim(), horarioApertura: input.horarioApertura,
    horarioCierre: input.horarioCierre, duenoEmail: input.duenoEmail.trim().toLowerCase(),
    posType: input.posType,
  }).where(and(eq(stores.id, storeId), eq(stores.isActive, 1)));
  return getStoreProfile(storeId);
}

/** Drafts cannot authenticate or ingest until operational date and form settings are certified. */
export async function provisionStoreDraft(input: StoreProfileInput & { ownerOpenId: string; ownerName: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const staffPassword = randomBytes(24).toString("base64url");
  const frigateApiKey = generateFrigateApiKey();
  const staffVerifier = await createStaffPasswordVerifier(staffPassword);
  const frigateVerifier = hashFrigateApiKey(frigateApiKey);
  const storeId = await db.transaction(async tx => {
    const [inserted] = await tx.insert(stores).values({ ...profileValues(input), isActive: 0 });
    const id = Number(inserted.insertId);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error("Unable to create store");
    await tx.insert(users).values({
      storeId: id, openId: input.ownerOpenId, name: input.ownerName,
      email: input.duenoEmail, role: "admin", loginMethod: "preprovisioned",
    });
    await tx.insert(storeCredentials).values([
      { storeId: id, credentialType: "staff_portal", verifierFormat: "scrypt_v1", credentialVerifier: staffVerifier, label: "Initial staff password" },
      { storeId: id, credentialType: "frigate", verifierFormat: "sha256_v1", credentialVerifier: frigateVerifier, label: "Initial Frigate key" },
    ]);
    return id;
  });
  return { storeId, isActive: false, staffPassword, frigateApiKey };
}

export async function listStoreDrafts() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db.select().from(stores).where(eq(stores.isActive, 0));
  return rows.map(publicProfile);
}

export async function listStoreCredentials(storeId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.select({
    id: storeCredentials.id, credentialType: storeCredentials.credentialType,
    label: storeCredentials.label, createdAt: storeCredentials.createdAt,
    revokedAt: storeCredentials.revokedAt,
  }).from(storeCredentials).where(eq(storeCredentials.storeId, storeId));
}

/** Rotates one managed credential atomically within the authenticated store. */
export async function rotateStoreCredential(storeId: number, type: "staff_portal" | "frigate") {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const secret = type === "frigate" ? generateFrigateApiKey() : randomBytes(24).toString("base64url");
  const verifier = type === "frigate" ? hashFrigateApiKey(secret) : await createStaffPasswordVerifier(secret);
  await db.transaction(async tx => {
    await tx.update(storeCredentials).set({ revokedAt: new Date() }).where(and(
      eq(storeCredentials.storeId, storeId), eq(storeCredentials.credentialType, type), isNull(storeCredentials.revokedAt),
    ));
    await tx.insert(storeCredentials).values({
      storeId, credentialType: type, credentialVerifier: verifier,
      verifierFormat: type === "frigate" ? "sha256_v1" : "scrypt_v1", label: "Rotated credential",
    });
  });
  return { credentialType: type, secret };
}

export async function getStoreHandoffZone(storeId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [zone] = await db.select().from(frigateCameraZones).where(and(
    eq(frigateCameraZones.storeId, storeId),
    eq(frigateCameraZones.cameraName, "handoff"),
    eq(frigateCameraZones.zoneName, "handoff_zone"),
    eq(frigateCameraZones.isActive, 1),
  )).limit(1);
  if (!zone) return null;
  return {
    cameraName: zone.cameraName,
    zoneName: zone.zoneName,
    geometry: parseStoredHandoffZoneGeometry(zone.polygonJson),
    geometryVersion: zone.geometryVersion,
    updatedAt: zone.updatedAt,
  };
}

/** Applies manager-entered coordinates only within the authenticated store. */
export async function saveStoreHandoffZone(storeId: number, geometryInput: HandoffZoneGeometry) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const geometry = parseHandoffZoneGeometry(geometryInput.points);
  const polygonJson = serializeHandoffZoneGeometry(geometry);
  const [existing] = await db.select().from(frigateCameraZones).where(and(
    eq(frigateCameraZones.storeId, storeId),
    eq(frigateCameraZones.cameraName, "handoff"),
    eq(frigateCameraZones.zoneName, "handoff_zone"),
  )).limit(1);

  if (existing) {
    await db.update(frigateCameraZones).set({
      polygonJson,
      geometryVersion: existing.geometryVersion + 1,
      isActive: 1,
    }).where(eq(frigateCameraZones.id, existing.id));
  } else {
    await db.insert(frigateCameraZones).values({
      storeId,
      cameraName: "handoff",
      zoneName: "handoff_zone",
      polygonJson,
      geometryVersion: 1,
      isActive: 1,
    });
  }
  const zone = await getStoreHandoffZone(storeId);
  if (!zone) throw new Error("Unable to save handoff zone");
  return zone;
}
