#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEventTime } from "./evaluate-delivery-pilot.mjs";

/** Ended tracked objects are proxies for investigation, not confirmed handoffs. */
export function selectFrigateTrackProxies(events, { shiftId, from, to, camera = "handoff", label = "cup", zone } = {}) {
  if (!Array.isArray(events)) throw new Error("Frigate event export must be a JSON array");
  if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(shiftId ?? "")) throw new Error("Valid shiftId is required");
  const fromMs = parseEventTime(from);
  const toMs = parseEventTime(to);
  if (fromMs >= toMs) throw new Error("Shift end must be after shift start");
  if (zone && !/^[a-zA-Z0-9_-]{1,80}$/.test(zone)) throw new Error("Invalid zone name");
  const selected = new Map();
  for (const event of events) {
    if (!event || event.camera !== camera || event.label !== label || event.false_positive !== false ||
        !Number.isFinite(event.end_time) || event.end_time <= 0 ||
        (zone && (!Array.isArray(event.zones) || !event.zones.includes(zone)))) continue;
    const timestamp = Math.round(event.end_time * 1000);
    if (timestamp < fromMs || timestamp >= toMs) continue;
    if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(event.id ?? "")) throw new Error("Invalid Frigate event ID in selected shift");
    const prior = selected.get(event.id);
    if (prior !== undefined && prior !== timestamp) throw new Error(`Conflicting Frigate track ID: ${event.id}`);
    selected.set(event.id, timestamp);
  }
  return [...selected.entries()].map(([sourceEventId, timestamp]) => ({
    shiftId, eventAt: new Date(timestamp).toISOString(), sourceEventId,
  })).sort((a, b) => a.eventAt.localeCompare(b.eventAt) || a.sourceEventId.localeCompare(b.sourceEventId));
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (!["--events", "--shift-id", "--from", "--to", "--out", "--camera", "--label", "--zone"].includes(name) || options[name] !== undefined) {
      throw new Error(`Unknown or repeated option: ${name}`);
    }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
    options[name] = value;
  }
  if (!["--events", "--shift-id", "--from", "--to"].every(key => options[key])) {
    throw new Error("Usage: node scripts/export-frigate-track-proxies.mjs --events events.json --shift-id 2026-09-25-tarde --from ISO --to ISO [--zone handoff] [--out candidates.csv]");
  }
  return options;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const events = JSON.parse(await readFile(options["--events"], "utf8"));
  const candidates = selectFrigateTrackProxies(events, {
    shiftId: options["--shift-id"], from: options["--from"], to: options["--to"],
    camera: options["--camera"] ?? "handoff", label: options["--label"] ?? "cup",
    zone: options["--zone"],
  });
  const csv = `shiftId,eventAt,sourceEventId\n${candidates.map(item => `${item.shiftId},${item.eventAt},${item.sourceEventId}\n`).join("")}`;
  if (options["--out"]) await writeFile(options["--out"], csv, { flag: "wx" });
  else process.stdout.write(csv);
  process.stderr.write(`Selected ${candidates.length} completed cup tracks. These are unverified proxies, not deliveries.\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
