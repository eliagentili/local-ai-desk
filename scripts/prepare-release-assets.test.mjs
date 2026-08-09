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

/** The artefacts the workflow downloads before calling the script. */
async function downloadedArtifacts(input) {
  await Promise.all([
    fixture(input, "mac/Local AI Desk 2_0.5.0_aarch64.dmg", "dmg"),
    fixture(input, "mac/Local AI Desk 2.app.tar.gz", "mac-update"),
    fixture(input, "updater-mac/Local AI Desk 2.app.tar.gz.sig", "mac-signature\n"),
    fixture(input, "nsis/Local AI Desk 2_0.5.0_x64-setup.exe", "nsis"),
    fixture(input, "updater-windows/Local AI Desk 2_0.5.0_x64-setup.exe.sig", "windows-signature\n"),
    fixture(input, "msi/Local AI Desk 2_0.5.0_x64.msi", "msi"),
    fixture(input, "updater-windows/Local AI Desk 2_0.5.0_x64.msi.sig", "msi-signature\n"),
    fixture(input, "sbom/local-ai-desk-source.spdx.json", "{}"),
    fixture(input, "licenses/THIRD_PARTY_LICENSES.md", "# Inventario\n"),
  ]);
}

test("prepara installer, firme, manifest updater e checksum", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-ai-desk-release-"));
  const input = join(root, "input");
  const output = join(root, "output");
  await downloadedArtifacts(input);
  const notes = await fixture(root, "notes.md", "Note firmate\n");

  const result = await prepareReleaseAssets({
    inputDirectory: input,
    outputDirectory: output,
    repository: "eliagentili/local-ai-desk",
    tag: "v1.0.0",
    notesFile: notes,
    publishedAt: "2026-08-09T10:00:00.000Z",
  });

  assert.equal(result.manifest.version, "1.0.0");
  assert.equal(result.manifest.notes, "Note firmate");
  assert.equal(result.manifest.platforms["darwin-aarch64"].signature, "mac-signature");
  assert.equal(result.manifest.platforms["windows-x86_64"].signature, "windows-signature");
  assert.match(
    result.manifest.platforms["windows-x86_64"].url,
    /v1\.0\.0\/Local-AI-Desk-Windows-x64-Setup\.exe$/,
  );
  assert.equal(await readFile(join(output, "Local-AI-Desk-macOS-Apple-Silicon.dmg"), "utf8"), "dmg");
  assert.equal(await readFile(join(output, "THIRD_PARTY_LICENSES.md"), "utf8"), "# Inventario\n");

  const checksums = await readFile(join(output, "SHA256SUMS.txt"), "utf8");
  assert.match(checksums, /latest\.json/);
  assert.match(checksums, /Local-AI-Desk-Windows-x64\.msi\.sig/);
  assert.match(checksums, /THIRD_PARTY_LICENSES\.md/);
  assert.match(checksums, /local-ai-desk-updater\.pub/);
  assert.match(checksums, /VERIFICA-DOWNLOAD\.txt/);
  assert.doesNotMatch(checksums, /SHA256SUMS\.txt/);
  assert.equal(result.assets.length, 13);
});

test("una stabile pubblica latest.json e non beta.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-ai-desk-release-stable-"));
  const input = join(root, "input");
  const output = join(root, "output");
  await downloadedArtifacts(input);

  const result = await prepareReleaseAssets({
    inputDirectory: input,
    outputDirectory: output,
    repository: "eliagentili/local-ai-desk",
    tag: "v1.0.0",
    publishedAt: "2026-08-09T10:00:00.000Z",
  });

  assert.equal(result.prerelease, false);
  assert.equal(result.manifestName, "latest.json");
  assert.ok(result.assets.includes("latest.json"));
  assert.ok(!result.assets.includes("beta.json"));
});

// A beta that lands on the stable manifest name reaches every 1.0 installation
// the moment GitHub calls that release "latest". The tag suffix is the only
// signal available before publication, so it is the one that decides.
test("una prerelease pubblica beta.json e non latest.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-ai-desk-release-beta-"));
  const input = join(root, "input");
  const output = join(root, "output");
  await downloadedArtifacts(input);

  const result = await prepareReleaseAssets({
    inputDirectory: input,
    outputDirectory: output,
    repository: "eliagentili/local-ai-desk",
    tag: "v1.1.0-beta.1",
    publishedAt: "2026-08-09T10:00:00.000Z",
  });

  assert.equal(result.prerelease, true);
  assert.equal(result.manifestName, "beta.json");
  assert.ok(result.assets.includes("beta.json"));
  assert.ok(!result.assets.includes("latest.json"));
  const sheet = await readFile(join(output, "VERIFICA-DOWNLOAD.txt"), "utf8");
  assert.match(sheet, /Canale: beta/);
});

test("pubblica la chiave pubblica dell'updater e le istruzioni di verifica", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-ai-desk-release-verify-"));
  const input = join(root, "input");
  const output = join(root, "output");
  await downloadedArtifacts(input);

  await prepareReleaseAssets({
    inputDirectory: input,
    outputDirectory: output,
    repository: "eliagentili/local-ai-desk",
    tag: "v1.0.0",
    publishedAt: "2026-08-09T10:00:00.000Z",
  });

  const key = await readFile(join(output, "local-ai-desk-updater.pub"), "utf8");
  assert.match(key, /minisign public key/);
  // The key on the release has to be the one compiled into the app, otherwise
  // the instructions verify a signature nobody can check against the installer.
  const conf = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
  assert.equal(key.trim(), Buffer.from(conf.plugins.updater.pubkey, "base64").toString("utf8").trim());

  const sheet = await readFile(join(output, "VERIFICA-DOWNLOAD.txt"), "utf8");
  assert.match(sheet, /SHA256SUMS\.txt/);
  assert.match(sheet, /minisign -V/);
  assert.match(sheet, /non è firmato con un certificato Apple né Authenticode/);
});
