export const array = (value) => Array.isArray(value) ? value : [];
export const string = (value) => value == null ? "" : String(value);
export const blocks = (values) => values.filter((value) => value && value.trim()).join("\n\n");

export function escapeText(value) {
  return string(value).replace(/\r\n?/g, "\n")
    .replace(/&(?=(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);)/gi, "&amp;")
    .replace(/[\\`*_{}\[\]<>#|~!]/g, "\\$&")
    .replace(/(^|\n)(\s*)([-+])(?=\s)/g, "$1$2\\$3")
    .replace(/(^|\n)([ \t]{0,3})(-+|=+|\+)(?=[ \t]*(?:\n|$))/g, "$1$2\\$3")
    .replace(/(^|\n)(\s*\d+)([.)])(?=\s)/g, "$1$2\\$3");
}

export function oneLine(value) {
  return escapeText(string(value).replace(/\s+/g, " ").trim());
}

export function resolveUrl(value, baseUrl) {
  if (!value) return "";
  try {
    const url = new URL(string(value), baseUrl || undefined);
    if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) return "";
    return url.href.replace(/[<>()\\\s]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
  } catch {
    return "";
  }
}

export function link(label, href, context) {
  const url = resolveUrl(href, context.baseUrl);
  let readable = label || escapeText(href);
  if (url && (!label || label === escapeText(href))) {
    try {
      const parsed = new URL(url);
      const source = new URL(context.baseUrl);
      const key = parsed.pathname.match(/\/browse\/([A-Z][A-Z0-9_]*-\d+)\/?$/)?.[1];
      if (parsed.origin === source.origin && key) readable = oneLine(key);
    } catch {}
  }
  return url ? `[${readable}](${url})` : readable;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Do not let the browser's locale or time zone change exported dates.
export function formatDate(value, { utc = false, seconds = false } = {}) {
  const source = string(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2}))?$/.exec(source);
  if (iso) {
    const [, year, month, day, hour, minute, second = "00", zone] = iso;
    const datePart = `${year}-${month}-${day}`;
    const calendar = new Date(`${datePart}T00:00:00Z`);
    if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== datePart) return source;
    if (!zone) return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
    const normalizedZone = zone === "Z" ? "Z" : zone.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
    const timestamp = new Date(`${datePart}T${hour}:${minute}:${second}${normalizedZone}`);
    if (!Number.isFinite(timestamp.getTime()) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return source;
    if (utc) return formatDate(timestamp.toISOString(), { seconds });
    const offset = /^(?:Z|[+-]00:00)$/.test(normalizedZone) ? "UTC" : `UTC${normalizedZone}`;
    return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}, ${hour}:${minute}${seconds ? `:${second}` : ""} ${offset}`;
  }
  const jira = /^(\d{1,2})\/([a-z]{3})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(source);
  if (jira) {
    const [, day, month, shortYear, hour, minute, period] = jira;
    const monthIndex = MONTHS.findIndex(name => name.toLowerCase() === month.toLowerCase());
    const year = shortYear.length === 2 ? `20${shortYear}` : shortYear;
    const calendar = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
    if (monthIndex < 0 || Number(hour) < 1 || Number(hour) > 12 || Number(minute) > 59 || formatDate(calendar) === calendar) return source;
    return `${Number(day)} ${MONTHS[monthIndex]} ${year}, ${hour}:${minute} ${period.toUpperCase()} — time zone unspecified`;
  }
  return source;
}

export function wrap(value, delimiter) {
  const [, leading, core, trailing] = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
  return core ? `${leading}${delimiter}${core}${delimiter}${trailing}` : value;
}

export function codeSpan(value) {
  const text = string(value).replace(/\r?\n/g, " ");
  const longest = Math.max(0, ...(text.match(/`+/g) || []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const padding = /^`|`$/.test(text) || (/^ .* $/.test(text) && /\S/.test(text)) ? " " : "";
  return `${fence}${padding}${text}${padding}${fence}`;
}

export function codeBlock(value, language = "") {
  const text = string(value).replace(/\r\n?/g, "\n");
  const longest = Math.max(2, ...(text.match(/`+/g) || []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const info = string(language).replace(/[^a-zA-Z0-9_+.#-]/g, "");
  return `${fence}${info}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}`;
}

export function table(rows) {
  if (!rows.length) return "";
  const grid = [];
  let hasHeader = false;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = grid[rowIndex] ||= [];
    let column = 0;
    for (const cell of rows[rowIndex]) {
      while (row[column] !== undefined) column++;
      const width = Math.min(100, Math.max(1, Number(cell.colspan) || 1));
      const height = Math.min(rows.length - rowIndex, Math.max(1, Number(cell.rowspan) || 1));
      row[column] = cell.text.trim().replace(/(?<!\\)\|/g, "\\|").replace(/\r?\n+/g, "<br>");
      if (rowIndex === 0 && cell.header) hasHeader = true;
      for (let y = 0; y < height; y++) {
        const covered = grid[rowIndex + y] ||= [];
        for (let x = 0; x < width; x++) {
          if (x || y) covered[column + x] = "";
        }
      }
      column += width;
    }
  }
  const width = Math.max(...grid.map((row) => row.length));
  if (!width) return "";
  const renderRow = (row) => `| ${Array.from({ length: width }, (_, index) => row[index] || "").join(" | ")} |`;
  const header = hasHeader ? grid.shift() : [];
  return [renderRow(header), renderRow(Array(width).fill("---")), ...grid.map(renderRow)].join("\n");
}

