import { useMemo, useState } from "react";
import type { AppData, Course } from "../types";
import { buildLectures, classCapacity, emptyCourse, programRoomMap, roomLoads, weekCapacity } from "../store";
import { Button, Card, Empty, Select, TextInput } from "./ui";

type Props = { data: AppData; set: (fn: (d: AppData) => AppData) => void };

export default function CoursesPanel({ data, set }: Props) {
  const [openRow, setOpenRow] = useState<string | null>(null);
  // 함께 들어가는 강사(팀티칭)를 고르는 줄. 자주 쓰지 않으니 눌러야 펼친다.
  const [coRow, setCoRow] = useState<string | null>(null);
  // 구간 탭: null = 전체, 그 외에는 Segment.id. 월·화반과 수·목·금반의 과목 구성이 다를 때 나눠 본다.
  const [segTab, setSegTab] = useState<string | null>(null);

  const capacity = weekCapacity(data);
  const className = useMemo(() => new Map(data.classes.map((c) => [c.id, c.name])), [data.classes]);

  // 선택된 구간에 속한 체험반 id 집합 (전체 탭이면 null)
  const segClassIds = useMemo(() => {
    // 탭에 잡아 둔 구간이 삭제됐으면 전체 보기로 (탭 바가 사라진 채 필터만 남지 않게)
    if (!segTab || !data.segments.some((s) => s.id === segTab)) return null;
    return new Set(data.classes.filter((c) => c.segmentId === segTab).map((c) => c.id));
  }, [segTab, data.classes, data.segments]);

  // 이 구간 탭에서 보여줄 배정 — 그 구간 반을 하나라도 맡거나, 아직 반이 없는 새 배정.
  const visibleCourses = useMemo(() => {
    if (!segClassIds) return data.courses;
    return data.courses.filter(
      (c) => c.classIds.length === 0 || c.classIds.some((id) => segClassIds.has(id)),
    );
  }, [data.courses, segClassIds]);

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

  /** 프로그램 이름 → 묶어 둔 체험존. 이름을 고치면 존을 따라 바꾼다. */
  const roomFor = (subject: string) => programRoomMap(data).get(subject.trim().toLowerCase()) ?? null;
  const patchSubject = (c: Course, subject: string) => {
    const linked = roomFor(subject);
    // 묶음이 있으면 존을 맞춰 준다. 묶음에 없는 이름이면 손으로 고른 존을 건드리지 않는다.
    patch(c.id, linked ? { subject, roomId: linked } : { subject });
  };

  const addCourse = () =>
    set((d) => {
      const made = emptyCourse(d.teachers[0]?.id ?? "");
      // 구간 탭이 켜져 있으면 그 구간의 반을 기본으로 담아 준다.
      if (segClassIds) made.classIds = d.classes.filter((c) => segClassIds.has(c.id)).map((c) => c.id);
      return { ...d, courses: [...d.courses, made] };
    });

  /** ── 프로그램–체험존 묶음 ── */
  const programNames = useMemo(
    () => [...new Set(data.courses.map((c) => c.subject.trim()).filter(Boolean))].sort(),
    [data.courses],
  );
  const setProgramRooms = (fn: (list: AppData["programRooms"]) => AppData["programRooms"]) =>
    set((d) => ({ ...d, programRooms: fn(d.programRooms ?? []) }));
  const addProgramRoom = () =>
    setProgramRooms((list) => [...list, { subject: "", roomId: data.rooms[0]?.id ?? "" }]);
  const patchProgramRoom = (i: number, p: Partial<AppData["programRooms"][number]>) =>
    setProgramRooms((list) => list.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const removeProgramRoom = (i: number) => setProgramRooms((list) => list.filter((_, k) => k !== i));
  /** 이미 존을 지정해 둔 배정에서 묶음을 뽑아 온다 (먼저 나온 존이 이긴다). */
  const pullProgramRooms = () =>
    setProgramRooms((list) => {
      const have = new Set(list.map((p) => p.subject.trim().toLowerCase()));
      const out = [...list];
      for (const c of data.courses) {
        const key = c.subject.trim().toLowerCase();
        if (!key || !c.roomId || have.has(key)) continue;
        have.add(key);
        out.push({ subject: c.subject.trim(), roomId: c.roomId });
      }
      return out;
    });
  /** 묶음에 있는 프로그램의 배정 체험존을 한 번에 맞춘다. */
  const applyProgramRooms = () => {
    const map = programRoomMap(data);
    let n = 0;
    set((d) => ({
      ...d,
      courses: d.courses.map((c) => {
        const linked = map.get(c.subject.trim().toLowerCase());
        if (!linked || c.roomId === linked) return c;
        n += 1;
        return { ...c, roomId: linked };
      }),
    }));
    alert(n === 0 ? "바꿀 배정이 없습니다." : `배정 ${n}건의 체험존을 묶음에 맞췄습니다.`);
  };

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
        desc="한 줄 = 한 강사가 한 프로그램을 여러 체험반에 맡는 배정입니다. 강사를 비워 두면 자리만 잡고 나중에 채울 수 있고, 두 강사가 같이 들어가면 [함께 들어가는 강사]로 묶습니다. 시수와 연속 2교시 횟수는 체험반마다 각각 적용됩니다. 같은 반의 같은 프로그램은 하루에 한 번만 배치되며, 요일이 정해진 과목은 [지정 요일]을 켜세요."
        right={
          <Button variant="primary" onClick={addCourse}>
            + 배정 추가
          </Button>
        }
      >
        {data.segments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSegTab(null)}
              className={`rounded-md px-3 py-1.5 text-xs font-bold ${
                segTab === null ? "bg-tt-600 text-white" : "bg-tt-100 text-tt-600 hover:bg-tt-200"
              }`}
            >
              전체
            </button>
            {data.segments.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSegTab(s.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-bold ${
                  segTab === s.id ? "bg-tt-600 text-white" : "bg-tt-100 text-tt-600 hover:bg-tt-200"
                }`}
              >
                {s.name || "(이름없는 구간)"}
              </button>
            ))}
          </div>
        )}
        {data.courses.length === 0 ? (
          <Empty>배정이 없습니다. [+ 배정 추가]를 누르세요.</Empty>
        ) : visibleCourses.length === 0 ? (
          <Empty>이 구간에 배정된 프로그램이 없습니다. [+ 배정 추가]를 누르면 이 구간 반이 담긴 채로 시작합니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-tt-200 text-left text-xs font-semibold text-tt-600">
                  <th className="w-40 py-2" title="비워 두면 자리는 잡되 강사 칸이 빈 채로 나옵니다. 두 명 이상이 함께 맡으면 [+ 함께 들어가는 강사]로 고르세요.">강사</th>
                  <th className="w-44 py-2">프로그램</th>
                  <th className="py-2">체험반</th>
                  <th className="w-24 py-2">주당 시수</th>
                  <th className="w-24 py-2">연속 2교시</th>
                  <th className="w-44 py-2">체험존</th>
                  <th className="w-32 py-2" title="비워 두면 아무 요일에나 들어갑니다">지정 요일</th>
                  <th className="w-24 py-2" title="체험반 시간표에 강사 이름을 적을지">강사 표기</th>
                  {data.segments.length > 0 && (
                    <th
                      className="w-24 py-2"
                      title="기본은 하루 1회 — 같은 반에서 하루에 한 번씩이면 여러 날에 나옵니다. 존 체험처럼 한 구간(예: 월·화)에 딱 한 번이어야 하는 프로그램만 켜세요."
                    >
                      구간당 1회
                    </th>
                  )}
                  <th className="w-24 py-2" />
                </tr>
              </thead>
              <tbody>
                {visibleCourses.map((c) => {
                  const maxBlocks = Math.floor(c.hours / 2);
                  return (
                    <tr key={c.id} className="border-b border-tt-100 align-top last:border-0">
                      <td className="py-1.5 pr-2">
                        <Select
                          value={c.teacherId}
                          onChange={(e) => patch(c.id, { teacherId: e.target.value })}
                        >
                          <option value="">— 미지정 (나중에 채움) —</option>
                          {data.teachers.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name || "(이름없음)"}
                            </option>
                          ))}
                        </Select>
                        {data.teachers.length > 1 && (
                          <div className="mt-1">
                            <button
                              type="button"
                              onClick={() => setCoRow(coRow === c.id ? null : c.id)}
                              className="text-[11px] font-semibold text-tt-600 underline-offset-2 hover:underline"
                            >
                              {(c.coTeacherIds ?? []).length > 0
                                ? `함께 ${(c.coTeacherIds ?? []).length}명`
                                : "+ 함께 들어가는 강사"}
                            </button>
                            {coRow === c.id && (
                              <div className="mt-1 flex flex-wrap gap-1 rounded-lg border border-tt-200 bg-tt-50 p-1.5">
                                {data.teachers
                                  .filter((t) => t.id !== c.teacherId)
                                  .map((t) => {
                                    const on = (c.coTeacherIds ?? []).includes(t.id);
                                    return (
                                      <button
                                        key={t.id}
                                        type="button"
                                        onClick={() =>
                                          patch(c.id, {
                                            coTeacherIds: on
                                              ? (c.coTeacherIds ?? []).filter((x) => x !== t.id)
                                              : [...(c.coTeacherIds ?? []), t.id],
                                          })
                                        }
                                        className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
                                          on
                                            ? "border-tt-600 bg-tt-600 text-white"
                                            : "border-tt-300 bg-white text-tt-600 hover:bg-white"
                                        }`}
                                      >
                                        {t.name || "(이름없음)"}
                                      </button>
                                    );
                                  })}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 pr-2">
                        <TextInput
                          list="tt-program-options"
                          value={c.subject}
                          placeholder="예) Airport & Immigration"
                          onChange={(e) => patchSubject(c, e.target.value)}
                        />
                        <TextInput
                          value={c.teacherSubject ?? ""}
                          placeholder="강사 표기(선택) 예) Adventure ①"
                          title="비우면 위 프로그램명을 그대로 씁니다. 강사 개인 시간표에만 이 이름이 나옵니다."
                          onChange={(e) => patch(c.id, { teacherSubject: e.target.value })}
                          className="mt-1 text-xs"
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
                      <td className="py-1.5 pr-2">
                        <div className="flex flex-wrap gap-1 pt-1.5">
                          {data.days.map((day, di) => {
                            const on = (c.days ?? []).includes(di);
                            return (
                              <button
                                key={day}
                                type="button"
                                title={on ? `${day}요일에만 배치` : "누르면 이 요일로 못 박습니다"}
                                onClick={() => {
                                  const next = on
                                    ? (c.days ?? []).filter((x) => x !== di)
                                    : [...(c.days ?? []), di].sort((a, b) => a - b);
                                  patch(c.id, { days: next.length > 0 ? next : undefined });
                                }}
                                className={`h-6 w-6 rounded border text-[11px] font-bold transition ${
                                  on
                                    ? "border-tt-600 bg-tt-600 text-white"
                                    : "border-tt-200 bg-white text-tt-400 hover:bg-tt-50"
                                }`}
                              >
                                {day}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="py-1.5 pr-2">
                        <label className="flex cursor-pointer items-center gap-1.5 pt-2 text-xs font-semibold text-tt-600">
                          <input
                            type="checkbox"
                            checked={!c.hideTeacher}
                            onChange={(e) => patch(c.id, { hideTeacher: !e.target.checked })}
                          />
                          {c.hideTeacher ? "숨김" : "표기"}
                        </label>
                      </td>
                      {data.segments.length > 0 && (
                        <td className="py-1.5 pr-2">
                          <label
                            className="flex cursor-pointer items-center gap-1.5 pt-2 text-xs font-semibold text-tt-600"
                            title="켜면 이 프로그램을 구간 안에 딱 한 번만 넣는다 (기본은 하루 1회)"
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(c.oncePerSegment)}
                              onChange={(e) => patch(c.id, { oncePerSegment: e.target.checked || undefined })}
                            />
                            {c.oncePerSegment ? "구간 1회" : "하루 1회"}
                          </label>
                        </td>
                      )}
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

      <Card
        title={`프로그램–체험존 묶음 (${(data.programRooms ?? []).length}개)`}
        desc="프로그램마다 쓰는 존이 정해져 있다면 여기에 묶어 두세요. 위 배정에서 그 프로그램 이름을 적으면 체험존이 자동으로 채워집니다."
        right={
          <div className="flex gap-1.5">
            <Button onClick={pullProgramRooms}>지금 배정에서 가져오기</Button>
            <Button variant="primary" onClick={addProgramRoom}>
              + 묶음 추가
            </Button>
          </div>
        }
      >
        {data.rooms.length === 0 ? (
          <Empty>먼저 [체험반·체험존] 탭에서 체험존을 만드세요.</Empty>
        ) : (data.programRooms ?? []).length === 0 ? (
          <Empty>
            묶음이 없습니다. [지금 배정에서 가져오기]를 누르면 이미 존을 지정해 둔 프로그램이 한 번에 들어옵니다.
          </Empty>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {(data.programRooms ?? []).map((pr, i) => (
              <li key={`${pr.subject}-${i}`} className="flex items-center gap-2">
                <TextInput
                  list="tt-program-options"
                  value={pr.subject}
                  placeholder="프로그램 이름"
                  onChange={(e) => patchProgramRoom(i, { subject: e.target.value })}
                />
                <Select value={pr.roomId} onChange={(e) => patchProgramRoom(i, { roomId: e.target.value })}>
                  {data.rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name || "(이름없음)"}
                    </option>
                  ))}
                </Select>
                <Button variant="danger" title="삭제" onClick={() => removeProgramRoom(i)}>
                  ×
                </Button>
              </li>
            ))}
          </ul>
        )}
        {(data.programRooms ?? []).length > 0 && (
          <div className="mt-3">
            <Button onClick={applyProgramRooms}>묶음대로 기존 배정의 체험존 맞추기</Button>
          </div>
        )}
      </Card>

      <datalist id="tt-program-options">
        {programNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="체험반별 총 시수" desc="그 반이 오는 요일과 고정 활동을 뺀 실제 칸 수와 견줍니다">
          <div className="flex flex-wrap gap-2">
            {data.classes.map((k) => {
              const h = totals.byClass.get(k.id) ?? 0;
              // 반마다 오는 요일이 다를 수 있으므로 그 반이 실제로 쓸 수 있는 칸과 견준다.
              const room = classCapacity(data, k);
              const tone =
                h > room ? "bg-red-100 text-red-700" : h === room ? "bg-emerald-100 text-emerald-700" : "bg-tt-100 text-tt-700";
              return (
                <span key={k.id} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${tone}`}>
                  {k.name || "(이름없음)"} {h}/{room}
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
