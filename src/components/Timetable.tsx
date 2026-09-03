import type { DaySlot } from "../types";

export type Cell = { top: string; bottom?: string; span: number; hue: number };
/** grid[periodIndex][dayIndex] — "cont" 는 위 칸이 이어지는 자리 */
export type Grid = (Cell | "cont" | null)[][];

export function hueOf(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

export default function Timetable({
  title,
  subtitle,
  days,
  slots,
  grid,
}: {
  title: string;
  subtitle?: string;
  days: string[];
  slots: DaySlot[];
  grid: Grid;
}) {
  let periodIndex = -1;
  return (
    <div className="print-page break-inside-avoid rounded-xl border border-tt-200 bg-white p-4 shadow-sm print-tight">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-base font-bold text-tt-800">{title}</h3>
        {subtitle && <span className="text-xs text-tt-500">{subtitle}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-24" />
            {days.map((d) => (
              <col key={d} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="border border-tt-200 bg-tt-50 px-1 py-1 text-xs text-tt-600">교시</th>
              {days.map((d) => (
                <th key={d} className="border border-tt-200 bg-tt-100 px-2 py-1.5 font-bold text-tt-800">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => {
              if (slot.kind === "break") {
                return (
                  <tr key={slot.id}>
                    <th className="border border-tt-200 bg-tt-50 px-1 py-1 text-[11px] font-semibold text-tt-500">
                      {slot.start}
                    </th>
                    <td
                      colSpan={days.length}
                      className="border border-tt-200 bg-amber-50 px-2 py-1 text-center text-xs font-semibold text-amber-700"
                    >
                      {slot.label} · {slot.start}~{slot.end}
                    </td>
                  </tr>
                );
              }
              periodIndex += 1;
              const pi = periodIndex;
              return (
                <tr key={slot.id}>
                  <th className="border border-tt-200 bg-tt-50 px-1 py-1 text-left text-[11px] font-semibold text-tt-700">
                    <div>{slot.label}</div>
                    <div className="font-normal text-tt-400">{slot.start}</div>
                  </th>
                  {days.map((day, di) => {
                    const cell = grid[pi]?.[di] ?? null;
                    if (cell === "cont") return null;
                    if (!cell)
                      return (
                        <td key={day} className="h-12 border border-tt-200 bg-white" />
                      );
                    return (
                      <td
                        key={day}
                        rowSpan={cell.span}
                        className="h-12 border border-tt-200 px-1 py-1 text-center align-middle"
                        style={{ background: `hsl(${cell.hue} 70% 94%)` }}
                      >
                        <div className="text-[13px] font-bold leading-tight text-tt-900">{cell.top}</div>
                        {cell.bottom && (
                          <div className="text-[11px] leading-tight text-tt-600">{cell.bottom}</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
