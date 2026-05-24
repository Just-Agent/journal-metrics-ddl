import fs from "node:fs";

const root = new URL("../data/topics/", import.meta.url);
const timeoutMs = Number(process.env.LINK_CHECK_TIMEOUT_MS || 6500);
const concurrency = Number(process.env.LINK_CHECK_CONCURRENCY || 6);
const strict = process.env.LINK_CHECK_STRICT === "1";
const failures = [];
let checked = 0;

async function request(url, method) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      redirect: "follow",
      headers: {
        "user-agent": method === "HEAD"
          ? "Just-DDL link checker (+https://github.com/Just-Agent)"
          : "Mozilla/5.0 Just-DDL link checker (+https://github.com/Just-Agent)"
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function check(url, labels) {
  checked += 1;
  const label = labels.slice(0, 3).join(", ");
  try {
    const response = await request(url, "HEAD");
    if (response.ok || response.status === 405) return;
    const fallback = await request(url, "GET");
    if (!fallback.ok) failures.push(`${label} returned HTTP ${response.status}/${fallback.status}`);
  } catch (error) {
    failures.push(`${label} failed: ${error.message}`);
  }
}

const links = new Map();

function addLink(url, label) {
  if (!links.has(url)) links.set(url, []);
  links.get(url).push(label);
}

for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;
  const topicId = dirent.name;
  const topicDir = new URL(`${topicId}/`, root);
  for (const filename of ["items.json", "sources.json", "metrics.json"]) {
    const file = new URL(filename, topicDir);
    if (!fs.existsSync(file)) continue;
    const records = JSON.parse(fs.readFileSync(file, "utf8"));
    const array = Array.isArray(records) ? records : records.sourceFamilies || [];
    for (const record of array) {
      if (record.accessMode && record.accessMode !== "public") continue;
      if (record.linkCheckMode === "manual_verified" || record.linkCheckMode === "skip") continue;
      if (record.source === "OpenAlex" && record.apiUrl) {
        addLink(record.apiUrl, `${topicId}:${record.id || record.name}.apiUrl`);
      }
      for (const key of ["url", "sourceUrl"]) {
        if (record.source === "OpenAlex" && record.apiUrl) continue;
        if (record[key]) addLink(record[key], `${topicId}:${record.id || record.name}.${key}`);
      }
    }
  }
}

const entries = [...links.entries()];
for (let index = 0; index < entries.length; index += concurrency) {
  await Promise.all(entries.slice(index, index + concurrency).map(([url, labels]) => check(url, labels)));
}

if (failures.length) {
  const message = failures.join("\n");
  if (strict) {
    console.error(message);
    process.exit(1);
  }
  console.warn(message);
}

console.log(`checked ${checked} links${strict ? " in strict mode" : " in warning mode"}`);
