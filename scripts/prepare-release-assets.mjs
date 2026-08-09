import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The name of the public key asset, referenced by the verification sheet. */
const PUBLIC_KEY_NAME = "local-ai-desk-updater.pub";
const VERIFICATION_NAME = "VERIFICA-DOWNLOAD.txt";

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

/**
 * The public key the app compiles in, in the form minisign expects. Publishing it
 * next to the installers is what lets someone verify a download without trusting
 * the page they downloaded it from.
 */
async function updaterPublicKey() {
  const conf = JSON.parse(
    await readFile(join(repositoryRoot, "src-tauri/tauri.conf.json"), "utf8"),
  );
  const encoded = conf?.plugins?.updater?.pubkey;
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new Error("Chiave pubblica dell'updater assente da src-tauri/tauri.conf.json");
  }
  const body = Buffer.from(encoded, "base64").toString("utf8").trim();
  if (!body.includes("minisign public key")) {
    throw new Error("Chiave pubblica dell'updater in un formato inatteso");
  }
  return `${body}\n`;
}

function verificationSheet({ repository, tag, names, prerelease }) {
  const channel = prerelease ? "beta" : "stabile";
  return `Local AI Desk 2 ${tag} — come verificare ciò che hai scaricato
Canale: ${channel}
Sorgente: https://github.com/${repository}/releases/tag/${tag}

Local AI Desk non è firmato con un certificato Apple né Authenticode: al primo
avvio macOS e Windows avvisano che l'origine non è verificata. È un limite
dichiarato, non un problema del file. Proprio per questo ogni file pubblicato ha
un'impronta SHA-256 e l'elenco delle impronte è firmato con la stessa chiave che
firma gli aggiornamenti dell'app.

1) Impronte dei file

   macOS o Linux, nella cartella dei download:
     shasum -a 256 -c SHA256SUMS.txt --ignore-missing

   Windows, in PowerShell:
     Get-FileHash .\\${names.nsis} -Algorithm SHA256

   Il valore deve comparire in SHA256SUMS.txt accanto al nome del file.

2) Firma dell'elenco delle impronte

   Serve minisign (macOS: brew install minisign) e i due file
   SHA256SUMS.txt.sig e ${PUBLIC_KEY_NAME} pubblicati con questa release.
   La firma è in base64, come quelle dell'updater, quindi va prima decodificata:

     base64 -d SHA256SUMS.txt.sig > SHA256SUMS.txt.minisig
     minisign -V -p ${PUBLIC_KEY_NAME} -x SHA256SUMS.txt.minisig -m SHA256SUMS.txt

   Se minisign risponde "Signature and comment signature verified", l'elenco
   arriva da chi pubblica l'app e le impronte al punto 1 sono attendibili.

3) Aggiornamenti successivi

   L'app scarica solo pacchetti la cui firma corrisponde alla chiave pubblica
   compilata al suo interno, la stessa che trovi in ${PUBLIC_KEY_NAME}. Un
   pacchetto con firma diversa viene rifiutato e l'installazione si ferma.

Contenuto della release: ${Object.values(names).join(", ")}.
`;
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
  const macSignature = exactlyOne(
    files,
    (path) => basename(path) === `${basename(macArchive)}.sig`,
    "Firma updater macOS",
  );
  const nsis = exactlyOne(files, (path) => /-setup\.exe$/i.test(path), "Installer NSIS");
  const nsisSignature = exactlyOne(
    files,
    (path) => basename(path) === `${basename(nsis)}.sig`,
    "Firma updater NSIS",
  );
  const msi = exactlyOne(files, (path) => path.endsWith(".msi"), "Installer MSI");
  const msiSignature = exactlyOne(
    files,
    (path) => basename(path) === `${basename(msi)}.sig`,
    "Firma updater MSI",
  );
  const sbom = exactlyOne(files, (path) => path.endsWith(".spdx.json"), "SBOM SPDX");
  const licenses = exactlyOne(
    files,
    (path) => basename(path) === "THIRD_PARTY_LICENSES.md",
    "Inventario licenze",
  );

  const names = {
    dmg: "Local-AI-Desk-macOS-Apple-Silicon.dmg",
    macArchive: "Local-AI-Desk-macOS-Apple-Silicon.app.tar.gz",
    macSignature: "Local-AI-Desk-macOS-Apple-Silicon.app.tar.gz.sig",
    nsis: "Local-AI-Desk-Windows-x64-Setup.exe",
    nsisSignature: "Local-AI-Desk-Windows-x64-Setup.exe.sig",
    msi: "Local-AI-Desk-Windows-x64.msi",
    msiSignature: "Local-AI-Desk-Windows-x64.msi.sig",
    sbom: "local-ai-desk-source.spdx.json",
    licenses: "THIRD_PARTY_LICENSES.md",
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
    copyAs(licenses, outputRoot, names.licenses),
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

  // Channel separation by file name. A prerelease publishes `beta.json` only, so
  // an installation on the stable channel — which asks for `latest.json` under
  // `releases/latest` — cannot be handed a beta even if GitHub's idea of "latest"
  // ever changes. Doing this before the 1.0 means there is never a stable
  // installed base to protect retroactively.
  const prerelease = tag.includes("-");
  const manifestName = prerelease ? "beta.json" : "latest.json";
  await writeFile(join(outputRoot, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await writeFile(join(outputRoot, PUBLIC_KEY_NAME), await updaterPublicKey(), "utf8");
  await writeFile(
    join(outputRoot, VERIFICATION_NAME),
    verificationSheet({ repository, tag, names, prerelease }),
    "utf8",
  );

  const releaseFiles = (await readdir(outputRoot)).filter((name) => name !== "SHA256SUMS.txt").sort();
  const checksumLines = [];
  for (const filename of releaseFiles) {
    const content = await readFile(join(outputRoot, filename));
    checksumLines.push(`${createHash("sha256").update(content).digest("hex")}  ${filename}`);
  }
  await writeFile(join(outputRoot, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`, "utf8");

  return { manifest, manifestName, prerelease, assets: [...releaseFiles, "SHA256SUMS.txt"] };
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
  // The publishing step needs both facts, and deriving them twice — once here,
  // once in shell — is how the two would eventually disagree.
  if (process.env.GITHUB_OUTPUT) {
    await writeFile(
      process.env.GITHUB_OUTPUT,
      `prerelease=${result.prerelease}\nmanifest=${result.manifestName}\n`,
      { encoding: "utf8", flag: "a" },
    );
  }
}
