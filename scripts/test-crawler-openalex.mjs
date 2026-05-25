#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildOpenAlexMetricsForJournal } from "./crawl-sources.mjs";

const journal = {
  id: "tpami",
  title: "IEEE Transactions on Pattern Analysis and Machine Intelligence",
  issn: "0162-8828"
};

const source = {
  id: "https://openalex.org/S4210177283",
  display_name: "IEEE Transactions on Pattern Analysis and Machine Intelligence",
  homepage_url: "https://ieeexplore.ieee.org/xpl/RecentIssue.jsp?punumber=34",
  works_count: 3742,
  cited_by_count: 500000,
  counts_by_year: [
    { year: 2026, works_count: 130, oa_works_count: 50, cited_by_count: 1000 },
    { year: 2025, works_count: 398, oa_works_count: 200, cited_by_count: 8000 },
    { year: 2024, works_count: 293, oa_works_count: 180, cited_by_count: 9000 },
    { year: 2023, works_count: 242, oa_works_count: 150, cited_by_count: 8500 }
  ]
};

const metrics = buildOpenAlexMetricsForJournal({
  journal,
  source,
  currentYear: 2026,
  asOfDate: "2026-05-25",
  apiUrl: "https://api.openalex.org/sources/issn:0162-8828"
});

assert.equal(metrics.length, 5);

const total = metrics.find((metric) => metric.metric === "openalex_works_count_total");
assert.equal(total.value, 3742);
assert.equal(total.year, undefined);
assert.equal(total.asOfDate, "2026-05-25");
assert.equal(total.url, "https://openalex.org/S4210177283");
assert.equal(total.sourceUrl, "https://docs.openalex.org/api-entities/sources/source-object");
assert.equal(total.accessMode, "public");
assert.match(total.scopeNote, /not equivalent to WoS\/JCR/i);
assert.equal(total.apiUrl, "https://api.openalex.org/sources/issn:0162-8828");

const current = metrics.find((metric) => metric.metric === "openalex_works_count_by_year" && metric.year === 2026);
assert.equal(current.value, 130);
assert.equal(current.yearCompleteness, "partial_ytd");
assert.equal(current.oaWorksCount, 50);
assert.match(current.scopeNote, /differs from WoS\/JCR/i);

const complete = metrics.find((metric) => metric.metric === "openalex_works_count_by_year" && metric.year === 2025);
assert.equal(complete.value, 398);
assert.equal(complete.yearCompleteness, "complete_observed");

const oldMissing = metrics.find((metric) => metric.metric === "openalex_works_count_by_year" && metric.year === 2022);
assert.equal(oldMissing, undefined);

console.log(`tested OpenAlex crawler metric builder with ${metrics.length} metric snapshots`);
