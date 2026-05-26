import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TOPIC_ID = "google-scholar-metrics-ddl";
const RAW_DIR = path.join(ROOT, "data", "topics", TOPIC_ID);
const PUBLIC_DIR = path.join(ROOT, "public-data", "topics", TOPIC_ID);
const TOP_VENUES_URL = "https://scholar.google.com/citations?view_op=top_venues&hl=en";
const RELEASE_COVERAGE_WINDOWS = new Map([
  ["google-scholar-metrics-2025-release", "2020-2024"],
  ["google-scholar-metrics-2024-release", "2019-2023"],
  ["google-scholar-metrics-2023-release", "2018-2022"]
]);
const errors = [];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function metricKey(metric) {
  return String(metric.publicationTitle || metric.journalTitle || metric.id || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
}

function assertNoPublicMaintenanceFields(records, label) {
  const blocked = [
    "accessMode",
    "scopeNote",
    "linkCheckMode",
    "parser",
    "apiUrl",
    "licenseNote",
    "forecastBasis",
    "releaseCadence"
  ];
  for (const record of records) {
    for (const field of blocked) {
      assert(!(field in record), `${label}/${record.id || "<missing-id>"} leaked ${field}`);
    }
  }
}

function validateItems(items) {
  const releases = items.filter(item => item.type === "historyEvent");
  const forecast = items.find(item => item.type === "forecastWindow");
  assert(releases.length >= 3, `${TOPIC_ID}: expected at least 3 official release history events`);
  assert(Boolean(forecast), `${TOPIC_ID}: missing forecast window`);
  for (const release of releases) {
    assert(isHttpUrl(release.sourceUrl), `${release.id}: missing official sourceUrl`);
    assert(release.source === "Google Scholar Blog", `${release.id}: source must be Google Scholar Blog`);
    assert(/^20\d{2}-\d{2}-\d{2}$/.test(release.date || ""), `${release.id}: date must be YYYY-MM-DD`);
    assert(
      release.coverageWindow === RELEASE_COVERAGE_WINDOWS.get(release.id),
      `${release.id}: coverageWindow must be ${RELEASE_COVERAGE_WINDOWS.get(release.id)}`
    );
  }
  if (forecast) {
    const basisEvents = Array.isArray(forecast.basisEvents) ? forecast.basisEvents : [];
    const releaseIds = new Set(releases.map(release => release.id));
    assert(forecast.isDatePlaceholder === true, `${forecast.id}: forecast must remain a placeholder, not a precise DDL`);
    assert(forecast.confidence, `${forecast.id}: missing confidence`);
    assert(basisEvents.length >= 3, `${forecast.id}: expected at least 3 basis events`);
    for (const basisId of basisEvents) {
      assert(releaseIds.has(basisId), `${forecast.id}: basis event ${basisId} is missing or not an official history event`);
    }
    assert(forecast.estimatedNextWindow?.start === "2026-07-01", `${forecast.id}: unexpected forecast window start`);
    assert(forecast.estimatedNextWindow?.end === "2026-07-31", `${forecast.id}: unexpected forecast window end`);
  }
}

function validateMetricPairs(metrics, label) {
  const relevant = metrics.filter(metric =>
    metric.topicId === TOPIC_ID &&
    (metric.metric === "google_scholar_h5_index" || metric.metric === "google_scholar_h5_median")
  );
  const byPublication = new Map();
  for (const metric of relevant) {
    const recordLabel = `${label}/${metric.id || "<missing-id>"}`;
    assert(metric.type === "metricSnapshot", `${recordLabel}: must be metricSnapshot`);
    assert(metric.year === 2025, `${recordLabel}: expected year 2025`);
    assert(Number.isFinite(Number(metric.value)) && Number(metric.value) > 0, `${recordLabel}: missing positive value`);
    assert(Number.isInteger(Number(metric.rank)), `${recordLabel}: missing integer rank`);
    assert(metric.rank >= 1 && metric.rank <= 10, `${recordLabel}: rank must be in top 10`);
    assert(metric.source === "Google Scholar Metrics", `${recordLabel}: source must be Google Scholar Metrics`);
    assert(metric.sourceUrl === TOP_VENUES_URL, `${recordLabel}: sourceUrl must be the Top publications page`);
    assert(isHttpUrl(metric.url), `${recordLabel}: missing url`);
    assert(["journal", "conference"].includes(metric.venueType), `${recordLabel}: venueType must be journal or conference`);
    assert(metric.publicationTitle && metric.journalTitle, `${recordLabel}: missing publicationTitle/journalTitle`);
    assert(metric.coverageWindow === "2020-2024", `${recordLabel}: coverageWindow must be 2020-2024`);
    const key = metricKey(metric);
    const group = byPublication.get(key) || [];
    group.push(metric);
    byPublication.set(key, group);
  }

  assert(relevant.length >= 20, `${label}: expected at least 20 h5 metric records, got ${relevant.length}`);
  assert(byPublication.size >= 10, `${label}: expected at least 10 top publications, got ${byPublication.size}`);
  const ranks = new Set(relevant.map(metric => Number(metric.rank)));
  for (let rank = 1; rank <= 10; rank += 1) {
    assert(ranks.has(rank), `${label}: missing rank ${rank}`);
  }

  let conferenceCount = 0;
  let journalCount = 0;
  for (const [publication, group] of byPublication.entries()) {
    const metricTypes = new Set(group.map(metric => metric.metric));
    assert(metricTypes.has("google_scholar_h5_index"), `${label}/${publication}: missing h5-index`);
    assert(metricTypes.has("google_scholar_h5_median"), `${label}/${publication}: missing h5-median`);
    const venueType = group[0]?.venueType;
    if (venueType === "conference") conferenceCount += 1;
    if (venueType === "journal") journalCount += 1;
  }
  assert(conferenceCount >= 3, `${label}: expected at least 3 conference venues, got ${conferenceCount}`);
  assert(journalCount >= 5, `${label}: expected at least 5 journal venues, got ${journalCount}`);

  return {
    records: relevant.length,
    publications: byPublication.size,
    journals: journalCount,
    conferences: conferenceCount
  };
}

const rawItems = readJson(path.join(RAW_DIR, "items.json"));
const rawMetrics = readJson(path.join(RAW_DIR, "metrics.json"));
const publicItems = readJson(path.join(PUBLIC_DIR, "items.json"));
const publicMetrics = readJson(path.join(PUBLIC_DIR, "metrics.json"));

validateItems(rawItems);
validateItems(publicItems);
const rawSummary = validateMetricPairs(rawMetrics, "raw");
const publicSummary = validateMetricPairs(publicMetrics, "public");
assertNoPublicMaintenanceFields(publicItems, "public-items");
assertNoPublicMaintenanceFields(publicMetrics, "public-metrics");

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  topicId: TOPIC_ID,
  raw: rawSummary,
  public: publicSummary
}, null, 2));
