import { useEffect, useRef, useState } from "react";
import type { AppData } from "../types";
import { newFixedActivity, slotKey } from "../store";
import { Button, Card, Empty, Select, TextInput } from "./ui";
import { calendarPeriods, dayPeriods } from "../calendar";

type Props = { data: AppData; set: (fn: (d: AppData) => AppData) => void };

/** 자주 쓰는 고정 활동 — 누르면 이름이 채워진 채로 만들어진다. */
const PRESETS = ["Orientation", "Closing", "Welcome", "Wrap-up"];

/**
 * 요일별 고정 활동 편집기.
 *
 * 월·수 1교시 Orientation, 화·금 6교시 Closing 처럼 "수업이 아닌데 자리를 차지하는" 칸을
 * 강사 회피 시간과 같은 방식(격자를 칠하기)으로 지정한다.
 */
export default function FixedActivitiesCard({ data, set }: Props) {
  const [selected, setSelected] = useState<string | null>(data.fixedActivities[0]?.id ?? null);
  const painting = useRef<null | boolean>(null);

  useEffect(() => {
    if (selected && data.fixedActivities.some((f) => f.id === selected)) return;
    setSelected(data.fixedActivities[0]?.id ?? null);
  }, [data.fixedActivities, selected]);

  useEffect(() => {
    const stop = () => (painting.current = null);
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

  const periods = calendarPeriods(data);
  const activity = data.fixedActivities.find((f) => f.id === selected) ?? null;

  const patch = (id: string, cells: string[]) =>
    set((d) => ({
      ...d,
      fixedActivities: d.fixedActivities.map((f) => (f.id === id ? { ...f, cells } : f)),
    }));

  const add = (name: string) => {
    const made = newFixedActivity(name);
    set((d) => ({ ...d, fixedActivities: [...d.fixedActivities, made] }));
    setSelected(made.id);
  };

  const applyPaint = (key: string, on: boolean) => {
    if (!activity) return;
    const has = activity.cells.includes(key);
    if (on === has) return;
    patch(activity.id, on ? [...activity.cells, key] : activity.cells.filter((k) => k !== key));
  };

  const toggleMany = (keys: string[]) => {
    if (!activity) return;
    keys = keys.filter((key) => !takenElsewhere.has(key));
    const allOn = keys.every((k) => activity.cells.includes(k));
    const next = new Set(activity.cells);
    for (const k of keys) {
      if (allOn) next.delete(k);
      else next.add(k);
    }
    patch(activity.id, [...next]);
  };

  /** 다른 활동이 이미 쓰고 있는 칸인지 (한 칸에 둘은 못 넣는다) */
  const takenElsewhere = new Map<string, string>();
  for (const f of data.fixedActivities) {
    if (f.id === activity?.id) continue;
    for (const k of f.cells) if (!takenElsewhere.has(k)) takenElsewhere.set(k, f.name || "고정");
  }

  const unusedPresets = PRESETS.filter((n) => !data.fixedActivities.some((f) => f.name === n));

  return (
    <Card
      title={`요일별 고정 활동 (${data.fixedActivities.length}개)`}
      desc="Orientation·Closing처럼 요일마다 자리가 정해진 활동입니다. 칠한 칸에는 프로그램이 배치되지 않으며, 그날 등원하는 체험반과 강사의 시간표에 나타납니다. 체험존을 고르면 그 존 시간표에도 표시됩니다."
    >
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {unusedPresets.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => add(n)}
            className="rounded-md border border-dashed border-tt-300 px-2 py-1 text-xs font-semibold text-tt-600 hover:border-tt-500 hover:bg-tt-50"
          >
            + {n}
          </button>
        ))}
        <Button variant="primary" onClick={() => add("")}>
          + 직접 추가
        </Button>
      </div>

      {data.fixedActivities.length === 0 ? (
        <Empty>
          고정 활동이 없습니다. 월·수 1교시 Orientation 처럼 정해진 활동이 있으면 여기에 넣으세요.
        </Empty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <ul>
            {data.fixedActivities.map((f) => {
              const on = f.id === selected;
              return (
                <li key={f.id} className="flex items-center gap-1 border-b border-tt-100 py-1 last:border-0">
                  <button
                    type="button"
                    onClick={() => setSelected(f.id)}
                    className={`h-7 w-14 shrink-0 rounded px-1 text-xs font-bold ${
                      on ? "bg-tt-600 text-white" : "bg-tt-100 text-tt-600"
                    }`}
                    title="칸 지정"
                  >
                    {f.cells.length}칸
                  </button>
                  <TextInput
                    value={f.name}
                    placeholder="활동 이름"
                    onFocus={() => setSelected(f.id)}
                    onChange={(e) =>
                      set((d) => ({
                        ...d,
                        fixedActivities: d.fixedActivities.map((x) =>
                          x.id === f.id ? { ...x, name: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                  {data.rooms.length > 0 && (
                    <Select
                      value={f.roomId ?? ""}
                      title="이 활동을 진행하는 체험존 (선택하면 그 존 시간표에도 나타납니다)"
                      onFocus={() => setSelected(f.id)}
                      onChange={(e) =>
                        set((d) => ({
                          ...d,
                          fixedActivities: d.fixedActivities.map((x) =>
                            x.id === f.id ? { ...x, roomId: e.target.value || null } : x,
                          ),
                        }))
                      }
                    >
                      <option value="">존 없음</option>
                      {data.rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                  )}
                  <Button
                    variant="danger"
                    title="삭제"
                    onClick={() =>
                      set((d) => ({ ...d, fixedActivities: d.fixedActivities.filter((x) => x.id !== f.id) }))
                    }
                  >
                    ×
                  </Button>
                </li>
              );
            })}
          </ul>

          {!activity ? (
            <Empty>왼쪽에서 활동을 고르세요.</Empty>
          ) : periods.length === 0 || data.days.length === 0 ? (
            <Empty>먼저 위에서 운영 요일과 교시를 만드세요.</Empty>
          ) : (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-tt-700">
                  {activity.name || "(이름 없는 활동)"} 자리 — 칸을 눌러 지정하세요
                </p>
                {activity.cells.length > 0 && (
                  <Button onClick={() => patch(activity.id, [])}>전체 해제</Button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="border-collapse select-none text-sm">
                  <thead>
                    <tr>
                      <th className="w-28 border border-tt-200 bg-tt-50 px-2 py-1 text-xs text-tt-600">교시</th>
                      {data.days.map((day, di) => (
                        <th
                          key={day}
                          className="min-w-20 cursor-pointer border border-tt-200 bg-tt-100 px-3 py-1.5 text-sm font-bold text-tt-800 hover:bg-tt-200"
                          onClick={() => toggleMany(dayPeriods(data, di).map((_, pi) => slotKey(di, pi)))}
                          title="이 요일 전체 토글"
                        >
                          {day}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((p, pi) => (
                      <tr key={p.id}>
                        <th
                          className="cursor-pointer border border-tt-200 bg-tt-50 px-2 py-1 text-left text-xs font-semibold text-tt-700 hover:bg-tt-100"
                          onClick={() => toggleMany(data.days.flatMap((_, di) => dayPeriods(data, di)[pi] ? [slotKey(di, pi)] : []))}
                          title="이 교시 전체 토글"
                        >
                          {p.label}
                          <span className="ml-1 font-normal text-tt-400">{p.start}</span>
                        </th>
                        {data.days.map((day, di) => {
                          const key = slotKey(di, pi);
                          const on = activity.cells.includes(key);
                          const other = !dayPeriods(data, di)[pi] ? "운영 없음" : takenElsewhere.get(key);
                          return (
                            <td
                              key={day}
                              onPointerDown={(e) => {
                                if (other) return;
                                e.preventDefault();
                                painting.current = !on;
                                applyPaint(key, !on);
                              }}
                              onPointerEnter={() => {
                                if (other) return;
                                if (painting.current !== null) applyPaint(key, painting.current);
                              }}
                              title={other ? `${other} 이(가) 이미 쓰는 칸입니다` : undefined}
                              className={`h-10 border border-tt-200 px-1 text-center text-[11px] font-semibold transition ${
                                other
                                  ? "cursor-not-allowed bg-tt-100 text-tt-400"
                                  : on
                                    ? "cursor-pointer bg-amber-500 text-white"
                                    : "cursor-pointer bg-white text-tt-300 hover:bg-tt-50"
                              }`}
                            >
                              {other ?? (on ? activity.name || "고정" : "")}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
