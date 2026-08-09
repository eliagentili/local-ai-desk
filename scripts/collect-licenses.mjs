/**
 * Builds THIRD_PARTY_LICENSES.md from the artefacts that actually decide what
 * ships: the pinned Python locks under `engine/`, the resolved Cargo graph of
 * the native core and the non-dev half of `package-lock.json`.
 *
 * The previous inventory was written by hand and covered 16 components out of
 * roughly 290, so LGPL and FFmpeg-derived packages were absent from a document
 * that called itself the verified matrix. Anything hand-written drifts; this is
 * generated, and `--check` fails the build when the committed file no longer
 * matches its sources.
 *
 * Usage:
 *   node scripts/collect-licenses.mjs                    # write the inventory
 *   node scripts/collect-licenses.mjs --check            # fail if it is stale
 *   node scripts/collect-licenses.mjs --requirements-out <dir>
 *
 * `--requirements-out` writes one plain `requirements-<env>.txt` per lock. The
 * SBOM cataloguer only looks at files whose name matches `*requirements*.txt`,
 * which is why an SBOM generated from this repository listed 21 pypi packages
 * instead of the ~290 the locks install.
 */

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(repositoryRoot, "THIRD_PARTY_LICENSES.md");
// Inside the repository rather than the shared temp directory: a predictable
// name under a world-writable path lets any other account on the machine decide
// what this script reads, and the answer ends up in a published licence file.
const cachePath = join(repositoryRoot, ".cache", "pypi-licenses.json");
const PYPI_CONCURRENCY = 8;

/**
 * One entry per lock, in the order a reader meets them: the engines first,
 * because that is what the app installs on the user's device.
 */
const PYTHON_ENVIRONMENTS = [
  { id: "runtime-macos", label: "Motori (macOS)", lock: "engine/requirements-runtime-macos.lock" },
  { id: "runtime-windows", label: "Motori (Windows)", lock: "engine/requirements-runtime-windows.lock" },
  {
    id: "translation-macos",
    label: "Traduzione PDF (macOS)",
    lock: "engine/requirements-translation-macos.lock",
  },
  {
    id: "translation-windows",
    label: "Traduzione PDF (Windows)",
    lock: "engine/requirements-translation-windows.lock",
  },
  {
    id: "translation-overrides",
    label: "Traduzione PDF (override)",
    lock: "engine/requirements-translation-overrides.lock",
  },
];

/**
 * PyPI metadata is the source of truth, but a handful of projects ship neither a
 * license expression nor an OSI classifier. Each entry below was read from the
 * project's own LICENSE file at the pinned version; without them the run fails
 * rather than printing "unknown", because an inventory with holes is what this
 * script exists to replace.
 */
const LICENSE_OVERRIDES = new Map([
  ["fsspec==2026.7.0", "BSD-3-Clause"],
  ["azure-core==1.41.0", "MIT"],
  ["gradio==5.35.0", "Apache-2.0"],
  ["peewee==4.3.0", "MIT"],
  ["tiktoken==0.13.0", "MIT"],
]);

const CLASSIFIER_TO_SPDX = new Map([
  ["License :: OSI Approved :: Apache Software License", "Apache-2.0"],
  ["License :: OSI Approved :: MIT License", "MIT"],
  ["License :: OSI Approved :: MIT No Attribution License (MIT-0)", "MIT-0"],
  ["License :: OSI Approved :: BSD License", "BSD-3-Clause o BSD-2-Clause (vedi sorgente)"],
  ["License :: OSI Approved :: ISC License (ISCL)", "ISC"],
  ["License :: OSI Approved :: Mozilla Public License 2.0 (MPL 2.0)", "MPL-2.0"],
  ["License :: OSI Approved :: Python Software Foundation License", "PSF-2.0"],
  ["License :: OSI Approved :: Zope Public License", "ZPL-2.1"],
  ["License :: OSI Approved :: The Unlicense (Unlicense)", "Unlicense"],
  ["License :: OSI Approved :: Universal Permissive License (UPL)", "UPL-1.0"],
  ["License :: OSI Approved :: Academic Free License (AFL)", "AFL-3.0"],
  ["License :: OSI Approved :: Artistic License", "Artistic-2.0"],
  ["License :: OSI Approved :: GNU General Public License v2 (GPLv2)", "GPL-2.0-only"],
  [
    "License :: OSI Approved :: GNU General Public License v2 or later (GPLv2+)",
    "GPL-2.0-or-later",
  ],
  ["License :: OSI Approved :: GNU General Public License v3 (GPLv3)", "GPL-3.0-only"],
  [
    "License :: OSI Approved :: GNU General Public License v3 or later (GPLv3+)",
    "GPL-3.0-or-later",
  ],
  [
    "License :: OSI Approved :: GNU Lesser General Public License v2 or later (LGPLv2+)",
    "LGPL-2.1-or-later",
  ],
  [
    "License :: OSI Approved :: GNU Lesser General Public License v3 (LGPLv3)",
    "LGPL-3.0-only",
  ],
  [
    "License :: OSI Approved :: GNU Lesser General Public License v3 or later (LGPLv3+)",
    "LGPL-3.0-or-later",
  ],
  ["License :: OSI Approved :: GNU Affero General Public License v3", "AGPL-3.0-only"],
  [
    "License :: OSI Approved :: GNU Affero General Public License v3 or later (AGPLv3+)",
    "AGPL-3.0-or-later",
  ],
  ["License :: OSI Approved :: Historical Permission Notice and Disclaimer (HPND)", "HPND"],
  ["License :: OSI Approved :: Eclipse Public License 2.0 (EPL-2.0)", "EPL-2.0"],
]);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function escapeCell(value) {
  // Backslash first: escaping the pipe before the backslash would turn a literal
  // `\` in a package name into the escape character of the pipe that follows it,
  // and the cell would break the table it is supposed to sit in.
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function normaliseDeclaredLicense(raw) {
  // Some projects paste the whole licence text into the free-text field. A wall
  // of text in a table cell is unreadable, so anything that looks like a licence
  // body — several lines, or very long — is treated as absent and resolved from
  // the override table instead.
  if (/\n/.test(raw.trim())) return null;
  const flat = raw.replace(/\s+/g, " ").trim();
  if (!flat || flat.length > 120) return null;
  return flat;
}

function licenseFromMetadata(info) {
  // A licence expression is machine-readable by definition (PEP 639), so it is
  // taken verbatim however long it is: torch alone declares six licences.
  const expression = (info.license_expression ?? "").replace(/\s+/g, " ").trim();
  if (expression) return expression;
  const classifiers = (info.classifiers ?? []).filter((entry) => entry.startsWith("License ::"));
  const mapped = classifiers
    .map((entry) => CLASSIFIER_TO_SPDX.get(entry))
    .filter((entry) => typeof entry === "string");
  if (mapped.length > 0) return [...new Set(mapped)].join(" o ");
  const declared = normaliseDeclaredLicense(info.license ?? "");
  if (declared) return declared;
  if (classifiers.length > 0) return classifiers.map((entry) => entry.split(" :: ").pop()).join(" o ");
  return null;
}

async function readCache() {
  try {
    return new Map(Object.entries(JSON.parse(await readFile(cachePath, "utf8"))));
  } catch {
    return new Map();
  }
}

async function writeCache(cache) {
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(Object.fromEntries(cache), null, 0)}\n`, "utf8");
}

function parseLock(contents) {
  const packages = [];
  for (const line of contents.split("\n")) {
    // Requirement lines start at column zero; hashes and comments are indented.
    const match = line.match(/^([A-Za-z0-9._-]+)==([A-Za-z0-9][A-Za-z0-9._+!-]*)/);
    if (match) packages.push({ name: match[1], version: match[2] });
  }
  if (packages.length === 0) throw new Error("nessun requisito riconosciuto nel lock");
  return packages;
}

async function readPythonEnvironments() {
  const environments = [];
  for (const environment of PYTHON_ENVIRONMENTS) {
    const contents = await readFile(join(repositoryRoot, environment.lock), "utf8");
    try {
      environments.push({ ...environment, packages: parseLock(contents) });
    } catch (error) {
      throw new Error(`${environment.lock}: ${error.message}`);
    }
  }
  return environments;
}

async function resolvePythonLicenses(environments) {
  const wanted = new Map();
  for (const environment of environments) {
    for (const pkg of environment.packages) {
      const key = `${pkg.name}==${pkg.version}`;
      const entry = wanted.get(key) ?? { ...pkg, environments: new Set() };
      entry.environments.add(environment.label);
      wanted.set(key, entry);
    }
  }

  const cache = await readCache();
  const missing = [...wanted.keys()].filter((key) => !cache.has(key));
  const failures = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(PYPI_CONCURRENCY, missing.length) }, async () => {
    while (index < missing.length) {
      const key = missing[index++];
      const { name, version } = wanted.get(key);
      const url = `https://pypi.org/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`;
      try {
        const response = await fetch(url, { headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        const license = licenseFromMetadata(body.info ?? {});
        if (license) cache.set(key, license);
        else failures.push(`${key}: nessuna licenza dichiarata nei metadati`);
      } catch (error) {
        failures.push(`${key}: ${error.message}`);
      }
    }
  });
  await Promise.all(workers);
  if (missing.length > 0) await writeCache(cache);

  const unresolved = [];
  const rows = [...wanted.values()]
    .map((entry) => {
      const key = `${entry.name}==${entry.version}`;
      const license = LICENSE_OVERRIDES.get(key) ?? cache.get(key);
      if (!license) unresolved.push(key);
      return {
        name: entry.name,
        version: entry.version,
        license: license ?? "",
        environments: [...entry.environments],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

  if (unresolved.length > 0) {
    const detail = failures.length > 0 ? `\n${failures.join("\n")}` : "";
    throw new Error(
      `licenza non determinata per ${unresolved.length} pacchetti Python: ${unresolved.join(", ")}${detail}`,
    );
  }
  return rows;
}

function cargoLicenses() {
  const raw = execFileSync("cargo", ["metadata", "--format-version", "1", "--locked"], {
    cwd: join(repositoryRoot, "src-tauri"),
    maxBuffer: 128 * 1024 * 1024,
    encoding: "utf8",
  });
  const metadata = JSON.parse(raw);
  const byId = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const roots = new Set(metadata.workspace_members);

  // Dev dependencies never reach the user's machine, so attributing them would
  // overstate what the binary contains. Everything else does: build scripts and
  // proc macros contribute code to the artefact we ship.
  const reachable = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    const node = nodes.get(id);
    if (!node) continue;
    for (const dependency of node.deps) {
      const kinds = dependency.dep_kinds ?? [];
      const shipped = kinds.length === 0 || kinds.some((kind) => kind.kind !== "dev");
      if (shipped) queue.push(dependency.pkg);
    }
  }

  const unresolved = [];
  const rows = [...reachable]
    .filter((id) => !roots.has(id))
    .map((id) => byId.get(id))
    .filter((pkg) => pkg)
    .map((pkg) => {
      const license =
        pkg.license ?? (pkg.license_file ? `vedi ${pkg.license_file} nel sorgente` : null);
      if (!license) unresolved.push(`${pkg.name} ${pkg.version}`);
      return { name: pkg.name, version: pkg.version, license: license ?? "" };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

  if (unresolved.length > 0) {
    throw new Error(`licenza non dichiarata per le crate: ${unresolved.join(", ")}`);
  }
  return rows;
}

async function npmLicenses() {
  const lock = JSON.parse(await readFile(join(repositoryRoot, "package-lock.json"), "utf8"));
  const unresolved = [];
  const rows = Object.entries(lock.packages ?? {})
    // The root entry is the app itself, and dev dependencies are build tools
    // that never enter the bundle: only what Vite compiles in is distributed.
    .filter(([path, entry]) => path.startsWith("node_modules/") && !entry.dev && !entry.devOptional)
    .map(([path, entry]) => {
      const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      if (!entry.license) unresolved.push(`${name} ${entry.version ?? ""}`.trim());
      return { name, version: entry.version ?? "", license: entry.license ?? "" };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (unresolved.length > 0) {
    throw new Error(`licenza non dichiarata per i pacchetti npm: ${unresolved.join(", ")}`);
  }
  return rows;
}

function renderTable(headers, rows) {
  const lines = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const row of rows) lines.push(`| ${row.map(escapeCell).join(" | ")} |`);
  return lines.join("\n");
}

function renderDocument({ python, rust, npm }) {
  const environmentSummary = PYTHON_ENVIRONMENTS.map(
    (environment) => `- **${environment.label}** — \`${environment.lock}\``,
  ).join("\n");

  return `# Inventario delle licenze di terze parti

<!-- Questo file è generato da scripts/collect-licenses.mjs. Non modificarlo a
mano: la CI rigenera l'inventario e fallisce se il contenuto non corrisponde più
ai lock, al grafo Cargo e a package-lock.json. -->

Local AI Desk 2 è distribuito con licenza AGPL-3.0-or-later. Questo file elenca
i componenti di terze parti che il prodotto installa o incorpora, con la
versione esatta e la licenza dichiarata dall'autore. È generato da:

${environmentSummary}
- **Core nativo** — grafo delle dipendenze non-dev risolto da \`src-tauri/Cargo.lock\`
- **Interfaccia** — dipendenze non-dev di \`package-lock.json\`

Per il testo integrale di ogni licenza fa fede il pacchetto originale: le
licenze permissive (MIT, BSD, Apache-2.0, ISC) richiedono che l'avviso di
copyright accompagni ogni copia, e il pacchetto lo contiene già nella
distribuzione che viene installata sul dispositivo.

Il riepilogo commentato dei componenti principali, con il motivo per cui ognuno
è presente, resta in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Motori Python (${python.length} pacchetti)

Installati sul dispositivo dell'utente da **Modelli → Installa motori**, con
hash verificati (\`--require-hashes\`). La colonna "Ambienti" dice in quale dei
lock il pacchetto compare.

${renderTable(
  ["Pacchetto", "Versione", "Licenza", "Ambienti"],
  python.map((row) => [row.name, row.version, row.license, row.environments.join(", ")]),
)}

## Core nativo Rust (${rust.length} crate)

Compilate dentro l'eseguibile dell'applicazione.

${renderTable(
  ["Crate", "Versione", "Licenza"],
  rust.map((row) => [row.name, row.version, row.license]),
)}

## Interfaccia (${npm.length} pacchetti npm)

Incluse nel bundle JavaScript servito dalla finestra dell'applicazione.

${renderTable(
  ["Pacchetto", "Versione", "Licenza"],
  npm.map((row) => [row.name, row.version, row.license]),
)}

## Modelli e strumenti scaricati a parte

Non sono pacchetti Python e non compaiono nelle tabelle sopra: l'app li scarica
durante l'installazione dei motori. Termini e origine sono elencati in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) e le versioni pinnate in
[engine/runtime-manifest.json](engine/runtime-manifest.json).
`;
}

async function writeRequirementsForSbom(directory, environments) {
  const target = resolve(directory);
  await mkdir(target, { recursive: true });
  const written = [];
  for (const environment of environments) {
    const filename = `requirements-${environment.id}.txt`;
    const body = environment.packages.map((pkg) => `${pkg.name}==${pkg.version}`).join("\n");
    await writeFile(
      join(target, filename),
      `# Generato da scripts/collect-licenses.mjs da ${environment.lock}.\n${body}\n`,
      "utf8",
    );
    written.push(filename);
  }
  return written;
}

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const requirementsIndex = args.indexOf("--requirements-out");
const requirementsOut = requirementsIndex >= 0 ? args[requirementsIndex + 1] : null;
if (requirementsIndex >= 0 && !requirementsOut) {
  fail("Uso: node scripts/collect-licenses.mjs [--check] [--requirements-out <cartella>]");
}

try {
  const environments = await readPythonEnvironments();

  if (requirementsOut) {
    const written = await writeRequirementsForSbom(requirementsOut, environments);
    process.stdout.write(`Scritti ${written.length} elenchi di requisiti per l'SBOM.\n`);
    // Deliberately the whole job: the SBOM step has neither a Rust toolchain nor
    // a reason to reach PyPI for licence metadata.
    process.exit(0);
  }

  const [python, npm] = await Promise.all([resolvePythonLicenses(environments), npmLicenses()]);
  const rust = cargoLicenses();
  const document = renderDocument({ python, rust, npm });

  if (checkOnly) {
    const current = await readFile(outputPath, "utf8").catch(() => "");
    if (current !== document) {
      fail(
        "THIRD_PARTY_LICENSES.md non è aggiornato rispetto ai lock: esegui `node scripts/collect-licenses.mjs` e includi il file nello stesso commit.",
      );
    }
    process.stdout.write(
      `Inventario licenze aggiornato: ${python.length} pacchetti Python, ${rust.length} crate, ${npm.length} pacchetti npm.\n`,
    );
  } else {
    await writeFile(outputPath, document, "utf8");
    process.stdout.write(
      `Scritto THIRD_PARTY_LICENSES.md: ${python.length} pacchetti Python, ${rust.length} crate, ${npm.length} pacchetti npm.\n`,
    );
  }
} catch (error) {
  fail(`Inventario licenze non generato: ${error.message}`);
}
