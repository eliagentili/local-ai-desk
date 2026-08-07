import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function exactlyOne(files, predicate, label) {
  const matches = files.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`${label}: atteso 1 file, trovati ${matches.length}\n${matches.join("\n")}`);
  }
  return matches[0];
}

function assetUrl(repository, tag, filename) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`;
}

async function copyAs(source, outputDirectory, filename) {
  await cp(source, join(outputDirectory, filename));
  return filename;
}

async function releaseNotes(notesFile) {
  if (!notesFile) return "Aggiornamento di Local AI Desk 2.";
  try {
    return await readFile(notesFile, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return "Aggiornamento di Local AI Desk 2.";
    }
    throw error;
  }
}

export async function prepareReleaseAssets({
  inputDirectory,
  outputDirectory,
  repository,
  tag,
  notesFile,
  publishedAt = new Date().toISOString(),
}) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error(`Tag release non valido: ${tag}`);
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`Repository non valido: ${repository}`);
  }

  const sourceRoot = resolve(inputDirectory);
  const outputRoot = resolve(outputDirectory);
  const files = await walk(sourceRoot);
  await mkdir(outputRoot, { recursive: true });

  const dmg = exactlyOne(files, (path) => path.endsWith(".dmg"), "Installer macOS");
  const macArchive = exactlyOne(files, (path) => path.endsWith(".app.tar.gz"), "Updater macOS");
  const macSignature = exactlyOne(files, (path) => path === `${macArchive}.sig`, "Firma updater macOS");
  const nsis = exactlyOne(files, (path) => /-setup\.exe$/i.test(path), "Installer NSIS");
  const nsisSignature = exactlyOne(files, (path) => path === `${nsis}.sig`, "Firma updater NSIS");
  const msi = exactlyOne(files, (path) => path.endsWith(".msi"), "Installer MSI");
  const msiSignature = exactlyOne(files, (path) => path === `${msi}.sig`, "Firma updater MSI");
  const sbom = exactlyOne(files, (path) => path.endsWith(".spdx.json"), "SBOM SPDX");

  const names = {
    dmg: "Local-AI-Desk-macOS-Apple-Silicon.dmg",
    macArchive: "Local-AI-Desk-macOS-Apple-Silicon.app.tar.gz",
    macSignature: "Local-AI-Desk-macOS-Apple-Silicon.app.tar.gz.sig",
    nsis: "Local-AI-Desk-Windows-x64-Setup.exe",
    nsisSignature: "Local-AI-Desk-Windows-x64-Setup.exe.sig",
    msi: "Local-AI-Desk-Windows-x64.msi",
    msiSignature: "Local-AI-Desk-Windows-x64.msi.sig",
    sbom: "local-ai-desk-source.spdx.json",
  };

  await Promise.all([
    copyAs(dmg, outputRoot, names.dmg),
    copyAs(macArchive, outputRoot, names.macArchive),
    copyAs(macSignature, outputRoot, names.macSignature),
    copyAs(nsis, outputRoot, names.nsis),
    copyAs(nsisSignature, outputRoot, names.nsisSignature),
    copyAs(msi, outputRoot, names.msi),
    copyAs(msiSignature, outputRoot, names.msiSignature),
    copyAs(sbom, outputRoot, names.sbom),
  ]);

  const [macSignatureBody, windowsSignatureBody, notes] = await Promise.all([
    readFile(macSignature, "utf8"),
    readFile(nsisSignature, "utf8"),
    releaseNotes(notesFile),
  ]);

  const manifest = {
    version: tag.slice(1),
    notes: notes.trim(),
    pub_date: publishedAt,
    platforms: {
      "darwin-aarch64": {
        signature: macSignatureBody.trim(),
        url: assetUrl(repository, tag, names.macArchive),
      },
      "windows-x86_64": {
        signature: windowsSignatureBody.trim(),
        url: assetUrl(repository, tag, names.nsis),
      },
    },
  };
  await writeFile(join(outputRoot, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const releaseFiles = (await readdir(outputRoot)).filter((name) => name !== "SHA256SUMS.txt").sort();
  const checksumLines = [];
  for (const filename of releaseFiles) {
    const content = await readFile(join(outputRoot, filename));
    checksumLines.push(`${createHash("sha256").update(content).digest("hex")}  ${filename}`);
  }
  await writeFile(join(outputRoot, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`, "utf8");

  return { manifest, assets: [...releaseFiles, "SHA256SUMS.txt"] };
}

const invokedDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  const [inputDirectory, outputDirectory] = process.argv.slice(2);
  if (!inputDirectory || !outputDirectory) {
    throw new Error("Uso: node scripts/prepare-release-assets.mjs <input> <output>");
  }
  const notesFile = process.env.RELEASE_NOTES_FILE || undefined;
  const result = await prepareReleaseAssets({
    inputDirectory,
    outputDirectory,
    repository: process.env.GITHUB_REPOSITORY ?? "",
    tag: process.env.RELEASE_TAG ?? "",
    notesFile,
    publishedAt: process.env.RELEASE_PUBLISHED_AT || new Date().toISOString(),
  });
  process.stdout.write(`Prepared ${result.assets.length} signed release assets.\n`);
}
