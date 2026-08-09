/**
 * Keeps engine/runtime-manifest.json honest.
 *
 * The manifest is what the bundle ships as the record of what the app installs,
 * and until now nothing read it: the values happened to agree with the bootstrap
 * scripts, and a version bumped in one script alone would have published a
 * manifest that lies. This module compares the two, recomputes the digests of
 * the lock files it claims to describe, and exposes the download list that
 * scripts/verify-pinned-assets.mjs re-downloads on a schedule.
 *
 * Usage: node scripts/check-runtime-manifest.mjs
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const MANIFEST = "engine/runtime-manifest.json";
const MACOS_SCRIPT = "engine/scripts/bootstrap-macos.sh";
const WINDOWS_SCRIPT = "engine/scripts/bootstrap-windows.ps1";

const LOCK_FILES = {
  "runtime-macos": "engine/requirements-runtime-macos.lock",
  "runtime-windows": "engine/requirements-runtime-windows.lock",
  "translation-macos": "engine/requirements-translation-macos.lock",
  "translation-windows": "engine/requirements-translation-windows.lock",
  "translation-overrides": "engine/requirements-translation-overrides.lock",
};

function stripDigestPrefix(value) {
  return String(value ?? "").replace(/^sha256:/, "");
}

/**
 * Top-level assignments of both scripts, so a URL that interpolates the pinned
 * version can be expanded into the address the bootstrap actually requests.
 * Without this the checker would only prove that a literal containing `$var`
 * exists, which is what a 404 on every asset looked like.
 */
function scriptVariables(source) {
  const variables = new Map();
  for (const [, name, value] of source.matchAll(/^(?:\$)?([A-Za-z_]\w*)\s*=\s*"([^"]*)"/gm)) {
    variables.set(name, value);
  }
  return variables;
}

function expand(url, variables) {
  if (!url) return url;
  return url.replace(/\$(\w+)/g, (whole, name) => variables.get(name) ?? whole);
}

function firstMatch(source, pattern, label, problems) {
  const match = source.match(pattern);
  if (!match) {
    problems.push(`${label}: valore non trovato nello script di bootstrap`);
    return null;
  }
  return match[1];
}

function compare(problems, label, expected, actual) {
  if (expected === null || actual === null) return;
  if (expected !== actual) problems.push(`${label}: manifest ${expected}, script ${actual}`);
}

/**
 * Reads the manifest, both bootstrap scripts and the locks, and returns the
 * problems found plus the pinned downloads described by the three of them
 * together: the manifest holds the digests, the scripts hold the URLs.
 */
export async function inspectRuntimeManifest(root = repositoryRoot) {
  const [manifestRaw, macos, windows] = await Promise.all([
    readFile(join(root, MANIFEST), "utf8"),
    readFile(join(root, MACOS_SCRIPT), "utf8"),
    readFile(join(root, WINDOWS_SCRIPT), "utf8"),
  ]);
  const manifest = JSON.parse(manifestRaw);
  const problems = [];

  const macUvVersion = firstMatch(macos, /^uv_version="([^"]+)"/m, "uv (macOS)", problems);
  const winUvVersion = firstMatch(windows, /^\$UvVersion\s*=\s*"([^"]+)"/m, "uv (Windows)", problems);
  compare(problems, "versione di uv (macOS)", manifest.components.uv, macUvVersion);
  compare(problems, "versione di uv (Windows)", manifest.components.uv, winUvVersion);

  const macOllamaVersion = firstMatch(macos, /^ollama_version="v?([^"]+)"/m, "Ollama (macOS)", problems);
  const winOllamaVersion = firstMatch(
    windows,
    /^\$OllamaVersion\s*=\s*"v?([^"]+)"/m,
    "Ollama (Windows)",
    problems,
  );
  compare(problems, "versione di Ollama (macOS)", manifest.components.ollama, macOllamaVersion);
  compare(problems, "versione di Ollama (Windows)", manifest.components.ollama, winOllamaVersion);

  const digests = [
    {
      key: "uv-macos-aarch64",
      script: MACOS_SCRIPT,
      digest: firstMatch(macos, /^uv_sha256="([0-9a-f]{64})"/m, "digest di uv (macOS)", problems),
      url: firstMatch(
        macos,
        /(https:\/\/github\.com\/astral-sh\/uv\/releases\/download\/[^"\s]*uv-aarch64-apple-darwin\.tar\.gz)/,
        "URL di uv (macOS)",
        problems,
      ),
    },
    {
      key: "uv-windows-x86_64",
      script: WINDOWS_SCRIPT,
      digest: firstMatch(windows, /^\$UvSha256\s*=\s*"([0-9a-f]{64})"/m, "digest di uv (Windows)", problems),
      url: firstMatch(
        windows,
        /(https:\/\/github\.com\/astral-sh\/uv\/releases\/download\/[^"\s]*uv-x86_64-pc-windows-msvc\.zip)/,
        "URL di uv (Windows)",
        problems,
      ),
    },
    {
      key: "ollama-macos",
      script: MACOS_SCRIPT,
      digest: firstMatch(macos, /^ollama_sha256="([0-9a-f]{64})"/m, "digest di Ollama (macOS)", problems),
      url: firstMatch(
        macos,
        /(https:\/\/github\.com\/ollama\/ollama\/releases\/download\/[^"\s]*Ollama-darwin\.zip)/,
        "URL di Ollama (macOS)",
        problems,
      ),
    },
    {
      key: "ollama-windows-x86_64",
      script: WINDOWS_SCRIPT,
      digest: firstMatch(
        windows,
        /^\$OllamaSha256\s*=\s*"([0-9a-f]{64})"/m,
        "digest di Ollama (Windows)",
        problems,
      ),
      url: firstMatch(
        windows,
        /(https:\/\/github\.com\/ollama\/ollama\/releases\/download\/[^"\s]*ollama-windows-amd64\.zip)/,
        "URL di Ollama (Windows)",
        problems,
      ),
    },
    {
      key: "openai-privacy-filter-source",
      script: MACOS_SCRIPT,
      digest: firstMatch(
        macos,
        /^privacy_sha256="([0-9a-f]{64})"/m,
        "digest del Privacy Filter (macOS)",
        problems,
      ),
      url: firstMatch(
        macos,
        /(https:\/\/github\.com\/openai\/privacy-filter\/archive\/[0-9a-f]{40}\.zip)/,
        "URL del Privacy Filter",
        problems,
      ),
    },
  ];

  const variables = new Map([...scriptVariables(macos), ...scriptVariables(windows)]);
  for (const entry of digests) {
    entry.url = expand(entry.url, variables);
    if (entry.url && entry.url.includes("$")) {
      problems.push(`URL di ${entry.key}: variabile non risolta in ${entry.url}`);
    }
    compare(
      problems,
      `digest di ${entry.key}`,
      stripDigestPrefix(manifest.verifiedDownloads?.[entry.key]),
      entry.digest,
    );
  }

  // The Windows script downloads the same Privacy Filter archive, so its digest
  // has to agree with the macOS one as well: two scripts, one pinned revision.
  const windowsPrivacyDigest = firstMatch(
    windows,
    /^\$PrivacySha256\s*=\s*"([0-9a-f]{64})"/m,
    "digest del Privacy Filter (Windows)",
    problems,
  );
  compare(
    problems,
    "digest di openai-privacy-filter-source (Windows)",
    stripDigestPrefix(manifest.verifiedDownloads?.["openai-privacy-filter-source"]),
    windowsPrivacyDigest,
  );

  const revision = manifest.components["openai-privacy-filter"];
  for (const [label, source] of [
    ["macOS", macos],
    ["Windows", windows],
  ]) {
    if (!source.includes(`privacy-filter/archive/${revision}.zip`)) {
      problems.push(`revisione del Privacy Filter ${revision}: non usata dallo script ${label}`);
    }
  }

  for (const model of manifest.components["ollama-models"] ?? []) {
    for (const [label, source] of [
      ["macOS", macos],
      ["Windows", windows],
    ]) {
      if (!source.includes(model)) {
        problems.push(`modello Ollama ${model}: non scaricato dallo script ${label}`);
      }
    }
  }

  const whisper = manifest.components["faster-whisper-model"];
  for (const [label, source] of [
    ["macOS", macos],
    ["Windows", windows],
  ]) {
    if (!source.includes(`WhisperModel("${whisper}"`)) {
      problems.push(`modello Whisper ${whisper}: non scaricato dallo script ${label}`);
    }
  }

  for (const [key, path] of Object.entries(LOCK_FILES)) {
    const declared = stripDigestPrefix(manifest.lockedEnvironments?.[key]);
    const actual = createHash("sha256")
      .update(await readFile(join(root, path)))
      .digest("hex");
    if (declared !== actual) {
      problems.push(`digest di ${path}: manifest ${declared || "assente"}, file ${actual}`);
    }
    // A lock the bootstrap never installs would be dead weight in the bundle.
    const installedByEither = macos.includes(path.replace("engine/", "")) || windows.includes(path.replace("engine/", ""));
    if (!installedByEither) problems.push(`${path}: nessuno script di bootstrap lo installa`);
  }

  return { manifest, problems, downloads: digests };
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { problems, downloads } = await inspectRuntimeManifest();
  if (problems.length > 0) {
    process.stderr.write("engine/runtime-manifest.json non corrisponde agli script di bootstrap:\n");
    for (const problem of problems) process.stderr.write(`  ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `Manifest del runtime coerente: ${downloads.length} download pinnati e ${Object.keys(LOCK_FILES).length} lock verificati.\n`,
  );
}
