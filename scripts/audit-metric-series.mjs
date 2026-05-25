import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_ROOT = path.join(ROOT, "data", "topics");
const errors = [];

const REQUIREMENTS = [
  {
    topicId: "cas-partition-ddl",
    metric: "cas_major_zone",
    minGroups: 80,
    minSeriesGroups: 80,
    minSnapshotsPerSeries: 2,
    minCoverage: 0.9,
    requiredFields: ["journalTitle", "casVersion", "majorCategory", "url"]
  },
  {
    topicId: "jcr-impact-factor-ddl",
    metric: "journal_impact_factor",
    minGroups: 80,
    minSeriesGroups: 80,
    minSnapshotsPerSeries: 2,
    minCoverage: 0.9,
    requiredFields: ["journalTitle", "jcrEdition", "category", "url"]
  },
  {
    topicId: "journal-volume-ddl",
    metric: "openalex_works_count_by_year",
    minGroups: 40,
    minSeriesGroups: 40,
    minSnapshotsPerSeries: 3,
    minCoverage: 0.95,
    requiredFields: ["journalTitle", "yearCompleteness", "asOfDate", "url", "sourceUrl"]
  }
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function metricGroupKey(metric) {
  const journalKey = metric.journalId || normalizeKey(metric.journalTitle);
  const categoryKey = metric.metric === "cas_major_zone" ? normalizeKey(metric.majorCategory || "journal") : "";
  return [journalKey, categoryKey].filter(Boolean).join("::");
}

function isPresent(value) {
  return value !== undefined && value !== null && value !== "";
}

function validateMetricRecord(metric, requirement) {
  const label = `${requirement.topicId}/${metric.id || "<missing-id>"}`;
  if (metric.type !== "metricSnapshot") {
    errors.push(`${label}: metric series member must be metricSnapshot`);
  }
  if (!Number.isInteger(Number(metric.year))) {
    errors.push(`${label}: metric series member must include integer year`);
  }
  if (!isPresent(metric.value)) {
    errors.push(`${label}: metric series member must include value`);
  }
  for (const field of requirement.requiredFields) {
    if (!isPresent(metric[field])) {
      errors.push(`${label}: missing ${field}`);
    }
  }
}

function auditRequirement(requirement) {
  const metricsPath = path.join(DATA_ROOT, requirement.topicId, "metrics.json");
  if (!fs.existsSync(metricsPath)) {
    errors.push(`${requirement.topicId}: missing metrics.json`);
    return null;
  }

  const metrics = readJson(metricsPath).filter(metric => metric.metric === requirement.metric && isPresent(metric.journalTitle));
  const groups = new Map();

  for (const metric of metrics) {
    validateMetricRecord(metric, requirement);
    const key = metricGroupKey(metric);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(metric);
  }

  const seriesSummaries = [];
  for (const [key, groupMetrics] of groups.entries()) {
    const years = groupMetrics.map(metric => Number(metric.year)).filter(Number.isFinite);
    const uniqueYears = new Set(years);
    if (uniqueYears.size !== years.length) {
      errors.push(`${requirement.topicId}/${key}: duplicate year inside ${requirement.metric} series`);
    }
    seriesSummaries.push({
      key,
      snapshots: uniqueYears.size,
      minYear: Math.min(...uniqueYears),
      maxYear: Math.max(...uniqueYears)
    });
  }

  const groupCount = groups.size;
  const seriesGroupCount = seriesSummaries.filter(series => series.snapshots >= requirement.minSnapshotsPerSeries).length;
  const coverage = groupCount ? seriesGroupCount / groupCount : 0;

  if (groupCount < requirement.minGroups) {
    errors.push(`${requirement.topicId}/${requirement.metric}: expected at least ${requirement.minGroups} journal groups, got ${groupCount}`);
  }
  if (seriesGroupCount < requirement.minSeriesGroups) {
    errors.push(`${requirement.topicId}/${requirement.metric}: expected at least ${requirement.minSeriesGroups} multi-year series groups, got ${seriesGroupCount}`);
  }
  if (coverage < requirement.minCoverage) {
    errors.push(`${requirement.topicId}/${requirement.metric}: expected series coverage >= ${requirement.minCoverage}, got ${coverage.toFixed(3)}`);
  }

  const snapshotCounts = seriesSummaries.reduce((counts, series) => {
    counts[series.snapshots] = (counts[series.snapshots] || 0) + 1;
    return counts;
  }, {});

  return {
    topicId: requirement.topicId,
    metric: requirement.metric,
    records: metrics.length,
    groups: groupCount,
    multiYearSeriesGroups: seriesGroupCount,
    minSnapshotsPerSeries: requirement.minSnapshotsPerSeries,
    coverage: Number(coverage.toFixed(4)),
    snapshotCounts
  };
}

const audits = REQUIREMENTS.map(auditRequirement).filter(Boolean);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, audits }, null, 2));
