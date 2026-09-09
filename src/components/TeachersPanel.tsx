import { useEffect, useRef, useState } from "react";
import type { AppData } from "../types";
import { emptyTeacher, slotKey } from "../store";
import { calendarPeriods, dayPeriods } from "../calendar";
import { Button, Card, Empty, Field, TextInput } from "./ui";

type Props = { data: AppData; set: (fn: (d: AppData) => AppData) => void };

export default function TeachersPanel({ data, set }: Props) {
  const [selected, setSelected] = useState<string | null>(data.teachers[0]?.id ?? null);
  const [bulk, setBulk] = useState("");
  const painting = useRef<null | boolean>(null);

  useEffect(() => {
    if (selected && data.teachers.some((t) => t.id === selected)) return;
    setSelected(data.teachers[0]?.id ?? null);
  }, [data.teachers, selected]);

  useEffect(() => {
    const stop = () => (painting.current = null);
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

  const periods = calendarPeriods(data);
  const teacher = data.teachers.find((t) => t.id === selected) ?? null;

  const setUnavailable = (keys: string[]) =>
    set((d) => ({
      ...d,
      teachers: d.teachers.map((t) => (t.id === selected ? { ...t, unavailable: keys } : t)),
    }));

  const applyPaint = (key: string, on: boolean) => {
    if (!teacher) return;
    const has = teacher.unavailable.includes(key);
    if (on === has) return;
    setUnavailable(on ? [...teacher.unavailable, key] : teacher.unavailable.filter((k) => k !== key));
  };

  const toggleMany = (keys: string[]) => {
    if (!teacher) return;
    const allOn = keys.every((k) => teacher.unavailable.includes(k));
    const set0 = new Set(teacher.unavailable);
    for (const k of keys) {
      if (allOn) set0.delete(k);
      else set0.add(k);
    }
    setUnavailable([...set0]);
  };

  const addBulk = () => {
    const names = bulk
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    set((d) => ({ ...d, teachers: [...d.teachers, ...names.map((n) => emptyTeacher(n))] }));
    setBulk("");
  };

  const removeTeacher = (id: string) =>
    set((d) => ({
      ...d,
      teachers: d.teachers.filter((t) => t.id !== id),
      courses: d.courses.filter((c) => c.teacherId !== id),
      timetable: d.timetable.map((a) => a.teacherId === id ? { ...a, teacherId: null } : a),
      rotation: { ...d.rotation, groups: d.rotation.groups.map((g) => ({ ...g, teacherIds: g.teacherIds.filter((t) => t !== id) })) },
    }));

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <Card title={`강사 (${data.teachers.length}명)`}>
        <div className="mb-3 flex flex-col gap-2">
          <Field label="여러 명 한 번에 추가" hint="줄바꿈 또는 쉼표로 구분">
            <textarea
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              rows={3}
              placeholder={"김철수\n이영희, 박민수"}
              className="w-full rounded-lg border border-tt-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-tt-500 focus:ring-2 focus:ring-tt-200"
            />
          </Field>
          <div className="flex gap-2">
            <Button variant="primary" onClick={addBulk} disabled={!bulk.trim()}>
              + 추가
            </Button>
            <Button
              onClick={() => {
                const t = emptyTeacher("");
                set((d) => ({ ...d, teachers: [...d.teachers, t] }));
                setSelected(t.id);
              }}
            >
              + 빈 강사
            </Button>
          </div>
        </div>

        {data.teachers.length === 0 ? (
          <Empty>강사를 추가하세요.</Empty>
        ) : (
          <ul className="max-h-[520px] overflow-y-auto">
            {data.teachers.map((t) => {
              const on = t.id === selected;
              return (
                <li key={t.id} className="flex items-center gap-1 border-b border-tt-100 py-1 last:border-0">
                  <button
                    type="button"
                    onClick={() => setSelected(t.id)}
                    className={`h-7 shrink-0 rounded px-2 text-xs font-bold ${
                      on ? "bg-tt-600 text-white" : "bg-tt-100 text-tt-600"
                    }`}
                    title="회피 시간 편집"
                  >
                    {t.unavailable.length > 0 ? `회피 ${t.unavailable.length}` : "회피 없음"}
                  </button>
                  <TextInput
                    value={t.name}
                    placeholder="강사명"
                    onFocus={() => setSelected(t.id)}
                    onChange={(e) =>
                      set((d) => ({
                        ...d,
                        teachers: d.teachers.map((x) =>
                          x.id === t.id ? { ...x, name: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                  <Button variant="danger" onClick={() => removeTeacher(t.id)} title="삭제">
                    ×
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card
        title={teacher ? `${teacher.name || "(이름없음)"} 선생님 회피 시간` : "회피 시간"}
        desc="프로그램을 넣지 않을 칸을 눌러 표시합니다. 끌어서 여러 칸을 한 번에 칠할 수 있고, 요일·교시 머리글을 누르면 줄 전체가 바뀝니다."
        right={
          teacher && teacher.unavailable.length > 0 ? (
            <Button onClick={() => setUnavailable([])}>전체 해제</Button>
          ) : undefined
        }
      >
        {!teacher ? (
          <Empty>왼쪽에서 강사를 선택하세요.</Empty>
        ) : periods.length === 0 || data.days.length === 0 ? (
          <Empty>먼저 [운영 시간]에서 요일과 교시를 만드세요.</Empty>
        ) : (
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
                      const off = teacher.unavailable.includes(key);
                      const exists = Boolean(dayPeriods(data, di)[pi]);
                      return (
                        <td
                          key={day}
                          onPointerDown={(e) => {
                            if (!exists) return;
                            e.preventDefault();
                            painting.current = !off;
                            applyPaint(key, !off);
                          }}
                          onPointerEnter={() => {
                            if (!exists) return;
                            if (painting.current !== null) applyPaint(key, painting.current);
                          }}
                          className={`h-10 cursor-pointer border border-tt-200 text-center text-xs font-semibold transition ${
                            off ? "bg-red-500 text-white" : "bg-white text-tt-300 hover:bg-tt-50"
                          }`}
                        >
                          {!exists ? "운영 없음" : off ? "회피" : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
