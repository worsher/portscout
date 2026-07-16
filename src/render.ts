export const C = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

export function formatTable(header: string[], rows: string[][]): string {
  const all = [header, ...rows];
  const widths = header.map((_, i) =>
    Math.max(...all.map((r) => strip(r[i] ?? "").length)),
  );
  const fmt = (r: string[]) =>
    r.map((c, i) => c + " ".repeat(widths[i] - strip(c).length)).join("  ");
  return [fmt(header), ...rows.map(fmt)].join("\n");
}
