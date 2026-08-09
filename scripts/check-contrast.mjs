/**
 * Contrast gate for the design tokens in src/App.css.
 *
 * The dark theme once shipped twelve texts and three icons below AA — the
 * updater's own error message sat at 1.40:1 — because the state colours were
 * written as literals next to the component that needed them and the dark block
 * only remapped the tokens. The literals are gone; this script is what stops
 * them coming back unmeasured.
 *
 * It reads the token definitions from the `:root` block and from the `:root`
 * inside `@media (prefers-color-scheme: dark)`, resolves `var()` chains,
 * composites every alpha over the surface it actually sits on, and fails under
 * 4.5:1 for text and 3:1 for the borders and fills that carry a control's
 * meaning. Pure dividers are out of scope on purpose: WCAG 1.4.11 covers the
 * boundaries you need to see to use a control, not decoration.
 *
 * Usage: node scripts/check-contrast.mjs
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cssPath = join(repositoryRoot, "src/App.css");

const TEXT_MINIMUM = 4.5;
const NON_TEXT_MINIMUM = 3;

/** Opaque panels a component can sit on, bottom layer first. */
const PANELS = [
  ["--canvas"],
  ["--canvas", "--surface-1"],
  ["--canvas", "--surface-2"],
  ["--canvas", "--surface-3"],
  ["--canvas", "--surface-4"],
  ["--paper"],
  ["--paper-strong"],
];

/**
 * Panels that can contain a card, a plate or a button. `--surface-4` and
 * `--paper-strong` are left out on purpose: they are the fill of a single small
 * control — the switch knob, the search field, a secondary button on hover, the
 * skip link — and nothing nests a status plate or a progress bar inside them.
 * Measuring a tint against them would invent a combination the app never paints.
 */
const CONTAINER_PANELS = PANELS.filter(
  (panel) => !panel.includes("--surface-4") && !panel.includes("--paper-strong"),
);

/** Same panels with a state tint painted on top, as every status plate does. */
function tinted(tint) {
  return CONTAINER_PANELS.map((panel) => [...panel, tint]);
}

const TEXT_CHECKS = [
  { fg: "--ink", backgrounds: PANELS },
  { fg: "--ink-soft", backgrounds: PANELS },
  { fg: "--muted", backgrounds: PANELS },
  { fg: "--accent-ink", backgrounds: PANELS },
  // Status text always has its own tint under it, but the tint is translucent,
  // so the panel underneath still decides the result.
  { fg: "--state-ok-fg", backgrounds: [...PANELS, ...tinted("--state-ok-bg")] },
  { fg: "--state-warn-fg", backgrounds: [...PANELS, ...tinted("--state-warn-bg")] },
  {
    fg: "--state-error-fg",
    backgrounds: [...PANELS, ...tinted("--state-error-bg"), ...tinted("--state-error-bg-strong")],
  },
  { fg: "--state-info-fg", backgrounds: [...PANELS, ...tinted("--state-info-bg")] },
  // `.job-engine` renders text in the glyph accent, so it is held to the text
  // floor and not to the 3:1 of an icon.
  { fg: "--icon-accent", backgrounds: [...PANELS, ...tinted("--accent-tint")] },
  { fg: "--on-accent", backgrounds: [["--lime"], ["--lime-strong"]] },
  { fg: "--plate-fg-text", backgrounds: [["--plate-bg"]] },
  { fg: "--sidebar-fg", backgrounds: [["--sidebar-bg"], ["--sidebar-bg", "--sidebar-panel"]] },
  {
    fg: "--sidebar-fg-muted",
    backgrounds: [["--sidebar-bg"], ["--sidebar-bg", "--sidebar-panel"], ["--sidebar-bg", "--sidebar-active"]],
  },
  { fg: "--sidebar-fg-strong", backgrounds: [["--sidebar-bg"], ["--sidebar-bg", "--sidebar-active"]] },
  // Floating chrome keeps its own scale in both themes, so it is measured
  // against its own veil composited over the canvas behind it.
  { fg: "--chrome-fg", backgrounds: [["--canvas", "--chrome-bg"], ["--canvas", "--chrome-veil"]] },
  { fg: "--chrome-fg-strong", backgrounds: [["--canvas", "--chrome-bg"]] },
  { fg: "--chrome-fg-muted", backgrounds: [["--canvas", "--chrome-bg"]] },
  { fg: "--chrome-error-fg", backgrounds: [["--canvas", "--chrome-bg"]] },
];

const NON_TEXT_CHECKS = [
  // Interactive edges: a checkbox or a switch is identified by its boundary, so
  // the boundary is a meaningful graphical object.
  { fg: "--control-border", backgrounds: PANELS, note: "bordo dei controlli" },
  { fg: "--control-track-bg", backgrounds: PANELS, note: "binario dell'interruttore" },
  { fg: "--plate-bg", backgrounds: PANELS, note: "targhe del marchio" },
  // The rail must read against the panel and the fill against the rail: a bar
  // whose fill you cannot locate carries no progress.
  { fg: "--track-bg", backgrounds: CONTAINER_PANELS, note: "binario di avanzamento" },
  {
    fg: "--track-fill",
    backgrounds: [
      ...CONTAINER_PANELS.map((panel) => [...panel, "--track-bg"]),
      ["--canvas", "--chrome-bg", "--chrome-track-bg"],
    ],
    note: "riempimento di avanzamento",
  },
  { fg: "--chrome-track-bg", backgrounds: [["--canvas", "--chrome-bg"]], note: "binario nella chrome" },
  { fg: "--plate-fg", backgrounds: [["--plate-bg"]], note: "marchio sulla targa" },
  { fg: "--dot-ok", backgrounds: PANELS, note: "punto di stato pronto" },
  { fg: "--dot-warn", backgrounds: PANELS, note: "punto di stato in attesa" },
  { fg: "--state-ok-border", backgrounds: tinted("--state-ok-bg"), note: "bordo di stato" },
  { fg: "--state-warn-border", backgrounds: tinted("--state-warn-bg"), note: "bordo di stato" },
  { fg: "--state-error-border", backgrounds: tinted("--state-error-bg"), note: "bordo di stato" },
  { fg: "--state-info-border", backgrounds: tinted("--state-info-bg"), note: "bordo di stato" },
  // The focus ring is the only thing that says where the keyboard is. On the
  // sidebar the ring is remapped to the brand green by `.sidebar :focus-visible`,
  // so that plate is measured against the colour that actually lands there.
  { fg: "--focus-ring", backgrounds: PANELS, note: "anello di focus" },
  { fg: "--lime", backgrounds: [["--sidebar-bg"]], note: "anello di focus nella sidebar" },
];

function extractBlock(source, startIndex) {
  const open = source.indexOf("{", startIndex);
  if (open < 0) throw new Error("blocco non trovato");
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return { body: source.slice(open + 1, index), end: index };
    }
  }
  throw new Error("blocco non chiuso");
}

function parseDeclarations(body) {
  const tokens = new Map();
  for (const declaration of body.split(";")) {
    const match = declaration.match(/(--[\w-]+)\s*:\s*([^;]+)/);
    if (match) tokens.set(match[1], match[2].replace(/\s+/g, " ").trim());
  }
  return tokens;
}

function readThemes(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rootIndex = clean.search(/(^|\})\s*:root\s*\{/);
  if (rootIndex < 0) throw new Error("blocco :root non trovato in src/App.css");
  const light = parseDeclarations(extractBlock(clean, rootIndex).body);

  const darkIndex = clean.indexOf("@media (prefers-color-scheme: dark)");
  if (darkIndex < 0) throw new Error("blocco del tema scuro non trovato in src/App.css");
  const darkMedia = extractBlock(clean, darkIndex).body;
  const darkRootIndex = darkMedia.search(/:root\s*\{/);
  if (darkRootIndex < 0) throw new Error(":root del tema scuro non trovato in src/App.css");
  const darkOverrides = parseDeclarations(extractBlock(darkMedia, darkRootIndex).body);

  return {
    chiaro: light,
    // The dark theme only remaps tokens: everything it does not restate keeps
    // the light value, which is exactly how a stale literal used to hide.
    scuro: new Map([...light, ...darkOverrides]),
  };
}

function resolveToken(tokens, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`riferimento circolare su ${name}`);
  seen.add(name);
  const value = tokens.get(name);
  if (!value) throw new Error(`token ${name} non definito`);
  const reference = value.match(/^var\((--[\w-]+)\)$/);
  if (reference) return resolveToken(tokens, reference[1], seen);
  return value;
}

function parseColor(value) {
  const hex = value.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hex) {
    const digits = hex[1];
    const expand = (part) => parseInt(part.length === 1 ? part + part : part, 16);
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: expand(digits[0]),
        g: expand(digits[1]),
        b: expand(digits[2]),
        a: digits.length === 4 ? expand(digits[3]) / 255 : 1,
      };
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: expand(digits.slice(0, 2)),
        g: expand(digits.slice(2, 4)),
        b: expand(digits.slice(4, 6)),
        a: digits.length === 8 ? expand(digits.slice(6, 8)) / 255 : 1,
      };
    }
  }
  const functional = value.match(/^rgba?\(([^)]+)\)$/i);
  if (functional) {
    const parts = functional[1].split(/[,/\s]+/).filter(Boolean);
    if (parts.length >= 3) {
      return {
        r: Number.parseFloat(parts[0]),
        g: Number.parseFloat(parts[1]),
        b: Number.parseFloat(parts[2]),
        a: parts.length > 3 ? Number.parseFloat(parts[3]) : 1,
      };
    }
  }
  throw new Error(`colore non interpretabile: ${value}`);
}

function tokenColor(tokens, name) {
  return parseColor(resolveToken(tokens, name));
}

function over(top, bottom) {
  const alpha = top.a;
  return {
    r: top.r * alpha + bottom.r * (1 - alpha),
    g: top.g * alpha + bottom.g * (1 - alpha),
    b: top.b * alpha + bottom.b * (1 - alpha),
    a: 1,
  };
}

function flatten(tokens, layers) {
  let result = null;
  for (const layer of layers) {
    const colour = tokenColor(tokens, layer);
    if (!result) {
      if (colour.a < 1) {
        throw new Error(`il livello di base ${layer} è traslucido: manca la superficie sotto`);
      }
      result = { ...colour, a: 1 };
    } else {
      result = over(colour, result);
    }
  }
  if (!result) throw new Error("nessun livello da comporre");
  return result;
}

function relativeLuminance({ r, g, b }) {
  const channel = (value) => {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground, background) {
  const solid = foreground.a < 1 ? over(foreground, background) : foreground;
  const lighter = Math.max(relativeLuminance(solid), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(solid), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Every token that carries a colour meaning has to appear in a check. Without
 * this a new `--state-…` token slips in unmeasured and the gate reports success
 * on a palette it never looked at — the same silence that let the literals
 * accumulate.
 */
const MEASURED_TOKEN_PATTERN = /-fg$|^--state-|^--control-|^--track-|^--dot-|^--icon-|^--focus-ring$/;

function coverageGaps(tokens) {
  const covered = new Set();
  for (const check of [...TEXT_CHECKS, ...NON_TEXT_CHECKS]) {
    covered.add(check.fg);
    for (const layers of check.backgrounds) for (const layer of layers) covered.add(layer);
  }
  return [...tokens.keys()]
    .filter((name) => MEASURED_TOKEN_PATTERN.test(name) && !covered.has(name))
    .sort();
}

function runChecks(themes) {
  const failures = [];
  let measured = 0;

  for (const [themeName, tokens] of Object.entries(themes)) {
    const groups = [
      { checks: TEXT_CHECKS, minimum: TEXT_MINIMUM, kind: "testo" },
      { checks: NON_TEXT_CHECKS, minimum: NON_TEXT_MINIMUM, kind: "non testuale" },
    ];
    for (const { checks, minimum, kind } of groups) {
      for (const check of checks) {
        for (const layers of check.backgrounds) {
          const background = flatten(tokens, layers);
          const foreground = tokenColor(tokens, check.fg);
          const ratio = contrast(foreground, background);
          measured += 1;
          if (ratio + 1e-9 < minimum) {
            failures.push(
              `tema ${themeName} · ${kind}${check.note ? ` (${check.note})` : ""}: ` +
                `${check.fg} su ${layers.join(" + ")} = ${ratio.toFixed(2)}:1, minimo ${minimum}:1`,
            );
          }
        }
      }
    }
  }

  return { failures, measured };
}

try {
  const css = await readFile(cssPath, "utf8");
  const themes = readThemes(css);

  const gaps = coverageGaps(themes.chiaro);
  if (gaps.length > 0) {
    process.stderr.write(
      `Token di colore non misurati da nessun controllo: ${gaps.join(", ")}\n` +
        "Aggiungi il token a TEXT_CHECKS o a NON_TEXT_CHECKS in questo file, con il fondo su cui viene davvero dipinto.\n",
    );
    process.exit(1);
  }

  const { failures, measured } = runChecks(themes);
  if (failures.length > 0) {
    process.stderr.write(`Contrasto insufficiente in ${failures.length} combinazioni su ${measured}:\n`);
    for (const failure of failures.sort()) process.stderr.write(`  ${failure}\n`);
    process.stderr.write(
      "\nCorreggi i token in src/App.css: i valori vivono in :root e nel blocco del tema scuro.\n",
    );
    process.exit(1);
  }
  process.stdout.write(
    `Contrasto verificato: ${measured} combinazioni nei due temi, testo >= ${TEXT_MINIMUM}:1, elementi non testuali >= ${NON_TEXT_MINIMUM}:1.\n`,
  );
} catch (error) {
  process.stderr.write(`Gate di contrasto non eseguibile: ${error.message}\n`);
  process.exit(1);
}
