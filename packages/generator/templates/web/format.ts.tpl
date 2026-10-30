/** How a stored value reads on screen. Shared by every kit so tables and detail panes agree. */
export function formatValue(value: unknown, col: { type: string; lookup?: Record<string, string> }): string {
  if (value === null || value === undefined || value === "") return "";
  if (col.type === "boolean") return value ? "Yes" : "No";
  if (col.lookup) return col.lookup[String(value)] ?? "(unavailable)";
  if (col.type === "number" || col.type === "money" || col.type === "rating") {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString() : String(value);
  }
  if (col.type === "percent") {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString() + "%" : String(value);
  }
  if (col.type === "date" || col.type === "datetime") {
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return col.type === "date"
      ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
      : d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  return String(value);
}
