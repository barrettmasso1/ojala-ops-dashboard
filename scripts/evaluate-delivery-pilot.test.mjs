import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateDeliveryPilot, parseCsv } from "./evaluate-delivery-pilot.mjs";

test("matches one event per actual delivery across UTC offsets and counts extra signals separately", () => {
  const truth = parseCsv(`shiftId,eventAt
A,2026-09-24T17:00:00-07:00
A,2026-09-25T00:00:15Z
B,2026-09-25T09:00:00Z
`, ["shiftId", "eventAt"]);
  const predictions = parseCsv(`shiftId,eventAt,sourceEventId
A,2026-09-25T00:00:02Z,event-001
A,2026-09-25T00:00:03Z,event-002
A,2026-09-25T00:00:16Z,event-003
A,2026-09-25T00:00:16Z,event-003
A,2026-09-25T00:01:00Z,event-004
`, ["shiftId", "eventAt", "sourceEventId"]);
  const availability = parseCsv(`shiftId,scheduledMinutes,onlineMinutes
A,60,45
B,60,60
`, ["shiftId", "scheduledMinutes", "onlineMinutes"]);
  const report = evaluateDeliveryPilot(truth, predictions, availability, 5);
  assert.equal(report.duplicateTransportRowsIgnored, 1);
  assert.deepEqual(report.total, {
    actualDeliveries: 3,
    candidateEvents: 4,
    trueMatches: 2,
    misses: 1,
    falseSignals: 2,
    countDifference: 1,
    precision: 0.5,
    recall: 0.6667,
    coverage: 0.875,
  });
  assert.deepEqual(report.shifts[0].review.falseSignals.map(item => item.sourceEventId), ["event-002", "event-004"]);
  assert.equal(report.shifts[1].review.missedAt.length, 1);
});

test("does not invent a precision, recall, or uptime when there is no denominator", () => {
  const report = evaluateDeliveryPilot([], [], [{ shiftId: "empty-shift", scheduledMinutes: "60", onlineMinutes: "0" }]);
  assert.equal(report.total.precision, null);
  assert.equal(report.total.recall, null);
  assert.equal(report.total.coverage, 0);
  assert.equal(report.total.actualDeliveries, 0);
});

test("reports misses and false signals even when daily totals happen to match", () => {
  const report = evaluateDeliveryPilot([
    { shiftId: "A", eventAt: "2026-09-25T00:00:00Z" },
    { shiftId: "A", eventAt: "2026-09-25T00:00:10Z" },
  ], [
    { shiftId: "A", eventAt: "2026-09-25T00:00:00Z", sourceEventId: "event-001" },
    { shiftId: "A", eventAt: "2026-09-25T00:00:50Z", sourceEventId: "event-002" },
  ]);
  assert.equal(report.total.countDifference, 0);
  assert.equal(report.total.precision, 0.5);
  assert.equal(report.total.recall, 0.5);
  assert.equal(report.total.coverage, null);
  assert.equal(report.total.misses, 1);
  assert.equal(report.total.falseSignals, 1);
});

test("rejects reused event identifiers, timestamps without offsets, and contradictory uptime", () => {
  assert.throws(() => evaluateDeliveryPilot([], [
    { shiftId: "A", eventAt: "2026-09-25T00:00:00Z", sourceEventId: "event-001" },
    { shiftId: "B", eventAt: "2026-09-25T00:00:00Z", sourceEventId: "event-001" },
  ]), /Conflicting sourceEventId/);
  assert.throws(() => evaluateDeliveryPilot([{ shiftId: "A", eventAt: "2026-09-25T00:00:00" }], []), /explicit UTC offset/);
  assert.throws(() => evaluateDeliveryPilot([{ shiftId: "A", eventAt: "2026-02-30T00:00:00Z" }], []), /Invalid calendar time/);
  assert.throws(() => evaluateDeliveryPilot([], [], [{ shiftId: "A", scheduledMinutes: "60", onlineMinutes: "61" }]), /Invalid availability/);
});

test("parses quoted notes without treating commas as separate columns", () => {
  assert.deepEqual(parseCsv('shiftId,eventAt,notes\nA,2026-09-25T00:00:00Z,"two cups, one visit"\n', ["shiftId", "eventAt"]), [
    { shiftId: "A", eventAt: "2026-09-25T00:00:00Z", notes: "two cups, one visit" },
  ]);
});

test("CLI reads the actual files and refuses to overwrite an existing report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ojala-delivery-pilot-"));
  try {
    const truth = join(directory, "truth.csv");
    const predictions = join(directory, "candidates.csv");
    const output = join(directory, "report.json");
    await writeFile(truth, "shiftId,eventAt\nA,2026-09-25T00:00:00Z\n");
    await writeFile(predictions, "shiftId,eventAt,sourceEventId\nA,2026-09-25T00:00:01Z,event-001\n");
    const args = ["scripts/evaluate-delivery-pilot.mjs", "--truth", truth, "--predictions", predictions, "--out", output];
    const first = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(await readFile(output, "utf8")).total.trueMatches, 1);
    const second = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(second.status, 1);
    assert.match(second.stderr, /EEXIST/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
