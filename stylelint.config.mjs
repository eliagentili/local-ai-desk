/**
 * Two constraints from CLAUDE.md, turned into a gate.
 *
 * 1. No literal colours outside the token blocks. Thirty-three literals had
 *    accumulated next to the components that needed them; each one stayed light
 *    while the text above it turned pale, which is how whole panels became
 *    unreadable in the dark theme. Only custom properties may hold a colour
 *    value, and those live in `:root` and in the dark block — see
 *    scripts/check-contrast.mjs, which measures them.
 * 2. No informative text below 11px. Below that, macOS renders text most people
 *    cannot read at arm's length.
 *
 * The colour rule is expressed on the property side: every declaration whose
 * property is not a custom property must resolve its colour through `var()`.
 * System colours (Canvas, CanvasText, Highlight, GrayText) are deliberately
 * allowed — the forced-colors block has to name them.
 */

const COLOUR_LITERALS = [
  // #abc, #abcd, #aabbcc, #aabbccdd
  "/#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/",
  "/\\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\(/",
  // Named colours, but not the same word inside a token name such as var(--lime).
  "/(?<![\\w-])(?:aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen)(?![\\w-])/i",
];

/**
 * A font size is either a type-scale token, or a px value of 11 and above, or a
 * clamp whose smallest step is 11px and above. `em` and `rem` are rejected on
 * purpose: a relative size cannot be verified without knowing the parent, and
 * that is exactly how a 0.95em landed on top of an 11px paragraph.
 */
const FONT_SIZE_ALLOWED = [
  "/^var\\(--text-(?:xs|sm|base|lg)\\)$/",
  "/^(?:1[1-9]|[2-9]\\d|\\d{3,})(?:\\.\\d+)?px$/",
  "/^clamp\\(\\s*(?:1[1-9]|[2-9]\\d|\\d{3,})(?:\\.\\d+)?px\\s*,[^)]*\\)$/",
  "inherit",
  "unset",
];

export default {
  rules: {
    "declaration-property-value-disallowed-list": [
      { "/^(?!--)/": COLOUR_LITERALS },
      {
        message:
          "Colore letterale: definisci il valore come token in :root e nel blocco del tema scuro, poi usalo con var().",
      },
    ],
    "declaration-property-value-allowed-list": [
      { "font-size": FONT_SIZE_ALLOWED },
      {
        message:
          "Dimensione del testo non ammessa: usa un token --text-* oppure un valore in px non inferiore a 11px.",
      },
    ],
  },
};
