#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { isPrivateKey, scanPublicPayload } from "./public-surface-rules.mjs";

const ROOT = process.cwd();
const PUBLIC_ROOT = path.join(ROOT, "public-data", "topics");
const errors = [];

const SERIES_REQUIREMENTS = [
  {
    topicId: "cas-partition-ddl",
    metric: "cas_major_zone",
    minRecords: 170,
    minGroups: 80,
    minSeriesGroups: 80,
    minSnapshotsPerSeries: 2,
    requiredFields: ["journalTitle", "casVersion", "majorCategory", "sourceLabel", "url"],
    sourceLabels: new Set(["授权导入来源"])
  },
  {
    topicId: "jcr-impact-factor-ddl",
    metric: "journal_impact_factor",
    minRecords: 700,
    minGroups: 80,
    minSeriesGroups: 80,
    minSnapshotsPerSeries: 2,
    requiredFields: ["journalTitle", "jcrEdition", "category", "sourceLabel", "url"],
    sourceLabels: new Set(["授权导入来源"])
  },
  {
    topicId: "journal-volume-ddl",
    metric: "openalex_works_count_by_year",
    minRecords: 200,
    minGroups: 40,
    minSeriesGroups: 40,
    minSnapshotsPerSeries: 3,
    requiredFields: ["journalTitle", "yearCompleteness", "asOfDate", "sourceLabel", "url", "sourceUrl"],
    sourceLabels: new Set(["公开来源"])
  }
];

const GOOGLE_SCHOLAR_TOPIC_ID = "google-scholar-metrics-ddl";
const GOOGLE_SCHOLAR_TOP_VENUES_URL = "https://scholar.google.com/citations?view_op=top_venues&hl=en";

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    errors.push(`missing public JSON ${filePath}`);
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isPresent(value) {
  return value !== undefined && value !== null && value !== "";
}

function isHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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

function assertNoPrivateSurface(records, label) {
  const publicErrors = scanPublicPayload(records, label);
  errors.push(...publicErrors);

  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (isPrivateKey(key)) {
        errors.push(`${label}/${record.id || "<missing-id>"} exposes private key ${key}`);
      }
    }
  }
}

function validateMetricRecord(metric, requirement) {
  const label = `${requirement.topicId}/${metric.id || "<missing-id>"}`;
  if (metric.topicId !== requirement.topicId) errors.push(`${label}: topicId mismatch`);
  if (metric.type !== "metricSnapshot") errors.push(`${label}: type must be metricSnapshot`);
  if (metric.metric !== requirement.metric) errors.push(`${label}: metric mismatch`);
  if (!Number.isInteger(Number(metric.year))) errors.push(`${label}: missing integer year`);
  if (!isPresent(metric.value)) errors.push(`${label}: missing value`);
  if (!requirement.sourceLabels.has(metric.sourceLabel)) {
    errors.push(`${label}: unexpected sourceLabel ${metric.sourceLabel || "<missing>"}`);
  }
  for (const field of requirement.requiredFields) {
    if (!isPresent(metric[field])) errors.push(`${label}: missing ${field}`);
  }
  if (isPresent(metric.url) && !isHttpUrl(metric.url)) errors.push(`${label}: url must be http(s)`);
  if (isPresent(metric.sourceUrl) && !isHttpUrl(metric.sourceUrl)) errors.push(`${label}: sourceUrl must be http(s)`);
  if (metric.metric === "openalex_works_count_by_year") {
    if (!["partial_ytd", "complete_observed"].includes(metric.yearCompleteness)) {
      errors.push(`${label}: invalid yearCompleteness ${metric.yearCompleteness || "<missing>"}`);
    }
    if (metric.source !== "OpenAlex") errors.push(`${label}: OpenAlex series must keep OpenAlex source`);
  }
}

function auditSeriesRequirement(requirement) {
  const metricsPath = path.join(PUBLIC_ROOT, requirement.topicId, "metrics.json");
  const allMetrics = readJson(metricsPath);
  assertNoPrivateSurface(allMetrics, `${requirement.topicId}/public-metrics`);
  const metrics = allMetrics.filter(metric => metric.metric === requirement.metric && isPresent(metric.journalTitle));
  const groups = new Map();

  for (const metric of metrics) {
    validateMetricRecord(metric, requirement);
    const key = metricGroupKey(metric);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(metric);
  }

  let seriesGroups = 0;
  let groupsWithCurrentYtd = 0;
  let groupsWithCompleteHistory = 0;
  const snapshotCounts = {};

  for (const [key, groupMetrics] of groups.entries()) {
    const years = groupMetrics.map(metric => Number(metric.year)).filter(Number.isFinite);
    const uniqueYears = new Set(years);
    if (uniqueYears.size !== years.length) {
      errors.push(`${requirement.topicId}/${key}: duplicate year inside public ${requirement.metric} series`);
    }

    const snapshots = uniqueYears.size;
    snapshotCounts[snapshots] = (snapshotCounts[snapshots] || 0) + 1;
    if (snapshots >= requirement.minSnapshotsPerSeries) seriesGroups += 1;

    if (requirement.metric === "openalex_works_count_by_year") {
      const completions = new Set(groupMetrics.map(metric => metric.yearCompleteness));
      if (completions.has("partial_ytd")) groupsWithCurrentYtd += 1;
      if (groupMetrics.filter(metric => metric.yearCompleteness === "complete_observed").length >= 2) {
        groupsWithCompleteHistory += 1;
      }
    }
  }

  if (metrics.length < requirement.minRecords) {
    errors.push(`${requirement.topicId}/${requirement.metric}: expected at least ${requirement.minRecords} public records, got ${metrics.length}`);
  }
  if (groups.size < requirement.minGroups) {
    errors.push(`${requirement.topicId}/${requirement.metric}: expected at least ${requirement.minGroups} public groups, got ${groups.size}`);
  }
  if (seriesGroups < requirement.minSeriesGroups) {
    errors.push(`${requirement.topicId}/${requirement.metric}: expected at least ${requirement.minSeriesGroups} public multi-year series, got ${seriesGroups}`);
  }
  if (requirement.metric === "openalex_works_count_by_year") {
    if (groupsWithCurrentYtd < requirement.minGroups) {
      errors.push(`${requirement.topicId}/${requirement.metric}: expected at least ${requirement.minGroups} watchlist groups to keep current-year YTD, got ${groupsWithCurrentYtd}`);
    }
    if (groupsWithCompleteHistory < requirement.minGroups) {
      errors.push(`${requirement.topicId}/${requirement.metric}: expected at least ${requirement.minGroups} watchlist groups to keep at least two complete years, got ${groupsWithCompleteHistory}`);
    }
  }

  return {
    topicId: requirement.topicId,
    metric: requirement.metric,
    records: metrics.length,
    groups: groups.size,
    multiYearSeriesGroups: seriesGroups,
    snapshotCounts,
    ...(requirement.metric === "openalex_works_count_by_year" ? {
      groupsWithCurrentYtd,
      groupsWithCompleteHistory
    } : {})
  };
}

function publicationKey(metric) {
  return String(metric.publicationTitle || metric.journalTitle || metric.id || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
}

function auditGoogleScholarPublicRail() {
  const metricsPath = path.join(PUBLIC_ROOT, GOOGLE_SCHOLAR_TOPIC_ID, "metrics.json");
  const allMetrics = readJson(metricsPath);
  assertNoPrivateSurface(allMetrics, `${GOOGLE_SCHOLAR_TOPIC_ID}/public-metrics`);
  const metrics = allMetrics.filter(metric =>
    metric.metric === "google_scholar_h5_index" ||
    metric.metric === "google_scholar_h5_median"
  );
  const byPublication = new Map();
  const ranks = new Set();
  let conferenceCount = 0;
  let journalCount = 0;

  for (const metric of metrics) {
    const label = `${GOOGLE_SCHOLAR_TOPIC_ID}/${metric.id || "<missing-id>"}`;
    if (metric.topicId !== GOOGLE_SCHOLAR_TOPIC_ID) errors.push(`${label}: topicId mismatch`);
    if (metric.type !== "metricSnapshot") errors.push(`${label}: type must be metricSnapshot`);
    if (metric.year !== 2025) errors.push(`${label}: expected 2025 Scholar Metrics snapshot`);
    if (!Number.isFinite(Number(metric.value)) || Number(metric.value) <= 0) errors.push(`${label}: value must be positive`);
    if (!Number.isInteger(Number(metric.rank))) errors.push(`${label}: missing integer rank`);
    if (Number(metric.rank) < 1 || Number(metric.rank) > 10) errors.push(`${label}: rank must be top 10`);
    if (metric.source !== "Google Scholar Metrics") errors.push(`${label}: source must be Google Scholar Metrics`);
    if (metric.sourceUrl !== GOOGLE_SCHOLAR_TOP_VENUES_URL) errors.push(`${label}: sourceUrl must be the top venues page`);
    if (!["journal", "conference"].includes(metric.venueType)) errors.push(`${label}: venueType must be journal or conference`);
    if (!metric.publicationTitle || !metric.journalTitle) errors.push(`${label}: missing publicationTitle or journalTitle`);

    ranks.add(Number(metric.rank));
    const key = publicationKey(metric);
    if (!byPublication.has(key)) byPublication.set(key, []);
    byPublication.get(key).push(metric);
  }

  if (metrics.length < 20) errors.push(`${GOOGLE_SCHOLAR_TOPIC_ID}: expected at least 20 h5 records, got ${metrics.length}`);
  if (byPublication.size < 10) errors.push(`${GOOGLE_SCHOLAR_TOPIC_ID}: expected at least 10 publications, got ${byPublication.size}`);
  for (let rank = 1; rank <= 10; rank += 1) {
    if (!ranks.has(rank)) errors.push(`${GOOGLE_SCHOLAR_TOPIC_ID}: missing rank ${rank}`);
  }

  for (const [publication, group] of byPublication.entries()) {
    const metricTypes = new Set(group.map(metric => metric.metric));
    if (!metricTypes.has("google_scholar_h5_index")) errors.push(`${GOOGLE_SCHOLAR_TOPIC_ID}/${publication}: missing h5-index`);
    if (!metricTypes.has("google_scholar_h5_median")) errors.push(`${GOOGLE_SCHOLAR_TOPIC_ID}/${publication}: missing h5-median`);
    if (group[0]?.venueType === "conference") conferenceCount += 1;
    if (group[0]?.venueType === "journal") journalCount += 1;
  }
  if (conferenceCount < 3) errors.push(`${GOOGLE_SCHOLAR_TOPIC_ID}: expected at least 3 conference venues, got ${conferenceCount}`);
  if (journalCount < 5) errors.push(`${GOOGLE_SCHOLAR_TOPIC_ID}: expected at least 5 journal venues, got ${journalCount}`);

  return {
    topicId: GOOGLE_SCHOLAR_TOPIC_ID,
    metrics: metrics.length,
    publications: byPublication.size,
    journals: journalCount,
    conferences: conferenceCount
  };
}

const seriesAudits = SERIES_REQUIREMENTS.map(auditSeriesRequirement);
const googleScholarAudit = auditGoogleScholarPublicRail();

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  publicMetricRails: seriesAudits,
  googleScholar: googleScholarAudit
}, null, 2));
