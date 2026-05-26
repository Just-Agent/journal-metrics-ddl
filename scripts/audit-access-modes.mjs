#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_ROOT = path.join(ROOT, "data", "topics");
const PUBLIC_ROOT = path.join(ROOT, "public-data", "topics");
const errors = [];

const ALLOWED_ACCESS_MODES = new Set(["public", "manual_verified", "login_required", "licensed_import"]);
const ACCESS_MODES_REQUIRING_LICENSE_NOTE = new Set(["login_required", "licensed_import"]);

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isPresent(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function assertAccessMode(record, label) {
  if (!ALLOWED_ACCESS_MODES.has(record.accessMode)) {
    errors.push(`${label}: invalid or missing accessMode ${record.accessMode || "<missing>"}`);
    return;
  }
  if (ACCESS_MODES_REQUIRING_LICENSE_NOTE.has(record.accessMode) && !isPresent(record.licenseNote)) {
    errors.push(`${label}: ${record.accessMode} must include licenseNote`);
  }
}

function publicMetricLabelFor(rawMetric) {
  if (rawMetric.accessMode === "licensed_import") return "授权导入来源";
  if (rawMetric.accessMode === "public") return "公开来源";
  return "";
}

function auditTopic(topicId, counters) {
  const topicDir = path.join(DATA_ROOT, topicId);
  const publicTopicDir = path.join(PUBLIC_ROOT, topicId);
  const sources = readJson(path.join(topicDir, "sources.json"), null);
  const metrics = readJson(path.join(topicDir, "metrics.json"), []);
  const publicMetrics = readJson(path.join(publicTopicDir, "metrics.json"), []);
  const publicMetricsById = new Map(publicMetrics.map(metric => [metric.id, metric]));

  if (sources?.sourceFamilies) {
    for (const source of sources.sourceFamilies) {
      const label = `${topicId}/source/${source.id || "<missing-id>"}`;
      counters.sources += 1;
      counters.sourceModes[source.accessMode || "<missing>"] = (counters.sourceModes[source.accessMode || "<missing>"] || 0) + 1;
      assertAccessMode(source, label);
    }
  }

  for (const metric of metrics) {
    const label = `${topicId}/metric/${metric.id || "<missing-id>"}`;
    counters.metrics += 1;
    counters.metricModes[metric.accessMode || "<missing>"] = (counters.metricModes[metric.accessMode || "<missing>"] || 0) + 1;
    assertAccessMode(metric, label);

    const expectedPublicLabel = publicMetricLabelFor(metric);
    if (expectedPublicLabel) {
      const publicMetric = publicMetricsById.get(metric.id);
      if (!publicMetric) {
        errors.push(`${label}: missing matching public metric export`);
      } else if (metric.accessMode === "licensed_import" && publicMetric.sourceLabel !== expectedPublicLabel) {
        errors.push(`${label}: licensed metric public sourceLabel must be ${expectedPublicLabel}`);
      } else if (metric.accessMode === "public" && publicMetric.sourceLabel === "授权导入来源") {
        errors.push(`${label}: public metric must not be labelled as authorized import`);
      }
    }
  }
}

const counters = {
  sources: 0,
  metrics: 0,
  sourceModes: {},
  metricModes: {}
};

for (const dirent of fs.readdirSync(DATA_ROOT, { withFileTypes: true })) {
  if (dirent.isDirectory()) auditTopic(dirent.name, counters);
}

if (counters.sources === 0) errors.push("no source families found");
if (counters.metrics === 0) errors.push("no metric snapshots found");
if (!counters.metricModes.licensed_import) errors.push("no licensed_import metrics found; authorized import audit would be ineffective");
if (!counters.metricModes.public) errors.push("no public metrics found; public metric audit would be ineffective");

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  sources: counters.sources,
  sourceModes: counters.sourceModes,
  metrics: counters.metrics,
  metricModes: counters.metricModes
}, null, 2));
