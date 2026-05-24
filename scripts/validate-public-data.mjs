import fs from "node:fs";
import { scanPublicPayload, FORBIDDEN_TEXT_PATTERNS } from "./public-surface-rules.mjs";

const publicRoot = new URL("../public-data/", import.meta.url);
const pageFile = new URL("../index.html", import.meta.url);
const errors = [];
let files = 0;

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) {
      walk(child);
    } else if (entry.name.endsWith(".json")) {
      files += 1;
      const payload = JSON.parse(fs.readFileSync(child, "utf8"));
      errors.push(...scanPublicPayload(payload, child.pathname));
    }
  }
}

walk(publicRoot);

if (fs.existsSync(pageFile)) {
  const html = fs.readFileSync(pageFile, "utf8");
  for (const pattern of FORBIDDEN_TEXT_PATTERNS) {
    if (pattern.test(html)) errors.push(`index.html contains private maintenance text: ${pattern}`);
  }
  if (/fetch\(["']\.?\/?data\/topics\//.test(html) || /href=["']data\/topics\//.test(html)) {
    errors.push("index.html must use ./public-data/topics/* instead of raw ./data/topics/*");
  }
}

if (files === 0) errors.push("no public JSON files exported");

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`public data validated: ${files} JSON files`);
