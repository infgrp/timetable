import type { DaySlot } from "./types";
import type { Grid } from "./components/Timetable";
import type { CellStyle, XCell, XSheet } from "./xlsx";
import { safeSheetName } from "./xlsx";
import { scheduleRows } from "./scheduleLayout";

/** 화면에 그린 격자를 그대로 엑셀 시트 한 장으로 옮긴다. */
export function toSheet(opts: {
  sheetName: string;
  title: string;
  days: string[];
  slots: DaySlot[];
  grid: Grid;
  daySlots?: Record<string, DaySlot[]>;
  /** 요일 머리 위에 얹는 묶음 줄 (합본 시간표) */
  bands?: { label: string; span: number }[];
  /** 머리글·교시 줄 언어 (영어 화면에서 받을 때) */
  lang?: "ko" | "en";
}): XSheet {
  const { days, slots, grid } = opts;
  const cols = days.length + 1;
  const rows: XCell[][] = [];
  const rowHeights: (number | undefined)[] = [];
  const merges: XSheet["merges"] = [];

  const blankRow = (): XCell[] => new Array(cols).fill(null);

  // 제목
  const titleRow = blankRow();
  titleRow[0] = { text: opts.title, style: "title" };
  rows.push(titleRow);
  rowHeights.push(26);
  merges.push({ r1: 0, c1: 0, r2: 0, c2: cols - 1 });

  // 묶음 줄 (합본에서 구간 이름)
  if (opts.bands && opts.bands.length > 0) {
    const r = rows.length;
    const band = blankRow();
    let c = 1;
    for (const b of opts.bands) {
      band[c] = { text: b.label, style: "header" };
      if (b.span > 1) merges.push({ r1: r, c1: c, r2: r, c2: c + b.span - 1 });
      c += b.span;
    }
    rows.push(band);
    rowHeights.push(20);
  }

  // 머리글
  const head = blankRow();
  head[0] = { text: opts.lang === "en" ? "Period" : "교시", style: "header" };
  days.forEach((d, i) => (head[i + 1] = { text: d, style: "header" }));
  rows.push(head);
  rowHeights.push(22);

  if (opts.daySlots && days.some((d) => opts.daySlots?.[d])) {
    for (const layout of scheduleRows(days, slots, opts.daySlots, grid, opts.lang)) {
      const r = rows.length;
      const row = blankRow();
      row[0] = { text: layout.label, style: "timeCol" };
      layout.entries.forEach((entry, d) => {
        if (entry.continuation) return;
        const { cell, slot } = entry;
        const time = slot ? `${slot.start}~${slot.end}` : "";
        row[d + 1] = {
          text: slot?.kind === "break" ? `${slot.label} · ${time}` : cell ? `${cell.top}\n${cell.bottom ?? ""}\n${time}` : time,
          style: cell?.fixed || slot?.kind === "break" ? "lunch" : cell ? `subject${cell.hue % 8}` as CellStyle : "empty",
        };
        if (entry.span > 1) merges.push({ r1: r, c1: d + 1, r2: r + entry.span - 1, c2: d + 1 });
      });
      rows.push(row);
      rowHeights.push(layout.kind === "break" ? 28 : 48);
    }
    return { name: safeSheetName(opts.sheetName, "시간표"), colWidths: [11, ...days.map(() => 20)], rows, rowHeights, merges };
  }

  let periodIndex = -1;
  for (const slot of slots) {
    const r = rows.length;
    const row = blankRow();

    if (slot.kind === "break") {
      row[0] = { text: slot.start, style: "timeCol" };
      row[1] = { text: `${slot.label} · ${slot.start}~${slot.end}`, style: "lunch" };
      rows.push(row);
      rowHeights.push(20);
      if (days.length > 1) merges.push({ r1: r, c1: 1, r2: r, c2: cols - 1 });
      continue;
    }

    periodIndex += 1;
    row[0] = { text: `${slot.label}\n${slot.start}~${slot.end}`, style: "timeCol" };
    days.forEach((_, di) => {
      const cell = grid[periodIndex]?.[di] ?? null;
      if (cell === "cont") {
        row[di + 1] = null; // 위 칸이 세로로 병합되어 내려온 자리
        return;
      }
      if (!cell) {
        row[di + 1] = { text: "", style: "empty" };
        return;
      }
      // 고정 활동은 점심시간 띠와 같은 서식으로 — 수업이 아니라는 것이 한눈에 보이게.
      const style: CellStyle = cell.fixed ? "lunch" : (`subject${(cell.hue % 8) as 0}` as CellStyle);
      row[di + 1] = {
        text: cell.bottom ? `${cell.top}\n${cell.bottom}` : cell.top,
        style,
      };
      if (cell.span > 1) merges.push({ r1: r, c1: di + 1, r2: r + cell.span - 1, c2: di + 1 });
    });
    rows.push(row);
    rowHeights.push(36);
  }

  return {
    name: safeSheetName(opts.sheetName, "시간표"),
    colWidths: [11, ...days.map(() => 18)],
    rows,
    rowHeights,
    merges,
  };
}
