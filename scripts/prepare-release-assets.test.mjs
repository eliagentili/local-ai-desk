import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { prepareReleaseAssets } from "./prepare-release-assets.mjs";

async function fixture(root, relativePath, content) {
  const path = join(root, relativePath);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content);
  return path;
}

test("prepara installer, firme, manifest updater e checksum", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-ai-desk-release-"));
  const input = join(root, "input");
  const output = join(root, "output");
  await Promise.all([
    fixture(input, "mac/Local AI Desk 2_0.5.0_aarch64.dmg", "dmg"),
    fixture(input, "mac/Local AI Desk 2.app.tar.gz", "mac-update"),
    fixture(input, "updater-mac/Local AI Desk 2.app.tar.gz.sig", "mac-signature\n"),
    fixture(input, "nsis/Local AI Desk 2_0.5.0_x64-setup.exe", "nsis"),
    fixture(input, "updater-windows/Local AI Desk 2_0.5.0_x64-setup.exe.sig", "windows-signature\n"),
    fixture(input, "msi/Local AI Desk 2_0.5.0_x64.msi", "msi"),
    fixture(input, "updater-windows/Local AI Desk 2_0.5.0_x64.msi.sig", "msi-signature\n"),
    fixture(input, "sbom/local-ai-desk-source.spdx.json", "{}"),
  ]);
  const notes = await fixture(root, "notes.md", "Note firmate\n");

  const result = await prepareReleaseAssets({
    inputDirectory: input,
    outputDirectory: output,
    repository: "eliagentili/local-ai-desk",
    tag: "v0.5.0-beta.1",
    notesFile: notes,
    publishedAt: "2026-08-07T10:00:00.000Z",
  });

  assert.equal(result.manifest.version, "0.5.0-beta.1");
  assert.equal(result.manifest.notes, "Note firmate");
  assert.equal(result.manifest.platforms["darwin-aarch64"].signature, "mac-signature");
  assert.equal(result.manifest.platforms["windows-x86_64"].signature, "windows-signature");
  assert.match(result.manifest.platforms["windows-x86_64"].url, /v0\.5\.0-beta\.1\/Local-AI-Desk-Windows-x64-Setup\.exe$/);
  assert.equal(await readFile(join(output, "Local-AI-Desk-macOS-Apple-Silicon.dmg"), "utf8"), "dmg");

  const checksums = await readFile(join(output, "SHA256SUMS.txt"), "utf8");
  assert.match(checksums, /latest\.json/);
  assert.match(checksums, /Local-AI-Desk-Windows-x64\.msi\.sig/);
  assert.doesNotMatch(checksums, /SHA256SUMS\.txt/);
  assert.equal(result.assets.length, 10);
});
