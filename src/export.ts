export function downloadText(filename: string, text: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function cell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 엑셀에서 한글이 깨지지 않도록 BOM을 붙인다. */
export function toCsv(rows: string[][]): string {
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 윈도우 파일명에 못 쓰는 문자를 걷어낸다. */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim() || "시간표";
}
