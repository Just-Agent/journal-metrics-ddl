import assert from "node:assert/strict";
import fs from "node:fs";
import { isPrivateKey, scanPublicPayload } from "./public-surface-rules.mjs";

const rawMetricsFile = new URL("../data/topics/cas-partition-ddl/metrics.json", import.meta.url);
const publicMetricsFile = new URL("../public-data/topics/cas-partition-ddl/metrics.json", import.meta.url);

const rawMetrics = JSON.parse(fs.readFileSync(rawMetricsFile, "utf8"));
const publicMetrics = JSON.parse(fs.readFileSync(publicMetricsFile, "utf8"));

const rawZones = rawMetrics.filter((metric) => metric.metric === "cas_major_zone");
const publicZones = publicMetrics.filter((metric) => metric.metric === "cas_major_zone");

assert.ok(rawZones.length > 0, "raw CAS metrics should include authorized zone imports");
assert.equal(publicZones.length, rawZones.length, "public export should preserve CAS zone metric count");

const rawTitleOnly = rawZones.find((metric) => !metric.issn && metric.accessMode === "licensed_import");
assert.ok(rawTitleOnly, "raw CAS imports should include a title-only authorized metric");
assert.ok(rawTitleOnly.licenseNote, "raw authorized CAS import should retain license note");
assert.ok(rawTitleOnly.scopeNote, "raw authorized CAS import should retain scope note");

const publicTitleOnly = publicZones.find((metric) => metric.id === rawTitleOnly.id);
assert.ok(publicTitleOnly, "public CAS export should include title-only import");
assert.equal(publicTitleOnly.issn, "", "public CAS export should not fake ISSN");
assert.equal(publicTitleOnly.sourceLabel, "授权导入来源", "public CAS export should use user-facing source label");

for (const key of ["accessMode", "licenseNote", "scopeNote", "parser", "apiUrl", "linkCheckMode", "refreshCadence"]) {
  assert.equal(Object.hasOwn(publicTitleOnly, key), false, `public CAS metric must not expose ${key}`);
}

for (const metric of publicZones) {
  for (const key of Object.keys(metric)) {
    assert.equal(isPrivateKey(key), false, `public CAS metric ${metric.id} exposes private key ${key}`);
  }
}

const publicErrors = scanPublicPayload(publicZones, "public CAS zone metrics");
assert.deepEqual(publicErrors, [], publicErrors.join("\n"));

console.log(`tested public CAS import cleanup for ${publicZones.length} zone metrics`);
