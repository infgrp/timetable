import { useMemo, useState } from "react";
import type { AppData, Course } from "../types";
import { buildLectures, emptyCourse, periodsOf, roomLoads } from "../store";
import { Button, Card, Empty, Select, TextInput } from "./ui";

type Props = { data: AppData; set: (fn: (d: AppData) => AppData) => void };

export default function CoursesPanel({ data, set }: Props) {
  const [openRow, setOpenRow] = useState<string | null>(null);

  const capacity = periodsOf(data.slots).length * data.days.length;
  const className = useMemo(() => new Map(data.classes.map((c) => [c.id, c.name])), [data.classes]);

  const totals = useMemo(() => {
    const lectures = buildLectures(data);
    const byClass = new Map<string, number>();
    const byTeacher = new Map<string, number>();
    for (const l of lectures) {
      byClass.set(l.classId, (byClass.get(l.classId) ?? 0) + l.hours);
      byTeacher.set(l.teacherId, (byTeacher.get(l.teacherId) ?? 0) + l.hours);
    }
    return { byClass, byTeacher };
  }, [data]);

  const loads = useMemo(() => roomLoads(data), [data]);

  const patch = (id: string, p: Partial<Course>) =>
    set((d) => ({ ...d, courses: d.courses.map((c) => (c.id === id ? { ...c, ...p } : c)) }));

  const addCourse = () =>
    set((d) => ({ ...d, courses: [...d.courses, emptyCourse(d.teachers[0]?.id ?? "")] }));

  const duplicate = (c: Course) =>
    set((d) => ({
      ...d,
      courses: [...d.courses, { ...c, id: `${c.id}_copy_${Math.random().toString(36).slice(2, 7)}` }],
    }));

  if (data.teachers.length === 0)
    return <Empty>먼저 [강사] 탭에서 강사를 추가하세요.</Empty>;

  return (
    <div className="flex flex-col gap-5">
      <Card
        title={`프로그램 배정 (${data.courses.length}건)`}
        desc="한 줄 = 한 강사가 한 프로그램을 여러 체험반에 맡는 배정입니다. 시수와 연속 2교시 횟수는 체험반마다 각각 적용됩니다."
        right={
          <Button variant="primary" onClick={addCourse}>
            + 배정 추가
          </Button>
        }
      >
        {data.courses.length === 0 ? (
          <Empty>배정이 없습니다. [+ 배정 추가]를 누르세요.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-tt-200 text-left text-xs font-semibold text-tt-600">
                  <th className="w-40 py-2">강사</th>
                  <th className="w-44 py-2">프로그램</th>
                  <th className="py-2">체험반</th>
                  <th className="w-24 py-2">주당 시수</th>
                  <th className="w-24 py-2">연속 2교시</th>
                  <th className="w-44 py-2">체험존</th>
                  <th className="w-24 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.courses.map((c) => {
                  const maxBlocks = Math.floor(c.hours / 2);
                  return (
                    <tr key={c.id} className="border-b border-tt-100 align-top last:border-0">
                      <td className="py-1.5 pr-2">
                        <Select
                          value={c.teacherId}
                          onChange={(e) => patch(c.id, { teacherId: e.target.value })}
                        >
                          <option value="">— 선택 —</option>
                          {data.teachers.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name || "(이름없음)"}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="py-1.5 pr-2">
                        <TextInput
                          value={c.subject}
                          placeholder="예) Airport & Immigration"
                          onChange={(e) => patch(c.id, { subject: e.target.value })}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <button
                          type="button"
                          onClick={() => setOpenRow(openRow === c.id ? null : c.id)}
                          className="w-full rounded-lg border border-tt-300 bg-white px-2.5 py-1.5 text-left text-sm hover:bg-tt-50"
                        >
                          {c.classIds.length === 0 ? (
                            <span className="text-tt-400">체험반 선택…</span>
                          ) : (
                            c.classIds.map((id) => className.get(id) ?? "?").join(", ")
                          )}
                        </button>
                        {openRow === c.id && (
                          <div className="mt-2 rounded-lg border border-tt-200 bg-tt-50 p-2">
                            <div className="mb-2 flex gap-2">
                              <Button
                                onClick={() => patch(c.id, { classIds: data.classes.map((k) => k.id) })}
                              >
                                전체 선택
                              </Button>
                              <Button onClick={() => patch(c.id, { classIds: [] })}>전체 해제</Button>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {data.classes.map((k) => {
                                const on = c.classIds.includes(k.id);
                                return (
                                  <button
                                    key={k.id}
                                    type="button"
                                    onClick={() =>
                                      patch(c.id, {
                                        classIds: on
                                          ? c.classIds.filter((x) => x !== k.id)
                                          : [...c.classIds, k.id],
                                      })
                                    }
                                    className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                                      on
                                        ? "border-tt-600 bg-tt-600 text-white"
                                        : "border-tt-300 bg-white text-tt-600 hover:bg-white"
                                    }`}
                                  >
                                    {k.name || "(이름없음)"}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 pr-2">
                        <TextInput
                          type="number"
                          min={1}
                          value={c.hours}
                          onChange={(e) => patch(c.id, { hours: Math.max(1, Number(e.target.value)) })}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <TextInput
                          type="number"
                          min={0}
                          max={maxBlocks}
                          value={c.blocks}
                          title="붙여서 진행할 2교시 묶음의 횟수"
                          onChange={(e) =>
                            patch(c.id, {
                              blocks: Math.max(0, Math.min(maxBlocks, Number(e.target.value))),
                            })
                          }
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <Select
                          value={c.roomId ?? ""}
                          onChange={(e) => patch(c.id, { roomId: e.target.value || null })}
                        >
                          <option value="">없음</option>
                          {data.rooms.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="py-1.5">
                        <div className="flex gap-1">
                          <Button onClick={() => duplicate(c)} title="복제">
                            ⧉
                          </Button>
                          <Button
                            variant="danger"
                            title="삭제"
                            onClick={() =>
                              set((d) => ({ ...d, courses: d.courses.filter((x) => x.id !== c.id) }))
                            }
                          >
                            ×
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="체험반별 총 시수" desc={`주당 운영 칸 ${capacity}칸`}>
          <div className="flex flex-wrap gap-2">
            {data.classes.map((k) => {
              const h = totals.byClass.get(k.id) ?? 0;
              const tone =
                h > capacity ? "bg-red-100 text-red-700" : h === capacity ? "bg-emerald-100 text-emerald-700" : "bg-tt-100 text-tt-700";
              return (
                <span key={k.id} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${tone}`}>
                  {k.name || "(이름없음)"} {h}/{capacity}
                </span>
              );
            })}
          </div>
        </Card>
        <Card
          title="체험존 사용률"
          desc={`존 하나가 쓸 수 있는 칸은 주당 ${capacity}칸입니다`}
        >
          {data.rooms.length === 0 ? (
            <p className="text-sm text-tt-500">지정된 체험존이 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {data.rooms.map((r) => {
                const load = loads.get(r.id) ?? 0;
                const pct = capacity > 0 ? Math.round((load / capacity) * 100) : 0;
                const tone =
                  load > capacity ? "bg-red-500" : pct > 85 ? "bg-amber-500" : "bg-tt-500";
                return (
                  <div key={r.id} className="flex items-center gap-2 text-xs">
                    <span className="w-32 shrink-0 font-semibold text-tt-700">{r.name}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-tt-100">
                      <span
                        className={`block h-full rounded-full ${tone}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </span>
                    <span className={`w-20 text-right ${load > capacity ? "font-bold text-red-600" : "text-tt-600"}`}>
                      {load}/{capacity}칸
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="강사별 총 시수">
          <div className="flex flex-wrap gap-2">
            {data.teachers.map((t) => {
              const h = totals.byTeacher.get(t.id) ?? 0;
              const free = capacity - t.unavailable.length;
              return (
                <span
                  key={t.id}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    h > free ? "bg-red-100 text-red-700" : "bg-tt-100 text-tt-700"
                  }`}
                  title={`가용 ${free}칸`}
                >
                  {t.name || "(이름없음)"} {h}시간
                </span>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
