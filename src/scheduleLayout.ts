import type { DaySlot } from "./types";
import type { Cell, Grid } from "./components/Timetable";

export type LayoutEntry = { slot: DaySlot | null; period: number | null; cell: Cell | null; continuation: boolean; span: number };
export type LayoutRow = { label: string; entries: LayoutEntry[] };

/** 요일별 점심 위치의 합집합으로 행을 만든다. 다른 요일의 점심 행도 블록 병합 길이에 포함한다. */
export function scheduleRows(days: string[], slots: DaySlot[], daySlots: Record<string, DaySlot[]>, grid: Grid): LayoutRow[] {
  const columns = days.map((day) => {
    const periods: DaySlot[] = [];
    const breaks = new Map<number, DaySlot>();
    for (const slot of daySlots[day] ?? slots) {
      if (slot.kind === "period") periods.push(slot);
      else {
        const previous = breaks.get(periods.length);
        breaks.set(periods.length, previous ? { ...previous, label: `${previous.label} / ${slot.label}`, end: slot.end } : slot);
      }
    }
    return { periods, breaks };
  });
  const count = Math.max(0, ...columns.map((c) => c.periods.length));
  const rows: LayoutRow[] = [];
  const periodRows: number[] = [];
  for (let p = 0; p <= count; p++) {
    if (columns.some((c) => c.breaks.has(p))) rows.push({
      label: "휴식", entries: columns.map((c) => ({ slot: c.breaks.get(p) ?? null, period: null, cell: null, continuation: false, span: 1 })),
    });
    if (p === count) break;
    periodRows[p] = rows.length;
    rows.push({ label: `${p + 1}교시`, entries: columns.map((c, d) => ({
      slot: c.periods[p] ?? null, period: p,
      cell: grid[p]?.[d] && grid[p][d] !== "cont" ? grid[p][d] as Cell : null,
      continuation: grid[p]?.[d] === "cont", span: 1,
    })) });
  }
  for (const [p, r] of periodRows.entries()) {
    rows[r].entries.forEach((entry, d) => {
      if (!entry.cell || entry.cell.span < 2 || periodRows[p + entry.cell.span - 1] === undefined) return;
      const end = periodRows[p + entry.cell.span - 1];
      // 자체 휴식 시간을 가로지르는 잘못된 기존 블록은 병합하지 않는다.
      if (rows.slice(r + 1, end).some((row) => row.entries[d].slot?.kind === "break")) return;
      entry.span = end - r + 1;
      if (entry.slot) entry.slot = { ...entry.slot, end: columns[d].periods[p + entry.cell.span - 1].end };
      for (let i = r + 1; i <= end; i++) rows[i].entries[d].continuation = true;
    });
  }
  return rows;
}
