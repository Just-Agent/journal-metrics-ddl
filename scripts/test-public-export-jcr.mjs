#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { isPrivateKey, scanPublicPayload } from "./public-surface-rules.mjs";

const rawMetricsFile = new URL("../data/topics/jcr-impact-factor-ddl/metrics.json", import.meta.url);
const publicMetricsFile = new URL("../public-data/topics/jcr-impact-factor-ddl/metrics.json", import.meta.url);

const rawMetrics = JSON.parse(fs.readFileSync(rawMetricsFile, "utf8"));
const publicMetrics = JSON.parse(fs.readFileSync(publicMetricsFile, "utf8"));

const rawJif = rawMetrics.filter((metric) => metric.metric === "journal_impact_factor");
const publicJif = publicMetrics.filter((metric) => metric.metric === "journal_impact_factor");

assert.ok(rawJif.length > 0, "expected raw JCR impact-factor imports");
assert.equal(publicJif.length, rawJif.length, "public export should preserve imported JIF metric count");

const rawTitleOnly = rawJif.find((metric) => !metric.issn && metric.accessMode === "licensed_import");
assert.ok(rawTitleOnly, "expected title-only authorized JIF import");
assert.ok(rawTitleOnly.licenseNote, "raw authorized import should retain license note");
assert.ok(rawTitleOnly.scopeNote, "raw authorized import should retain scope note");

const publicTitleOnly = publicJif.find((metric) => metric.id === rawTitleOnly.id);
assert.ok(publicTitleOnly, "expected matching public title-only JIF import");
assert.equal(publicTitleOnly.value, rawTitleOnly.value);
assert.equal(publicTitleOnly.journalTitle, rawTitleOnly.journalTitle);
assert.equal(publicTitleOnly.sourceLabel, "授权导入来源");
assert.equal(publicTitleOnly.issn || "", "", "public title-only import should not fake an ISSN");

for (const key of ["accessMode", "licenseNote", "scopeNote", "parser", "apiUrl", "linkCheckMode"]) {
  assert.equal(Object.hasOwn(publicTitleOnly, key), false, `public JIF metric must not expose ${key}`);
}

for (const metric of publicJif) {
  for (const key of Object.keys(metric)) {
    assert.equal(isPrivateKey(key), false, `public JIF metric ${metric.id} exposes private key ${key}`);
  }
}

const publicErrors = scanPublicPayload(publicJif, "public JCR JIF metrics");
assert.deepEqual(publicErrors, []);

console.log(`tested public JCR import cleanup for ${publicJif.length} impact-factor metrics`);
