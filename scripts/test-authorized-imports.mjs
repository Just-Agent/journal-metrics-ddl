import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = new URL("../", import.meta.url);
const repoRootPath = fileURLToPath(repoRoot);
const casMetricsFile = new URL("data/topics/cas-partition-ddl/metrics.json", repoRoot);
const jcrMetricsFile = new URL("data/topics/jcr-impact-factor-ddl/metrics.json", repoRoot);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-metrics-import-smoke-"));

const originals = new Map([
  [casMetricsFile, fs.readFileSync(casMetricsFile, "utf8")],
  [jcrMetricsFile, fs.readFileSync(jcrMetricsFile, "utf8")]
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function restoreOriginal(file) {
  fs.writeFileSync(file, originals.get(file), "utf8");
}

function restoreAll() {
  for (const file of originals.keys()) restoreOriginal(file);
}

function writeFixture(name, content) {
  const file = path.join(tempDir, name);
  fs.writeFileSync(file, content.replace(/^\n/, ""), "utf8");
  return file;
}

function runNodeScript(script, env = {}, expectFailure = false) {
  const childEnv = {
    ...process.env,
    CAS_IMPORT_REPLACE_ALL: "",
    JCR_IMPORT_REPLACE_ALL: "",
    ...env
  };
  const result = spawnSync(process.execPath, [script], {
    cwd: repoRootPath,
    env: childEnv,
    encoding: "utf8"
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (expectFailure) {
    assert(result.status !== 0, `${script} was expected to fail`);
  } else {
    assert(result.status === 0, `${script} failed:\n${output}`);
  }
  return output;
}

function testCasImportKeepsExistingMetrics() {
  restoreOriginal(casMetricsFile);
  const existing = readJson(casMetricsFile);
  const preservedMetric = {
    id: "cas-smoke-preserved-existing-metric",
    topicId: "cas-partition-ddl",
    type: "metricSnapshot",
    journalId: "preserved-journal-0000-0000",
    journalTitle: "Preserved Journal",
    issn: "0000-0000",
    metric: "cas_major_zone",
    value: 3,
    year: 2022,
    source: "Authorized CAS CSV",
    url: "https://example.com/cas-preserved",
    accessMode: "licensed_import",
    licenseNote: "Authorized import smoke fixture.",
    scopeNote: "Authorized import smoke fixture.",
    casVersion: "2022 CAS",
    majorCategory: "Engineering",
    minorCategory: "",
    minorZone: null
  };
  writeJson(casMetricsFile, [...existing, preservedMetric]);

  const casCsv = writeFixture(
    "cas-history.csv",
    `
journalTitle,issn,year,version,majorCategory,majorZone,minorCategory,minorZone,source,url
Journal of Test AI,1234-5678,2024,2024 CAS,"Computer Science, Artificial Intelligence",1,AI,1,Authorized CAS CSV,https://example.com/cas
`
  );

  runNodeScript("scripts/import-cas-history.mjs", { CAS_HISTORY_CSV: casCsv });
  const metrics = readJson(casMetricsFile);
  const imported = metrics.find((metric) => metric.id === "cas-journal-of-test-ai-1234-5678-2024-computer-science-artificial-intelligence");

  assert(metrics.some((metric) => metric.id === preservedMetric.id), "CAS incremental import removed an unrelated existing metric");
  assert(imported, "CAS import did not create the expected journal metric");
  assert(imported.majorCategory === "Computer Science, Artificial Intelligence", "CAS import did not preserve a quoted comma category");
  assert(imported.value === 1 && imported.minorZone === 1, "CAS import did not preserve major/minor zone values");
}

function testJcrMultiCategoryImport() {
  restoreOriginal(jcrMetricsFile);
  const jcrCsv = writeFixture(
    "jcr-history.csv",
    `
journalTitle,issn,jcrYear,jif,category,quartile,rank,totalJournals,edition,source,url
Journal of Test AI,1234-5678,2024,5.432,"Computer Science, Artificial Intelligence",Q1,3,200,2024 JCR,Authorized JCR CSV,https://example.com/jcr
Journal of Test AI,1234-5678,2024,5.432,"Computer Science, Information Systems",Q2,20,220,2024 JCR,Authorized JCR CSV,https://example.com/jcr
`
  );

  runNodeScript("scripts/import-jcr-history.mjs", { JCR_HISTORY_CSV: jcrCsv });
  const imported = readJson(jcrMetricsFile).filter((metric) => metric.journalTitle === "Journal of Test AI" && metric.year === 2024);
  const jifMetrics = imported.filter((metric) => metric.metric === "journal_impact_factor");
  const quartileMetrics = imported.filter((metric) => metric.metric === "jcr_quartile");

  assert(jifMetrics.length === 1, `JCR import should create one JIF metric per journal/year, got ${jifMetrics.length}`);
  assert(jifMetrics[0].value === 5.432, "JCR import did not preserve the JIF value");
  assert(quartileMetrics.length === 2, `JCR import should create one quartile metric per category, got ${quartileMetrics.length}`);
  assert(
    quartileMetrics.some((metric) => metric.category === "Computer Science, Artificial Intelligence"),
    "JCR import did not preserve the quoted comma category"
  );
}

function testJcrConflictingJifFails() {
  restoreOriginal(jcrMetricsFile);
  const conflictCsv = writeFixture(
    "jcr-conflict.csv",
    `
journalTitle,issn,jcrYear,jif,category,quartile,rank,totalJournals,edition,source,url
Journal of Conflict AI,9999-0000,2024,5.432,"Computer Science, Artificial Intelligence",Q1,3,200,2024 JCR,Authorized JCR CSV,https://example.com/jcr
Journal of Conflict AI,9999-0000,2024,6.000,"Computer Science, Information Systems",Q2,20,220,2024 JCR,Authorized JCR CSV,https://example.com/jcr
`
  );

  const output = runNodeScript("scripts/import-jcr-history.mjs", { JCR_HISTORY_CSV: conflictCsv }, true);
  assert(output.includes("conflicting JIF values"), "JCR conflict test failed for the wrong reason");
}

try {
  testCasImportKeepsExistingMetrics();
  testJcrMultiCategoryImport();
  testJcrConflictingJifFails();
  console.log("authorized CAS/JCR import smoke tests passed");
} finally {
  restoreAll();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
