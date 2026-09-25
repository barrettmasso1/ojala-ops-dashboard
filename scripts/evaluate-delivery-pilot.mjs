#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function readCsvRow(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(cell.trim()); cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("Unclosed quote in CSV row");
  cells.push(cell.trim());
  return cells;
}

export function parseCsv(source, requiredColumns) {
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) throw new Error("CSV header is missing");
  const header = readCsvRow(lines[0]);
  if (new Set(header).size !== header.length) throw new Error("Duplicate CSV header");
  for (const column of requiredColumns) {
    if (!header.includes(column)) throw new Error(`Missing CSV column: ${column}`);
  }
  return lines.slice(1).map((line, index) => {
    const cells = readCsvRow(line);
    if (cells.length !== header.length) throw new Error(`CSV row ${index + 2} has ${cells.length} cells, expected ${header.length}`);
    return Object.fromEntries(header.map((column, columnIndex) => [column, cells[columnIndex]]));
  });
}

function parseShiftId(value) {
  if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(value)) throw new Error(`Invalid shiftId: ${value}`);
  return value;
}

function parseEventTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`eventAt must be ISO 8601 with an explicit UTC offset: ${value}`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid eventAt: ${value}`);
  const offset = value.endsWith("Z") ? 0 : (
    (value.slice(-6, -5) === "+" ? 1 : -1) *
    (Number(value.slice(-5, -3)) * 60 + Number(value.slice(-2))) * 60_000
  );
  if (new Date(timestamp + offset).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error(`Invalid calendar time in eventAt: ${value}`);
  }
  return timestamp;
}

function parseMinutes(value, name) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error(`${name} must be a nonnegative number`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be finite`);
  return number;
}

function parseInput(truthRows, predictionRows, availabilityRows) {
  const truth = truthRows.map(row => ({ shiftId: parseShiftId(row.shiftId), eventAt: row.eventAt, time: parseEventTime(row.eventAt) }));
  const sourceIds = new Map();
  let retryDuplicates = 0;
  const predictions = [];
  for (const row of predictionRows) {
    const shiftId = parseShiftId(row.shiftId);
    const time = parseEventTime(row.eventAt);
    const id = row.sourceEventId;
    if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(id)) throw new Error(`Invalid sourceEventId: ${id}`);
    const existing = sourceIds.get(id);
    if (existing) {
      if (existing.shiftId !== shiftId || existing.time !== time) throw new Error(`Conflicting sourceEventId: ${id}`);
      retryDuplicates++;
      continue;
    }
    const entry = { shiftId, eventAt: row.eventAt, time, sourceEventId: id };
    sourceIds.set(id, entry);
    predictions.push(entry);
  }
  const availability = new Map();
  for (const row of availabilityRows) {
    const shiftId = parseShiftId(row.shiftId);
    if (availability.has(shiftId)) throw new Error(`Duplicate availability for shiftId: ${shiftId}`);
    const scheduledMinutes = parseMinutes(row.scheduledMinutes, "scheduledMinutes");
    const onlineMinutes = parseMinutes(row.onlineMinutes, "onlineMinutes");
    if (scheduledMinutes <= 0 || onlineMinutes > scheduledMinutes) throw new Error(`Invalid availability for shiftId: ${shiftId}`);
    availability.set(shiftId, { scheduledMinutes, onlineMinutes });
  }
  return { truth, predictions, availability, retryDuplicates };
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
}

export function evaluateDeliveryPilot(truthRows, predictionRows, availabilityRows = [], toleranceSeconds = 5) {
  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds < 0 || toleranceSeconds > 120) {
    throw new Error("toleranceSeconds must be between 0 and 120");
  }
  const { truth, predictions, availability, retryDuplicates } = parseInput(truthRows, predictionRows, availabilityRows);
  const shiftIds = [...new Set([...truth, ...predictions].map(item => item.shiftId).concat([...availability.keys()]))].sort();
  if (shiftIds.length === 0) throw new Error("At least one shift must be present");
  const toleranceMs = toleranceSeconds * 1000;
  const shifts = shiftIds.map(shiftId => {
    const actual = truth.filter(item => item.shiftId === shiftId).sort((a, b) => a.time - b.time);
    const candidates = predictions.filter(item => item.shiftId === shiftId).sort((a, b) => a.time - b.time);
    let actualIndex = 0;
    let candidateIndex = 0;
    const matched = [];
    const misses = [];
    const falseSignals = [];
    while (actualIndex < actual.length && candidateIndex < candidates.length) {
      const observation = actual[actualIndex];
      const candidate = candidates[candidateIndex];
      if (Math.abs(observation.time - candidate.time) <= toleranceMs) {
        matched.push({ actualAt: observation.eventAt, candidateAt: candidate.eventAt, sourceEventId: candidate.sourceEventId });
        actualIndex++; candidateIndex++;
      } else if (candidate.time < observation.time - toleranceMs) {
        falseSignals.push({ eventAt: candidate.eventAt, sourceEventId: candidate.sourceEventId });
        candidateIndex++;
      } else {
        misses.push(observation.eventAt);
        actualIndex++;
      }
    }
    for (const item of actual.slice(actualIndex)) misses.push(item.eventAt);
    for (const item of candidates.slice(candidateIndex)) falseSignals.push({ eventAt: item.eventAt, sourceEventId: item.sourceEventId });
    const uptime = availability.get(shiftId) ?? null;
    return {
      shiftId,
      actualDeliveries: actual.length,
      candidateEvents: candidates.length,
      trueMatches: matched.length,
      misses: misses.length,
      falseSignals: falseSignals.length,
      countDifference: candidates.length - actual.length,
      precision: ratio(matched.length, candidates.length),
      recall: ratio(matched.length, actual.length),
      coverage: uptime ? ratio(uptime.onlineMinutes, uptime.scheduledMinutes) : null,
      scheduledMinutes: uptime?.scheduledMinutes ?? null,
      onlineMinutes: uptime?.onlineMinutes ?? null,
      review: { matched, missedAt: misses, falseSignals },
    };
  });
  const total = key => shifts.reduce((sum, shift) => sum + shift[key], 0);
  const actualDeliveries = total("actualDeliveries");
  const candidateEvents = total("candidateEvents");
  const trueMatches = total("trueMatches");
  const completeAvailability = shifts.every(shift => shift.scheduledMinutes !== null);
  return {
    toleranceSeconds,
    shiftCount: shifts.length,
    duplicateTransportRowsIgnored: retryDuplicates,
    total: {
      actualDeliveries, candidateEvents, trueMatches,
      misses: total("misses"), falseSignals: total("falseSignals"),
      countDifference: candidateEvents - actualDeliveries,
      precision: ratio(trueMatches, candidateEvents),
      recall: ratio(trueMatches, actualDeliveries),
      coverage: completeAvailability ? ratio(total("onlineMinutes"), total("scheduledMinutes")) : null,
    },
    shifts,
  };
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (!["--truth", "--predictions", "--availability", "--out", "--tolerance-seconds"].includes(name) || options[name] !== undefined) {
      throw new Error(`Unknown or repeated option: ${name}`);
    }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
    options[name] = value;
  }
  if (!options["--truth"] || !options["--predictions"]) {
    throw new Error("Usage: node scripts/evaluate-delivery-pilot.mjs --truth truth.csv --predictions candidates.csv [--availability availability.csv] [--out report.json] [--tolerance-seconds 5]");
  }
  return options;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const truthRows = parseCsv(await readFile(options["--truth"], "utf8"), ["shiftId", "eventAt"]);
  const predictionRows = parseCsv(await readFile(options["--predictions"], "utf8"), ["shiftId", "eventAt", "sourceEventId"]);
  const availabilityRows = options["--availability"]
    ? parseCsv(await readFile(options["--availability"], "utf8"), ["shiftId", "scheduledMinutes", "onlineMinutes"])
    : [];
  const tolerance = options["--tolerance-seconds"] === undefined ? 5 : Number(options["--tolerance-seconds"]);
  const report = {
    generatedAt: new Date().toISOString(),
    sources: {
      truth: basename(options["--truth"]), predictions: basename(options["--predictions"]),
      availability: options["--availability"] ? basename(options["--availability"]) : null,
    },
    ...evaluateDeliveryPilot(truthRows, predictionRows, availabilityRows, tolerance),
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options["--out"]) await writeFile(options["--out"], serialized, { flag: "wx" });
  else process.stdout.write(serialized);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
