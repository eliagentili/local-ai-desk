import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { inspectRuntimeManifest } from "./check-runtime-manifest.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A copy of the repository's engine tree, so a test can spoil one value. */
async function engineCopy() {
  const root = await mkdtemp(join(tmpdir(), "local-ai-desk-manifest-"));
  await cp(join(repositoryRoot, "engine"), join(root, "engine"), { recursive: true });
  return root;
}

async function editManifest(root, mutate) {
  const path = join(root, "engine/runtime-manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  mutate(manifest);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

test("il manifest del runtime coincide con gli script di bootstrap", async () => {
  const { problems, downloads } = await inspectRuntimeManifest();
  assert.deepEqual(problems, []);
  assert.equal(downloads.length, 5);
  for (const download of downloads) {
    assert.match(download.url, /^https:\/\//);
    assert.match(download.digest, /^[0-9a-f]{64}$/);
  }
});

test("una versione bumpata solo nel manifest viene segnalata", async () => {
  const root = await engineCopy();
  await editManifest(root, (manifest) => {
    manifest.components.uv = "9.9.9";
  });
  const { problems } = await inspectRuntimeManifest(root);
  assert.equal(problems.filter((problem) => problem.includes("versione di uv")).length, 2);
});

test("un digest che non corrisponde più all'asset viene segnalato", async () => {
  const root = await engineCopy();
  await editManifest(root, (manifest) => {
    manifest.verifiedDownloads["ollama-macos"] = `sha256:${"0".repeat(64)}`;
  });
  const { problems } = await inspectRuntimeManifest(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /digest di ollama-macos/);
});

test("un lock modificato senza aggiornare il manifest viene segnalato", async () => {
  const root = await engineCopy();
  const lock = join(root, "engine/requirements-translation-overrides.lock");
  await writeFile(lock, `${await readFile(lock, "utf8")}\n# riga aggiunta a mano\n`, "utf8");
  const { problems } = await inspectRuntimeManifest(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /requirements-translation-overrides\.lock/);
});

test("un modello dichiarato ma non scaricato viene segnalato", async () => {
  const root = await engineCopy();
  await editManifest(root, (manifest) => {
    manifest.components["ollama-models"] = ["glm-ocr", "un-modello-inventato"];
  });
  const { problems } = await inspectRuntimeManifest(root);
  assert.equal(problems.length, 2);
  for (const problem of problems) assert.match(problem, /un-modello-inventato/);
});
