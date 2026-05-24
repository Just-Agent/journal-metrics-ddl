import fs from "node:fs";
import path from "node:path";

const inputFile = process.env.JCR_HISTORY_CSV || "";
const outputFile = new URL("../data/topics/jcr-impact-factor-ddl/metrics.json", import.meta.url);
const replaceAllImported = process.env.JCR_IMPORT_REPLACE_ALL === "1";
const requiredColumns = [
  "journalTitle",
  "issn",
  "jcrYear",
  "jif",
  "category",
  "quartile",
  "source",
  "url"
];
const importedMetrics = new Set(["journal_impact_factor", "jcr_quartile"]);
const importPlaceholderId = "jcr-journal-impact-factor-import-placeholder";

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

function validateRow(row) {
  const year = Number(row.jcrYear);
  const jif = Number(row.jif);
  const quartile = String(row.quartile).toUpperCase();
  if (!Number.isInteger(year) || year < 2000) throw new Error(`${row.journalTitle} invalid jcrYear ${row.jcrYear}`);
  if (!Number.isFinite(jif) || jif < 0) throw new Error(`${row.journalTitle} invalid jif ${row.jif}`);
  if (!["Q1", "Q2", "Q3", "Q4"].includes(quartile)) throw new Error(`${row.journalTitle} invalid quartile ${row.quartile}`);
  if (row.totalJournals && (!Number.isInteger(Number(row.totalJournals)) || Number(row.totalJournals) <= 0)) {
    throw new Error(`${row.journalTitle} invalid totalJournals ${row.totalJournals}`);
  }
  assertUrl(row.url, `${row.journalTitle}.url`);
  return { year, jif, quartile };
}

function baseMetric(row, year) {
  const journalId = slug(`${row.journalTitle}-${row.issn}`);
  return {
    topicId: "jcr-impact-factor-ddl",
    type: "metricSnapshot",
    journalId,
    journalTitle: row.journalTitle,
    issn: row.issn,
    year,
    source: row.source,
    url: row.url,
    sourceUrl: row.url,
    accessMode: "licensed_import",
    licenseNote: "单刊影响因子、JIF quartile 和类别排名来自机构授权文件或有权限账号导出。",
    category: row.category,
    jcrEdition: row.edition || `${year} JCR`,
    rank: row.rank || "",
    totalJournals: row.totalJournals ? Number(row.totalJournals) : null
  };
}

function buildImportedMetrics(rows) {
  const imported = [];
  const jifByJournalYear = new Map();

  for (const row of rows) {
    const { year, jif, quartile } = validateRow(row);
    const base = baseMetric(row, year);
    const jifKey = `${base.journalId}:${year}`;
    const existingJif = jifByJournalYear.get(jifKey);
    if (existingJif && existingJif.value !== jif) {
      throw new Error(`${row.journalTitle} ${year} has conflicting JIF values: ${existingJif.value} vs ${jif}`);
    }
    if (!existingJif) {
      const metric = {
        ...base,
        id: `jcr-${base.journalId}-${year}-impact-factor`,
        metric: "journal_impact_factor",
        value: jif,
        scopeNote: `${base.jcrEdition} Journal Impact Factor 导入记录；公开仓库不绕过 JCR 权限抓取。`
      };
      jifByJournalYear.set(jifKey, metric);
      imported.push(metric);
    }

    imported.push({
      ...base,
      id: `jcr-${base.journalId}-${year}-quartile-${slug(row.category)}`,
      metric: "jcr_quartile",
      value: quartile,
      scopeNote: `${base.jcrEdition} ${row.category} JIF quartile 导入记录；公开仓库不绕过 JCR 权限抓取。`
    });
  }

  return imported;
}

if (!inputFile) {
  console.log("JCR_HISTORY_CSV not set; skip authorized JCR history import.");
  process.exit(0);
}

const absoluteInput = path.resolve(inputFile);
if (!fs.existsSync(absoluteInput)) {
  throw new Error(`JCR_HISTORY_CSV not found: ${absoluteInput}`);
}

const lines = fs.readFileSync(absoluteInput, "utf8").split(/\r?\n/).filter(Boolean);
if (lines.length < 1) throw new Error("JCR_HISTORY_CSV must include a header row");
const headers = parseCsvLine(lines[0]);
for (const column of requiredColumns) {
  if (!headers.includes(column)) throw new Error(`JCR_HISTORY_CSV missing required column ${column}`);
}
if (lines.length < 2) {
  console.log("JCR_HISTORY_CSV has no data rows; keep existing JCR metrics.");
  process.exit(0);
}

const rows = lines.slice(1).map((line, index) => {
  const cells = parseCsvLine(line);
  const row = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] || ""]));
  for (const column of requiredColumns) {
    if (!row[column]) throw new Error(`row ${index + 2} missing ${column}`);
  }
  return row;
});
const imported = buildImportedMetrics(rows);
const importedIds = new Set(imported.map((metric) => metric.id));

const existing = readExistingMetrics().filter((metric) => {
  if (metric.id === importPlaceholderId) return false;
  if (replaceAllImported) return !importedMetrics.has(metric.metric);
  return !importedIds.has(metric.id);
});
const next = [...existing, ...imported].sort((a, b) => {
  const title = String(a.journalTitle || "").localeCompare(String(b.journalTitle || ""), "zh-CN");
  if (title !== 0) return title;
  const year = Number(b.year || 0) - Number(a.year || 0);
  if (year !== 0) return year;
  return String(a.metric || "").localeCompare(String(b.metric || ""));
});

fs.writeFileSync(outputFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
console.log(`imported ${imported.length} JCR impact-factor metrics from ${absoluteInput}`);
