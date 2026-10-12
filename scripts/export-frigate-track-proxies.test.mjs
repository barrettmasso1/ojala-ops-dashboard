import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectFrigateTrackProxies } from "./export-frigate-track-proxies.mjs";
import { evaluateDeliveryPilot, parseCsv } from "./evaluate-delivery-pilot.mjs";

const start = Date.parse("2026-09-26T00:00:00Z") / 1000;
const event = (id, seconds, extras = {}) => ({
  id, camera: "handoff", label: "cup", false_positive: false,
  end_time: start + seconds, zones: ["handoff"], ...extras,
});
const options = { shiftId: "2026-09-25-tarde", from: "2026-09-25T17:00:00-07:00", to: "2026-09-25T17:01:00-07:00" };

test("extracts only finished handoff cup tracks in the selected shift and keeps one stable event ID", () => {
  const candidates = selectFrigateTrackProxies([
    event("track-001", 2), event("track-001", 2),
    event("track-002", 16), event("person-001", 20, { label: "person" }),
    event("wrong-camera", 24, { camera: "entrance" }),
    event("false-track", 26, { false_positive: true }),
    event("open-track", 30, { end_time: null }),
    event("outside-01", 60),
  ], options);
  assert.deepEqual(candidates.map(item => item.sourceEventId), ["track-001", "track-002"]);
  assert.equal(candidates[0].eventAt, "2026-09-26T00:00:02.000Z");
  const evaluated = evaluateDeliveryPilot([
    { shiftId: options.shiftId, eventAt: "2026-09-26T00:00:00Z" },
    { shiftId: options.shiftId, eventAt: "2026-09-26T00:00:15Z" },
  ], candidates);
  assert.equal(evaluated.total.trueMatches, 2);
});

test("optional zone filter and conflicting track IDs are explicit", () => {
  assert.deepEqual(selectFrigateTrackProxies([event("track-001", 2, { zones: ["counter"] })], { ...options, zone: "handoff" }), []);
  assert.throws(() => selectFrigateTrackProxies([event("track-001", 2), event("track-001", 3)], options), /Conflicting Frigate track ID/);
  assert.throws(() => selectFrigateTrackProxies({ events: [] }, options), /JSON array/);
});

test("CLI writes a CSV accepted by the evaluator without contacting Frigate or the dashboard", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ojala-frigate-proxies-"));
  try {
    const source = join(directory, "events.json");
    const output = join(directory, "candidates.csv");
    await writeFile(source, JSON.stringify([event("track-001", 2)]));
    const args = ["scripts/export-frigate-track-proxies.mjs", "--events", source,
      "--shift-id", options.shiftId, "--from", options.from, "--to", options.to, "--out", output];
    const command = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(command.status, 0, command.stderr);
    assert.match(command.stderr, /unverified proxies, not deliveries/);
    assert.equal(parseCsv(await readFile(output, "utf8"), ["shiftId", "eventAt", "sourceEventId"]).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
