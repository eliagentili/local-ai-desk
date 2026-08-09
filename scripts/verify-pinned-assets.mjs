/**
 * Re-downloads every pinned asset the bootstrap fetches and checks its SHA-256
 * against engine/runtime-manifest.json.
 *
 * A pinned digest only protects the user while the URL still serves the same
 * bytes. If an upstream release is deleted or retagged, the first person to find
 * out must not be someone whose installation stops halfway through, so this runs
 * on a schedule instead of at install time.
 *
 * Usage: node scripts/verify-pinned-assets.mjs
 */

import { createHash } from "node:crypto";

import { inspectRuntimeManifest } from "./check-runtime-manifest.mjs";

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function digestOf(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const hash = createHash("sha256");
  let size = 0;
  // Streamed, because these archives run to hundreds of megabytes and buffering
  // them all only to hash them would put the job at the mercy of the runner's RAM.
  for await (const chunk of response.body) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { digest: hash.digest("hex"), size };
}

const { manifest, problems, downloads } = await inspectRuntimeManifest();
if (problems.length > 0) {
  process.stderr.write("Manifest incoerente con gli script di bootstrap:\n");
  for (const problem of problems) process.stderr.write(`  ${problem}\n`);
  process.exit(1);
}

const failures = [];
for (const asset of downloads) {
  const expected = String(manifest.verifiedDownloads[asset.key]).replace(/^sha256:/, "");
  try {
    const { digest, size } = await digestOf(asset.url);
    if (digest !== expected) {
      failures.push(`${asset.key}: atteso ${expected}, ottenuto ${digest} (${asset.url})`);
    } else {
      process.stdout.write(`ok  ${asset.key.padEnd(30)} ${formatBytes(size).padStart(9)}  ${asset.url}\n`);
    }
  } catch (error) {
    failures.push(`${asset.key}: download non riuscito (${error.message}) — ${asset.url}`);
  }
}

if (failures.length > 0) {
  process.stderr.write("\nAsset pinnati non verificabili:\n");
  for (const failure of failures) process.stderr.write(`  ${failure}\n`);
  process.stderr.write(
    "\nSe l'origine ha ritirato o ripubblicato un asset, aggiorna versione e digest negli script di bootstrap e in engine/runtime-manifest.json nello stesso commit.\n",
  );
  process.exit(1);
}

process.stdout.write(`\n${downloads.length} asset pinnati verificati.\n`);
