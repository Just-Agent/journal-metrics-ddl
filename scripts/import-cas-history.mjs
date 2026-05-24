import fs from "node:fs";
import path from "node:path";

const inputFile = process.env.CAS_HISTORY_CSV || "";
const outputFile = new URL("../data/topics/cas-partition-ddl/metrics.json", import.meta.url);
const requiredColumns = [
  "journalTitle",
  "issn",
  "year",
  "version",
  "majorCategory",
  "majorZone",
  "source",
  "url"
];

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "journal";
}

function assertUrl(value, label) {
  try {
    new URL(value);
  } catch {
    throw new Error(`${label} invalid url: ${value}`);
  }
}

function readExistingMetrics() {
  if (!fs.existsSync(outputFile)) return [];
  return JSON.parse(fs.readFileSync(outputFile, "utf8"));
}

function buildMetric(row) {
  const year = Number(row.year);
  const majorZone = Number(row.majorZone);
  if (!Number.isInteger(year) || year < 2000) throw new Error(`${row.journalTitle} invalid year ${row.year}`);
  if (!Number.isInteger(majorZone) || majorZone < 1 || majorZone > 4) {
    throw new Error(`${row.journalTitle} invalid majorZone ${row.majorZone}`);
  }
  if (row.minorZone && !["1", "2", "3", "4"].includes(String(row.minorZone))) {
    throw new Error(`${row.journalTitle} invalid minorZone ${row.minorZone}`);
  }
  assertUrl(row.url, `${row.journalTitle}.url`);

  const journalId = slug(`${row.journalTitle}-${row.issn}`);
  return {
    id: `cas-${journalId}-${year}-${slug(row.majorCategory)}`,
    topicId: "cas-partition-ddl",
    type: "metricSnapshot",
    journalId,
    journalTitle: row.journalTitle,
    issn: row.issn,
    metric: "cas_major_zone",
    value: majorZone,
    year,
    source: row.source,
    url: row.url,
    accessMode: "licensed_import",
    licenseNote: "CAS 期刊分区单刊历史数据需由有权限的机构账号或授权文件导入。",
    scopeNote: `CAS ${row.version} ${row.majorCategory} 大类分区导入记录；公开仓库不绕过权限抓取。`,
    casVersion: row.version,
    majorCategory: row.majorCategory,
    minorCategory: row.minorCategory || "",
    minorZone: row.minorZone ? Number(row.minorZone) : null
  };
}

if (!inputFile) {
  console.log("CAS_HISTORY_CSV not set; skip authorized CAS history import.");
  process.exit(0);
}

const absoluteInput = path.resolve(inputFile);
if (!fs.existsSync(absoluteInput)) {
  throw new Error(`CAS_HISTORY_CSV not found: ${absoluteInput}`);
}

const lines = fs.readFileSync(absoluteInput, "utf8").split(/\r?\n/).filter(Boolean);
if (lines.length < 1) throw new Error("CAS_HISTORY_CSV must include a header row");
const headers = parseCsvLine(lines[0]);
for (const column of requiredColumns) {
  if (!headers.includes(column)) throw new Error(`CAS_HISTORY_CSV missing required column ${column}`);
}
if (lines.length < 2) {
  console.log("CAS_HISTORY_CSV has no data rows; keep existing CAS metrics.");
  process.exit(0);
}

const imported = lines.slice(1).map((line, index) => {
  const cells = parseCsvLine(line);
  const row = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] || ""]));
  for (const column of requiredColumns) {
    if (!row[column]) throw new Error(`row ${index + 2} missing ${column}`);
  }
  return buildMetric(row);
});

const existing = readExistingMetrics().filter((metric) => metric.metric !== "cas_major_zone");
const next = [...existing, ...imported].sort((a, b) => {
  const title = String(a.journalTitle || "").localeCompare(String(b.journalTitle || ""), "zh-CN");
  if (title !== 0) return title;
  return Number(b.year || 0) - Number(a.year || 0);
});

fs.writeFileSync(outputFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
console.log(`imported ${imported.length} CAS partition history metrics from ${absoluteInput}`);
