import fs from "node:fs";
import path from "node:path";
import { stripPrivateFields, scanPublicPayload } from "./public-surface-rules.mjs";

const root = new URL("../data/topics/", import.meta.url);
const outputRoot = new URL("../public-data/topics/", import.meta.url);
const exported = [];
const errors = [];

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;

  const topicId = dirent.name;
  const topicDir = new URL(`${topicId}/`, root);
  const publicTopicDir = new URL(`${topicId}/`, outputRoot);
  fs.mkdirSync(publicTopicDir, { recursive: true });

  for (const filename of ["items.json", "sources.json", "metrics.json"]) {
    const inputFile = new URL(filename, topicDir);
    if (!fs.existsSync(inputFile)) continue;

    const raw = JSON.parse(fs.readFileSync(inputFile, "utf8"));
    const publicPayload = stripPrivateFields(raw);
    errors.push(...scanPublicPayload(publicPayload, `${topicId}/${filename}`));
    fs.writeFileSync(new URL(filename, publicTopicDir), `${JSON.stringify(publicPayload, null, 2)}\n`, "utf8");
    exported.push(path.posix.join("public-data/topics", topicId, filename));
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`exported ${exported.length} public data files`);
