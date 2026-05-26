import fs from "node:fs";

const root = new URL("../data/topics/", import.meta.url);
const errors = [];
const ids = new Set();
const metricIds = new Set();
let itemCount = 0;
let metricCount = 0;

const urlFields = ["url", "sourceUrl"];
const allowedItemTypes = new Set(["officialDeadline", "historyEvent", "forecastWindow"]);
const allowedConfidence = new Set(["low", "medium", "high"]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function hasMojibake(value) {
  return typeof value === "string" && (value.includes("????") || value.includes("\uFFFD"));
}

function scan(value, label) {
  if (hasMojibake(value)) errors.push(`${label} contains mojibake`);
  if (Array.isArray(value)) value.forEach((entry, index) => scan(entry, `${label}[${index}]`));
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) scan(nested, `${label}.${key}`);
  }
}

function assertUrl(value, label) {
  try {
    new URL(value);
  } catch {
    errors.push(`${label} invalid URL: ${value}`);
  }
}

function assertDate(value, label) {
  if (!Number.isFinite(new Date(value).getTime())) errors.push(`${label} invalid date: ${value}`);
}

function requireFields(record, fields, label) {
  for (const field of fields) {
    if (record[field] === undefined || record[field] === null || record[field] === "") {
      errors.push(`${label} missing ${field}`);
    }
  }
}

function validateItem(item, topicId, file, index) {
  const label = item.id || `${file.pathname} item ${index}`;
  requireFields(item, ["id", "topicId", "title", "type", "url", "source"], label);
  if (item.topicId !== topicId) errors.push(`${label} topicId does not match folder ${topicId}`);
  if (item.id && ids.has(item.id)) errors.push(`duplicate item id ${item.id}`);
  if (item.id) ids.add(item.id);
  if (!allowedItemTypes.has(item.type)) errors.push(`${label} unsupported type ${item.type}`);
  for (const field of urlFields) if (item[field]) assertUrl(item[field], `${label}.${field}`);
  if (!Array.isArray(item.tags) || item.tags.length === 0) errors.push(`${label} must include tags`);

  if (item.type === "officialDeadline") {
    requireFields(item, ["deadline", "sourceUrl"], label);
    if (item.deadline) assertDate(item.deadline, `${label}.deadline`);
    if (item.isDatePlaceholder) errors.push(`${label} officialDeadline cannot be a placeholder`);
  }

  if (item.type === "historyEvent") {
    requireFields(item, ["date", "sourceUrl"], label);
    if (item.date) assertDate(item.date, `${label}.date`);
  }

  if (item.type === "forecastWindow") {
    requireFields(item, ["isDatePlaceholder", "lastOfficialDate", "basisEvents", "estimatedNextWindow", "forecastBasis", "confidence", "releaseCadence"], label);
    if (item.isDatePlaceholder !== true) errors.push(`${label} forecastWindow must set isDatePlaceholder true`);
    if (item.lastOfficialDate) assertDate(item.lastOfficialDate, `${label}.lastOfficialDate`);
    if (!Array.isArray(item.basisEvents) || item.basisEvents.length === 0) errors.push(`${label} must include basisEvents`);
    if (Array.isArray(item.basisEvents) && item.basisEvents.length < 2 && !item.sampleNote) {
      errors.push(`${label} with fewer than two basisEvents must include sampleNote`);
    }
    if (!allowedConfidence.has(item.confidence)) errors.push(`${label} invalid confidence ${item.confidence}`);
    if (item.estimatedNextWindow) {
      requireFields(item.estimatedNextWindow, ["start", "end"], `${label}.estimatedNextWindow`);
      if (item.estimatedNextWindow.start) assertDate(item.estimatedNextWindow.start, `${label}.estimatedNextWindow.start`);
      if (item.estimatedNextWindow.end) assertDate(item.estimatedNextWindow.end, `${label}.estimatedNextWindow.end`);
    }
  }

  scan(item, label);
}

function validateSources(sources, topicId, file) {
  if (sources.topicId !== topicId) errors.push(`${file.pathname} topicId does not match folder ${topicId}`);
  if (!Array.isArray(sources.sourceFamilies) || sources.sourceFamilies.length === 0) {
    errors.push(`${file.pathname} must include sourceFamilies`);
    return;
  }
  for (const source of sources.sourceFamilies) {
    const label = source.id || `${file.pathname} source`;
    requireFields(source, ["id", "name", "url", "type", "accessMode", "parser"], label);
    if (source.url) assertUrl(source.url, `${label}.url`);
    if (!Array.isArray(source.markers) || source.markers.length === 0) errors.push(`${label} must include markers`);
    if (["login_required", "licensed_import"].includes(source.accessMode) && !source.licenseNote) {
      errors.push(`${label} ${source.accessMode} source must include licenseNote`);
    }
    scan(source, label);
  }
}

function validateMetric(metric, topicId, file, index) {
  const label = metric.id || `${file.pathname} metric ${index}`;
  requireFields(metric, ["id", "topicId", "type", "metric", "value", "source", "url", "accessMode", "scopeNote"], label);
  if (metric.topicId !== topicId) errors.push(`${label} topicId does not match folder ${topicId}`);
  if (metric.id && metricIds.has(metric.id)) errors.push(`duplicate metric id ${metric.id}`);
  if (metric.id) metricIds.add(metric.id);
  if (metric.type !== "metricSnapshot") errors.push(`${label} type must be metricSnapshot`);
  if (!metric.year && !metric.asOfDate) errors.push(`${label} missing year or asOfDate`);
  if (metric.url) assertUrl(metric.url, `${label}.url`);
  if (metric.asOfDate) assertDate(metric.asOfDate, `${label}.asOfDate`);
  if (["login_required", "licensed_import"].includes(metric.accessMode) && !metric.licenseNote) {
    errors.push(`${label} ${metric.accessMode} metric must include licenseNote`);
  }
  if (metric.metric === "openalex_works_count_by_year") {
    requireFields(metric, ["yearCompleteness", "asOfDate"], label);
    if (!["partial_ytd", "complete_observed"].includes(metric.yearCompleteness)) {
      errors.push(`${label} invalid yearCompleteness ${metric.yearCompleteness}`);
    }
    const currentYear = new Date().getFullYear();
    if (Number(metric.year) === currentYear && metric.yearCompleteness !== "partial_ytd") {
      errors.push(`${label} current calendar year must be marked partial_ytd`);
    }
    if (Number(metric.year) < currentYear && metric.yearCompleteness !== "complete_observed") {
      errors.push(`${label} completed calendar years must be marked complete_observed`);
    }
  }
  if (metric.metric === "journal_impact_factor") {
    if (!Number.isFinite(Number(metric.value)) || Number(metric.value) < 0) errors.push(`${label} invalid Journal Impact Factor ${metric.value}`);
    requireFields(metric, ["journalTitle", "category", "jcrEdition"], label);
  }
  if (metric.metric === "jcr_quartile") {
    if (!["Q1", "Q2", "Q3", "Q4"].includes(String(metric.value).toUpperCase())) errors.push(`${label} invalid JCR quartile ${metric.value}`);
    requireFields(metric, ["journalTitle", "category", "jcrEdition"], label);
  }
  if (metric.metric === "cas_major_zone") {
    const zone = Number(metric.value);
    if (!Number.isInteger(zone) || zone < 1 || zone > 4) errors.push(`${label} invalid CAS major zone ${metric.value}`);
    requireFields(metric, ["journalTitle", "casVersion", "majorCategory"], label);
    if (metric.minorZone !== undefined && metric.minorZone !== null && metric.minorZone !== "") {
      const minorZone = Number(metric.minorZone);
      if (!Number.isInteger(minorZone) || minorZone < 1 || minorZone > 4) errors.push(`${label} invalid CAS minor zone ${metric.minorZone}`);
    }
    if (metric.isTop !== undefined && metric.isTop !== null && typeof metric.isTop !== "boolean") {
      errors.push(`${label} invalid CAS TOP marker ${metric.isTop}`);
    }
  }
  if (["google_scholar_h5_index", "google_scholar_h5_median"].includes(metric.metric)) {
    if (!Number.isFinite(Number(metric.value)) || Number(metric.value) < 0) {
      errors.push(`${label} invalid Google Scholar ${metric.metric} ${metric.value}`);
    }
    requireFields(metric, ["publicationTitle", "venueType", "rank", "sourceUrl", "coverageWindow"], label);
    if (!["journal", "conference", "repository", "other"].includes(String(metric.venueType))) {
      errors.push(`${label} invalid venueType ${metric.venueType}`);
    }
    const expectedCoverage = `${Number(metric.year) - 5}-${Number(metric.year) - 1}`;
    if (metric.coverageWindow !== expectedCoverage) {
      errors.push(`${label} coverageWindow must be ${expectedCoverage}`);
    }
  }
  scan(metric, label);
}

function validatePublicPage() {
  const pageFile = new URL("../index.html", import.meta.url);
  if (!fs.existsSync(pageFile)) return;
  const html = fs.readFileSync(pageFile, "utf8");
  const blockedPatterns = [
    {
      pattern: /\$\{[^}]*\.(?:licenseNote|sampleNote|coverageNote|scopeNote|parser|accessMode|forecastBasis)[^}]*\}/,
      message: "index.html directly renders developer-only data fields"
    },
    {
      pattern: /\$\{[^}]*error\.message[^}]*\}/,
      message: "index.html directly renders raw error.message"
    }
  ];
  for (const { pattern, message } of blockedPatterns) {
    if (pattern.test(html)) errors.push(message);
  }
}

for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;
  const topicId = dirent.name;
  const topicDir = new URL(`${topicId}/`, root);
  const itemsFile = new URL("items.json", topicDir);
  const sourcesFile = new URL("sources.json", topicDir);
  const metricsFile = new URL("metrics.json", topicDir);

  if (!fs.existsSync(itemsFile)) errors.push(`${topicId} missing items.json`);
  if (!fs.existsSync(sourcesFile)) errors.push(`${topicId} missing sources.json`);

  if (fs.existsSync(itemsFile)) {
    const items = readJson(itemsFile);
    if (!Array.isArray(items)) errors.push(`${itemsFile.pathname} must be an array`);
    else items.forEach((item, index) => {
      itemCount += 1;
      validateItem(item, topicId, itemsFile, index);
    });
  }

  if (fs.existsSync(sourcesFile)) validateSources(readJson(sourcesFile), topicId, sourcesFile);

  if (fs.existsSync(metricsFile)) {
    const metrics = readJson(metricsFile);
    if (!Array.isArray(metrics)) errors.push(`${metricsFile.pathname} must be an array`);
    else metrics.forEach((metric, index) => {
      metricCount += 1;
      validateMetric(metric, topicId, metricsFile, index);
    });
  }
}

if (itemCount === 0) errors.push("no items found");
validatePublicPage();

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`validated ${itemCount} items and ${metricCount} metric snapshots`);
