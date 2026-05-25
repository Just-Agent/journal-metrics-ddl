#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { isPrivateKey, scanPublicPayload } from "./public-surface-rules.mjs";

const rawMetricsFile = new URL("../data/topics/journal-volume-ddl/metrics.json", import.meta.url);
const publicMetricsFile = new URL("../public-data/topics/journal-volume-ddl/metrics.json", import.meta.url);

const rawMetrics = JSON.parse(fs.readFileSync(rawMetricsFile, "utf8"));
const publicMetrics = JSON.parse(fs.readFileSync(publicMetricsFile, "utf8"));

const rawOpenAlex = rawMetrics.filter((metric) => metric.metric?.startsWith("openalex_works_count"));
const publicOpenAlex = publicMetrics.filter((metric) => metric.metric?.startsWith("openalex_works_count"));

assert.ok(rawOpenAlex.length > 0, "expected raw OpenAlex metrics");
assert.equal(publicOpenAlex.length, rawOpenAlex.length, "public export should preserve OpenAlex metric count");

const rawTotal = rawOpenAlex.find((metric) => metric.metric === "openalex_works_count_total");
assert.ok(rawTotal, "expected raw total OpenAlex metric");
assert.equal(rawTotal.accessMode, "public");
assert.ok(rawTotal.apiUrl, "raw total metric should keep crawler API URL");
assert.match(rawTotal.scopeNote, /OpenAlex/i);

const publicTotal = publicOpenAlex.find((metric) => metric.id === rawTotal.id);
assert.ok(publicTotal, "expected matching public total OpenAlex metric");
assert.equal(publicTotal.value, rawTotal.value);
assert.equal(publicTotal.asOfDate, rawTotal.asOfDate);
assert.equal(publicTotal.sourceLabel, "公开来源");

for (const key of ["accessMode", "apiUrl", "scopeNote", "parser", "linkCheckMode", "licenseNote"]) {
  assert.equal(Object.hasOwn(publicTotal, key), false, `public total metric must not expose ${key}`);
}

const rawCurrentYear = rawOpenAlex.find(
  (metric) => metric.metric === "openalex_works_count_by_year" && metric.yearCompleteness === "partial_ytd"
);
assert.ok(rawCurrentYear, "expected current-year YTD OpenAlex metric");

const publicCurrentYear = publicOpenAlex.find((metric) => metric.id === rawCurrentYear.id);
assert.ok(publicCurrentYear, "expected matching public current-year OpenAlex metric");
assert.equal(publicCurrentYear.yearCompleteness, "partial_ytd");
assert.equal(publicCurrentYear.asOfDate, rawCurrentYear.asOfDate);

for (const metric of publicOpenAlex) {
  for (const key of Object.keys(metric)) {
    assert.equal(isPrivateKey(key), false, `public OpenAlex metric ${metric.id} exposes private key ${key}`);
  }
}

const publicErrors = scanPublicPayload(publicOpenAlex, "public OpenAlex metrics");
assert.deepEqual(publicErrors, []);

console.log(`tested public OpenAlex export cleanup for ${publicOpenAlex.length} metric snapshots`);
