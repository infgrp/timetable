import type { DragEvent } from "react";
import type { DaySlot } from "../types";
import DailyTimetableBody from "./DailyTimetableBody";
import { useI18n } from "../i18n";

export type Cell = {
  top: string;
  bottom?: string;
  span: number;
  hue: number;
  /** 편집 대상 Assignment id. 편집 모드에서만 쓴다. */
  id?: string;
  /** 충돌에 얽힌 칸 */
  bad?: boolean;
  /** 고정 활동(Orientation·Closing) — 수업이 아니라 자리를 막는 칸 */
  fixed?: boolean;
};
/** grid[periodIndex][dayIndex] — "cont" 는 위 칸이 이어지는 자리 */
export type Grid = (Cell | "cont" | null)[][];

/** 편집 모드에서 격자가 바깥으로 넘기는 동작들. */
export type EditHooks = {
  selectedId: string | null;
  /** 배치된 칸을 눌렀을 때 */
  onPick: (id: string) => void;
  /** 빈 칸을 눌렀을 때 */
  onAddAt: (day: number, period: number) => void;
  /** 칸을 끌어다 놓았을 때 */
  onMove: (id: string, day: number, period: number) => void;
};

export function hueOf(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

const DRAG_TYPE = "text/plain";

export default function Timetable({
  title,
  subtitle,
  days,
  slots,
  grid,
  edit,
  daySlots,
  bands,
}: {
  title: string;
  subtitle?: string;
  days: string[];
  slots: DaySlot[];
  grid: Grid;
  edit?: EditHooks;
  daySlots?: Record<string, DaySlot[]>;
  /** 요일 머리 위에 얹는 묶음 줄 (합본에서 LOW(3학년) | HIGH(5학년) 처럼 쓴다) */
  bands?: { label: string; span: number }[];
}) {
  const { t } = useI18n();
  let periodIndex = -1;
  return (
    <div className="print-page min-w-0 break-inside-avoid rounded-xl border border-tt-200 bg-white p-4 shadow-sm print-tight">
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
            {bands && bands.length > 0 && (
              <tr>
                <th className="border border-tt-200 bg-tt-50" />
                {bands.map((b, i) => (
                  <th
                    key={`${b.label}-${i}`}
                    colSpan={b.span}
                    className="border border-tt-200 bg-tt-50 px-2 py-1 text-xs font-bold text-tt-700"
                  >
                    {b.label}
                  </th>
                ))}
              </tr>
            )}
            <tr>
              <th className="border border-tt-200 bg-tt-50 px-1 py-1 text-xs text-tt-600">{t("교시")}</th>
              {days.map((d) => (
                <th key={d} className="border border-tt-200 bg-tt-100 px-2 py-1.5 font-bold text-tt-800">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          {daySlots && days.some((d) => daySlots[d]) ? <DailyTimetableBody days={days} slots={slots} daySlots={daySlots} grid={grid} edit={edit} /> : <tbody>
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

                    // 편집 모드에서는 빈 칸도 놓을 자리가 된다.
                    const dropProps = edit
                      ? {
                          onDragOver: (e: DragEvent) => e.preventDefault(),
                          onDrop: (e: DragEvent) => {
                            e.preventDefault();
                            const id = e.dataTransfer.getData(DRAG_TYPE);
                            if (id) edit.onMove(id, di, pi);
                          },
                        }
                      : {};

                    if (!cell)
                      return (
                        <td
                          key={day}
                          {...dropProps}
                          onClick={edit ? () => edit.onAddAt(di, pi) : undefined}
                          className={`h-12 border border-tt-200 bg-white ${
                            edit ? "cursor-cell text-center align-middle text-tt-300 hover:bg-tt-50" : ""
                          }`}
                        >
                          {edit ? <span className="no-print text-lg leading-none">+</span> : null}
                        </td>
                      );

                    // 고정 활동은 옮기거나 고칠 수 없다. 점심시간 띠와 같은 색으로 둔다.
                    if (cell.fixed)
                      return (
                        <td
                          key={day}
                          rowSpan={cell.span}
                          className="h-12 border border-tt-200 bg-amber-50 px-1 py-1 text-center align-middle text-[12px] font-semibold text-amber-700"
                        >
                          {cell.top}
                        </td>
                      );

                    const picked = edit?.selectedId && cell.id === edit.selectedId;
                    return (
                      <td
                        key={day}
                        rowSpan={cell.span}
                        {...dropProps}
                        draggable={Boolean(edit && cell.id)}
                        onDragStart={
                          edit && cell.id
                            ? (e) => e.dataTransfer.setData(DRAG_TYPE, cell.id as string)
                            : undefined
                        }
                        onClick={edit && cell.id ? () => edit.onPick(cell.id as string) : undefined}
                        className={`h-12 border px-1 py-1 text-center align-middle ${
                          cell.bad ? "border-red-400 ring-1 ring-red-400" : "border-tt-200"
                        } ${picked ? "outline outline-2 outline-tt-600" : ""} ${
                          edit && cell.id ? "cursor-grab active:cursor-grabbing" : ""
                        }`}
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
          </tbody>}
        </table>
      </div>
    </div>
  );
}
