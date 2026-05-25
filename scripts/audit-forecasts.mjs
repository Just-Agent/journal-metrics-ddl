#!/usr/bin/env node
import fs from "node:fs";

const root = new URL("../data/topics/", import.meta.url);
const errors = [];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function itemFiles(dir = root) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) files.push(...itemFiles(child));
    if (entry.isFile() && entry.name === "items.json") files.push(child);
  }
  return files;
}

function isoDate(value) {
  if (!value) return "";
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function dayDiff(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function mean(values) {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function sameArray(a = [], b = []) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isRootLikeUrl(value) {
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/, "");
    return pathname === "" || /^\/[a-z]{2}(?:-[a-z]{2})?$/i.test(pathname);
  } catch {
    return false;
  }
}

function officialDate(item) {
  return isoDate(item.date || item.deadline || item.lastOfficialDate);
}

function deterministicWindow(dates, currentDate) {
  const intervals = [];
  for (let index = 1; index < dates.length; index += 1) {
    intervals.push(dayDiff(dates[index - 1], dates[index]));
  }
  const medianDays = median(intervals);
  const minDays = Math.min(...intervals);
  const maxDays = Math.max(...intervals);
  const toleranceDays = Math.max(14, Math.round(medianDays * 0.2));
  const lowerInterval = intervals.length < 2 ? Math.max(1, medianDays - toleranceDays) : Math.max(minDays, medianDays - toleranceDays);
  const upperInterval = intervals.length < 2 ? medianDays + toleranceDays : Math.max(lowerInterval, Math.min(maxDays, medianDays + toleranceDays));
  let start = addDays(dates.at(-1), lowerInterval);
  let end = addDays(dates.at(-1), upperInterval);
  let rollForwardCount = 0;
  while (currentDate && end < currentDate && rollForwardCount < 12) {
    start = addDays(start, medianDays);
    end = addDays(end, medianDays);
    rollForwardCount += 1;
  }
  return {
    intervals,
    medianDays,
    meanDays: mean(intervals),
    minDays,
    maxDays,
    toleranceDays,
    lowerInterval,
    upperInterval,
    rollForwardCount,
    estimatedNextWindow: { start, end }
  };
}

function windowFromRule(rule = {}) {
  if (!rule.targetYear || !rule.startMonthDay || !rule.endMonthDay) return null;
  return {
    start: `${rule.targetYear}-${rule.startMonthDay}`,
    end: `${rule.targetYear}-${rule.endMonthDay}`
  };
}

function validateForecast(file, items, forecast) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const label = `${file.pathname}:${forecast.id}`;

  if (!forecast.isDatePlaceholder) errors.push(`${label} must use isDatePlaceholder`);
  if (forecast.deadline) errors.push(`${label} must not expose a fake deadline`);
  if (!forecast.estimatedNextWindow?.start || !forecast.estimatedNextWindow?.end) errors.push(`${label} must include estimatedNextWindow`);
  if (!["low", "medium", "high"].includes(String(forecast.confidence || ""))) errors.push(`${label} must include confidence`);
  if (!forecast.forecastBasis) errors.push(`${label} must include forecastBasis`);
  if (!isHttpUrl(forecast.sourceUrl)) errors.push(`${label} must include an http(s) sourceUrl`);
  if (isRootLikeUrl(forecast.sourceUrl)) errors.push(`${label} sourceUrl must point to an official evidence page, not a generic homepage`);
  if (!Array.isArray(forecast.basisEvents) || forecast.basisEvents.length < 2) {
    errors.push(`${label} must include at least two basisEvents`);
    return;
  }

  const basis = forecast.basisEvents.map((id) => ({ id, item: byId.get(id) }));
  const missing = basis.filter(({ item }) => !item).map(({ id }) => id);
  if (missing.length) errors.push(`${label} missing basisEvents: ${missing.join(", ")}`);
  for (const { id, item } of basis) {
    if (item && !isHttpUrl(item.sourceUrl)) errors.push(`${label} basisEvent ${id} must include an http(s) sourceUrl`);
  }

  const dates = basis.map(({ item }) => officialDate(item)).filter(Boolean);
  if (dates.length !== forecast.basisEvents.length) {
    errors.push(`${label} has basisEvents without official dates`);
    return;
  }
  if (!sameArray(dates, [...dates].sort())) errors.push(`${label} basisEvents must be chronological`);
  if (forecast.lastOfficialDate !== dates.at(-1)) errors.push(`${label} lastOfficialDate mismatch`);

  const cadence = forecast.releaseCadence;
  if (!cadence) {
    errors.push(`${label} must include releaseCadence`);
    return;
  }

  const computed = deterministicWindow(dates, cadence.currentDate);
  if (cadence.sampleSize !== dates.length) errors.push(`${label} releaseCadence.sampleSize mismatch`);
  if (!sameArray(cadence.dates || [], dates)) errors.push(`${label} releaseCadence.dates mismatch`);
  if (!sameArray(cadence.basisEvents || [], forecast.basisEvents)) errors.push(`${label} releaseCadence.basisEvents mismatch`);
  if (!sameArray(cadence.intervals || [], computed.intervals)) errors.push(`${label} releaseCadence.intervals mismatch`);
  for (const key of ["medianDays", "meanDays", "minDays", "maxDays"]) {
    if (Number(cadence[key]) !== Number(computed[key])) errors.push(`${label} releaseCadence.${key} mismatch`);
  }
  if (cadence.estimatedNextWindow?.start !== forecast.estimatedNextWindow?.start || cadence.estimatedNextWindow?.end !== forecast.estimatedNextWindow?.end) {
    errors.push(`${label} releaseCadence.estimatedNextWindow must match public estimatedNextWindow`);
  }

  const algorithm = String(cadence.algorithmVersion || "");
  if (algorithm === "just-ddl-cadence-v1") {
    if (forecast.estimatedNextWindow.start !== computed.estimatedNextWindow.start || forecast.estimatedNextWindow.end !== computed.estimatedNextWindow.end) {
      errors.push(`${label} deterministic forecast window mismatch`);
    }
  } else if (algorithm === "just-ddl-calendar-window-v1" || algorithm === "just-ddl-seasonal-window-v1") {
    const expected = windowFromRule(cadence.windowRule);
    if (!expected) {
      errors.push(`${label} ${algorithm} must include windowRule targetYear/startMonthDay/endMonthDay`);
    } else if (forecast.estimatedNextWindow.start !== expected.start || forecast.estimatedNextWindow.end !== expected.end) {
      errors.push(`${label} windowRule does not match estimatedNextWindow`);
    }
  } else {
    errors.push(`${label} unknown forecast algorithm ${algorithm || "(missing)"}`);
  }
}

let forecastCount = 0;
for (const file of itemFiles()) {
  const items = readJson(file);
  if (!Array.isArray(items)) continue;
  for (const item of items) {
    if (item.type === "forecastWindow" || item.estimatedNextWindow) {
      forecastCount += 1;
      validateForecast(file, items, item);
    }
  }
}

if (forecastCount === 0) errors.push("no forecast windows found");

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`audited ${forecastCount} forecast windows`);
