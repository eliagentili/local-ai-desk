import { UI_LOCALE } from "./strings";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  const digits = index === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[index]}`;
}

type DateStyle = "short" | "long" | "time";

const dateOptions: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" },
  long: {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
  time: { hour: "2-digit", minute: "2-digit", second: "2-digit" },
};

// Constructing an Intl formatter is expensive and the activity list calls this
// once per row on every poll, so instances are built once per style and locale
// and reused. The cache is keyed by locale rather than assuming one, which is
// what made every formatter here a hard-coded Italian.
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();

function dateFormatter(style: DateStyle, locale: string): Intl.DateTimeFormat {
  const key = `${locale}:${style}`;
  const cached = dateFormatters.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(locale, dateOptions[style]);
  dateFormatters.set(key, created);
  return created;
}

function numberFormatter(locale: string): Intl.NumberFormat {
  const cached = numberFormatters.get(locale);
  if (cached) return cached;
  const created = new Intl.NumberFormat(locale);
  numberFormatters.set(locale, created);
  return created;
}

export function formatDate(value: string, locale: string = UI_LOCALE): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateFormatter("short", locale).format(date);
}

export function formatDateTime(
  value: string | null,
  locale: string = UI_LOCALE,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dateFormatter("long", locale).format(date);
}

/** Clock time alone: the job history is read as a sequence of moments within one
 *  run, where the date would repeat on every row. */
export function formatTime(value: string, locale: string = UI_LOCALE): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateFormatter("time", locale).format(date);
}

export function formatCount(value: number, locale: string = UI_LOCALE): string {
  return numberFormatter(locale).format(value);
}

/** Case folding for search is locale-dependent, so it goes through the same
 *  constant as the formatters instead of a literal at each call site. */
export function foldForSearch(value: string, locale: string = UI_LOCALE): string {
  return value.toLocaleLowerCase(locale);
}
