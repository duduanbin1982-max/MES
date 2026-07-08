"use strict";

function parseCsv(text) {
  const lines = [];
  let cell = "";
  let row = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((x) => String(x).trim() !== "")) lines.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((x) => String(x).trim() !== "")) lines.push(row);
  if (lines.length < 2) throw new Error("CSV 至少 2 行 (表头 + 数据)");
  const headers = lines[0].map((s) => String(s).trim());
  const rows = lines.slice(1).map((cells, idx) => {
    const out = { __line: idx + 2 };
    headers.forEach((header, i) => {
      out[header] = cells[i] !== undefined ? String(cells[i]).trim() : "";
    });
    return out;
  });
  return { headers, rows };
}

module.exports = {
  parseCsv,
};
