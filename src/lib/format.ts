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

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function engineName(id: string): string {
  const names: Record<string, string> = {
    markitdown: "MarkItDown",
    paddleocr: "PaddleOCR",
    glmocr: "GLM-OCR",
    "faster-whisper": "Faster Whisper",
    privacy: "Privacy Shield",
    docling: "Docling",
    "pdf-translate": "PDF Translate",
  };
  return names[id] ?? id;
}
