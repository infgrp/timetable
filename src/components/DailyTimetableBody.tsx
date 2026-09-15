import type { DragEvent } from "react";
import type { DaySlot } from "../types";
import type { EditHooks, Grid } from "./Timetable";
import { scheduleRows } from "../scheduleLayout";
import { useI18n } from "../i18n";

export default function DailyTimetableBody({ days, slots, daySlots, grid, edit }: {
  days: string[]; slots: DaySlot[]; daySlots: Record<string, DaySlot[]>; grid: Grid; edit?: EditHooks;
}) {
  const { lang } = useI18n();
  return <tbody>{scheduleRows(days, slots, daySlots, grid, lang).map((row, r) => <tr key={r}>
    <th className="border border-tt-200 bg-tt-50 px-1 py-1 text-xs text-tt-600">{row.label}</th>
    {row.entries.map((entry, d) => {
      if (entry.continuation) return null;
      const { slot, cell, period } = entry;
      const editable = edit && slot?.kind === "period" && !cell?.fixed;
      const drop = editable ? {
        onDragOver: (e: DragEvent) => e.preventDefault(),
        onDrop: (e: DragEvent) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (id) edit.onMove(id, d, period!); },
      } : {};
      return <td key={d} rowSpan={entry.span} {...drop}
        draggable={Boolean(editable && cell?.id)}
        onDragStart={editable && cell?.id ? (e) => e.dataTransfer.setData("text/plain", cell.id!) : undefined}
        onClick={editable ? () => cell?.id ? edit.onPick(cell.id) : edit.onAddAt(d, period!) : undefined}
        className={`h-12 border px-1 py-1 text-center ${cell?.bad ? "border-red-400 ring-1 ring-red-400" : "border-tt-200"} ${cell?.fixed || slot?.kind === "break" ? "bg-amber-50 text-amber-800" : ""} ${edit?.selectedId && cell?.id === edit.selectedId ? "outline outline-2 outline-tt-600" : ""} ${editable ? "cursor-pointer" : ""}`}
        style={cell && !cell.fixed ? { background: `hsl(${cell.hue} 70% 94%)` } : undefined}>
        {slot && <div className="text-[10px] text-tt-500">{slot.start}~{slot.end}</div>}
        {slot?.kind === "break" ? <div className="text-xs font-semibold">{slot.label}</div> : cell ? <>
          <div className="text-[13px] font-bold text-tt-900">{cell.top}</div>
          {cell.bottom && <div className="text-[11px] text-tt-600">{cell.bottom}</div>}
        </> : editable ? <span className="no-print text-tt-300">+</span> : null}
      </td>;
    })}
  </tr>)}</tbody>;
}
