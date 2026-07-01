export function formatInteger(value: number | undefined): string {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

export function formatDegrees(value: number, fractionDigits = 1): string {
  return `${value.toFixed(fractionDigits)} deg`;
}

export function formatVelocity(value: number): string {
  return `${Math.round(value)} km/s`;
}

export function formatUtc(date: Date | null): string {
  if (!date) {
    return "";
  }
  return date.toISOString().replace(".000Z", "Z");
}

export function toUtcInputValue(date: Date): string {
  return date.toISOString().slice(0, 16);
}

export function parseUtcInput(value: string): Date {
  return new Date(`${value}:00.000Z`);
}

function csvEscape(value: string | number | boolean | null | undefined): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function downloadCsv(
  filename: string,
  rows: Array<Record<string, string | number | boolean | null | undefined>>,
): void {
  if (!rows.length) {
    return;
  }

  const headers = Object.keys(rows[0]);
  const body = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");

  downloadText(filename, `${body}\n`, "text/csv;charset=utf-8");
}

export function downloadText(
  filename: string,
  body: string,
  mimeType = "text/plain;charset=utf-8",
): void {
  const blob = new Blob([body], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
