import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const TAIPEI_TZ = "Asia/Taipei";

function taipeiParts(input: string | number | Date): Record<string, string> {
  const d = input instanceof Date ? input : new Date(input);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return parts;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Format a UTC datetime string as Taipei time (GMT+8).
 * Pattern tokens: yyyy, MMM, MM, dd, HH, mm, ss
 * Pass `withTz: true` to append " GMT+8".
 */
export function formatTaipei(
  input: string | number | Date | null | undefined,
  pattern: string = "yyyy-MM-dd HH:mm",
  opts: { withTz?: boolean } = {},
): string {
  if (input == null) return "";
  const p = taipeiParts(input);
  const monthNum = parseInt(p.month, 10);
  const out = pattern
    .replace(/yyyy/g, p.year)
    .replace(/MMM/g, MONTH_SHORT[monthNum - 1] ?? p.month)
    .replace(/MM/g, p.month)
    .replace(/dd/g, p.day)
    .replace(/HH/g, p.hour === "24" ? "00" : p.hour)
    .replace(/mm/g, p.minute)
    .replace(/ss/g, p.second);
  return opts.withTz ? `${out} GMT+8` : out;
}
