import fs from "node:fs";

const topicsRoot = new URL("../data/topics/", import.meta.url);
const dataRoot = new URL("../data/", import.meta.url);
const reportFile = new URL("../data/crawl-report.json", import.meta.url);
const timeoutMs = Number(process.env.CRAWL_TIMEOUT_MS || 12000);
const currentYear = Number(process.env.JUST_DDL_CURRENT_YEAR || new Date().getFullYear());
const requestedTopic = process.env.TOPIC_ID?.trim();

const report = {
  generatedAt: new Date().toISOString(),
  mode: "journal-metrics-source-crawl",
  topics: [],
  openAlex: {
    requested: 0,
    writtenMetrics: 0,
    failures: []
  }
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function shouldProcess(topicId) {
  return !requestedTopic || requestedTopic === "journal-metrics-ddl" || requestedTopic === topicId;
}

function withTimeout() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeout };
}

async function fetchWithJson(url, headers = {}) {
  const { controller, timeout } = withTimeout();
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "Just-DDL journal metrics crawler (+https://github.com/Just-Agent)",
        ...headers
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function checkSourceReachability(source) {
  const entry = {
    id: source.id,
    url: source.url,
    parser: source.parser,
    accessMode: source.accessMode,
    status: "not_checked"
  };

  if (source.accessMode !== "public" || !source.url) {
    entry.status = "manual_or_authorized_source";
    return entry;
  }

  const { controller, timeout } = withTimeout();
  try {
    const response = await fetch(source.url, {
      redirect: "follow",
      headers: {
        "user-agent": "Just-DDL source checker (+https://github.com/Just-Agent)"
      },
      signal: controller.signal
    });
    entry.status = response.ok ? "reachable" : "http_error";
    entry.httpStatus = response.status;
  } catch (error) {
    entry.status = "fetch_error";
    entry.error = error.message;
  } finally {
    clearTimeout(timeout);
  }
  return entry;
}

function sourceUrlFromOpenAlex(source) {
  if (source.id) return source.id;
  if (source.homepage_url) return source.homepage_url;
  return "https://docs.openalex.org/api-entities/sources/source-object";
}

function buildOpenAlexMetric({ journal, source, metric, value, year, asOfDate, scopeNote, extra = {} }) {
  const suffix = year ? `${year}` : "total";
  return {
    id: `openalex-${journal.id}-${metric}-${suffix}`,
    topicId: "journal-volume-ddl",
    type: "metricSnapshot",
    journalId: journal.id,
    journalTitle: source.display_name || journal.title,
    issn: journal.issn,
    metric,
    value,
    ...(year ? { year, asOfDate } : { asOfDate }),
    source: "OpenAlex",
    url: sourceUrlFromOpenAlex(source),
    sourceUrl: "https://docs.openalex.org/api-entities/sources/source-object",
    accessMode: "public",
    scopeNote,
    openAlexId: source.id,
    ...extra
  };
}

async function crawlOpenAlexJournalVolume() {
  if (!shouldProcess("journal-volume-ddl")) return;

  const watchlistFile = new URL("journal-watchlist.json", dataRoot);
  const metricsFile = new URL("topics/journal-volume-ddl/metrics.json", dataRoot);
  if (!fs.existsSync(watchlistFile)) return;

  const watchlist = readJson(watchlistFile);
  const metrics = [];
  report.openAlex.requested = watchlist.length;

  for (const journal of watchlist) {
    const apiUrl = `https://api.openalex.org/sources/issn:${encodeURIComponent(journal.issn)}`;
    try {
      const source = await fetchWithJson(apiUrl);
      const counts = Array.isArray(source.counts_by_year) ? source.counts_by_year : [];

      metrics.push(buildOpenAlexMetric({
        journal,
        source,
        metric: "openalex_works_count_total",
        value: source.works_count,
        asOfDate: report.generatedAt.slice(0, 10),
        scopeNote: "OpenAlex Source object works_count total; this is open metadata coverage and is not equivalent to WoS/JCR article counts.",
        extra: {
          homepageUrl: source.homepage_url || null,
          citedByCount: source.cited_by_count ?? null,
          apiUrl
        }
      }));

      for (const year of [currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4]) {
        const row = counts.find((entry) => Number(entry.year) === year);
        if (!row) continue;
        metrics.push(buildOpenAlexMetric({
          journal,
          source,
          metric: "openalex_works_count_by_year",
          value: row.works_count,
          year,
          asOfDate: report.generatedAt.slice(0, 10),
          scopeNote: `OpenAlex counts_by_year works_count for ${year}; coverage may lag publisher sites and differs from WoS/JCR counting rules.`,
          extra: {
            yearCompleteness: year === currentYear ? "partial_ytd" : "complete_observed",
            oaWorksCount: row.oa_works_count ?? null,
            citedByCount: row.cited_by_count ?? null,
            apiUrl
          }
        }));
      }
    } catch (error) {
      report.openAlex.failures.push({
        journalId: journal.id,
        issn: journal.issn,
        error: error.message
      });
    }
  }

  if (metrics.length > 0 || !fs.existsSync(metricsFile)) {
    metrics.sort((a, b) => {
      const title = a.journalTitle.localeCompare(b.journalTitle);
      if (title !== 0) return title;
      return Number(b.year || 9999) - Number(a.year || 9999);
    });
    writeJson(metricsFile, metrics);
    report.openAlex.writtenMetrics = metrics.length;
  } else {
    report.openAlex.preservedExistingMetrics = true;
  }
}

for (const dirent of fs.readdirSync(topicsRoot, { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;
  const topicId = dirent.name;
  if (!shouldProcess(topicId)) continue;
  const sourcesFile = new URL(`${topicId}/sources.json`, topicsRoot);
  if (!fs.existsSync(sourcesFile)) continue;
  const sources = readJson(sourcesFile);
  const sourceReports = [];

  for (const source of sources.sourceFamilies || []) {
    sourceReports.push(await checkSourceReachability(source));
  }

  report.topics.push({ topicId, sources: sourceReports });
}

await crawlOpenAlexJournalVolume();

writeJson(reportFile, report);
console.log(`wrote crawl report for ${report.topics.length} topics; ${report.openAlex.writtenMetrics} OpenAlex metrics`);
