import { useState } from "react";
import type { AppData, Klass } from "../types";
import { allowedDaysOf, newClassGroup, newSegment, uid } from "../store";
import { Button, Card, Empty, Field, Select, TextInput } from "./ui";

type Props = { data: AppData; set: (fn: (d: AppData) => AppData) => void };

const ZONE_PRESET = [
  "공항·출입국존",
  "레스토랑존",
  "마트·쇼핑존",
  "병원·클리닉존",
  "미디어 스튜디오",
  "컬처룸",
  "호텔·트래블존",
  "도서관·리딩룸",
];

export default function ClassesPanel({ data, set }: Props) {
  const [scheme, setScheme] = useState<"alpha" | "num" | "grade">("alpha");
  const [prefix, setPrefix] = useState("1");
  const [count, setCount] = useState(6);
  const [roomName, setRoomName] = useState("");
  const [newFor, setNewFor] = useState<string>("");

  const previewNames = () => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      if (scheme === "alpha") out.push(`TEAM ${String.fromCharCode(65 + (i % 26))}`);
      else if (scheme === "num") out.push(`${i + 1}반`);
      else out.push(`${prefix}-${i + 1}`);
    }
    return out;
  };

  const bulkAddClasses = () =>
    set((d) => {
      const existing = new Set(d.classes.map((c) => c.name));
      const added: Klass[] = previewNames()
        .filter((name) => !existing.has(name))
        .map((name) => ({ id: uid("k"), name, segmentId: newFor || null }));
      return { ...d, classes: [...d.classes, ...added] };
    });

  const addRoom = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((d) =>
      d.rooms.some((r) => r.name === trimmed)
        ? d
        : { ...d, rooms: [...d.rooms, { id: uid("r"), name: trimmed }] },
    );
  };

  const removeClass = (id: string) =>
    set((d) => ({
      ...d,
      classes: d.classes.filter((c) => c.id !== id),
      courses: d.courses.map((c) => ({ ...c, classIds: c.classIds.filter((x) => x !== id) })),
      timetable: d.timetable.filter((a) => a.classId !== id),
    }));

  const removeRoom = (id: string) =>
    set((d) => ({
      ...d,
      rooms: d.rooms.filter((r) => r.id !== id),
      courses: d.courses.map((c) => (c.roomId === id ? { ...c, roomId: null } : c)),
      timetable: d.timetable.map((a) => (a.roomId === id ? { ...a, roomId: null } : a)),
    }));

  /** 월·화 / 수·목·금처럼 흔한 나눔을 한 번에 */
  const splitPreset = () =>
    set((d) => {
      if (d.days.length < 3) return d;
      const cut = Math.min(2, d.days.length - 1);
      const first = newSegment(d.days.slice(0, cut).join("·"), d.days.map((_, i) => i).slice(0, cut));
      const second = newSegment(d.days.slice(cut).join("·"), d.days.map((_, i) => i).slice(cut));
      return { ...d, segments: [...d.segments, first, second] };
    });

  const toggleSegDay = (segId: string, dayIndex: number) =>
    set((d) => ({
      ...d,
      segments: d.segments.map((s) =>
        s.id === segId
          ? {
              ...s,
              days: s.days.includes(dayIndex)
                ? s.days.filter((x) => x !== dayIndex)
                : [...s.days, dayIndex].sort((a, b) => a - b),
            }
          : s,
      ),
    }));

  const removeSegment = (segId: string) =>
    set((d) => ({
      ...d,
      segments: d.segments.filter((s) => s.id !== segId),
      classes: d.classes.map((c) => (c.segmentId === segId ? { ...c, segmentId: null } : c)),
    }));

  const preview = previewNames();
  const unusedPresets = ZONE_PRESET.filter((n) => !data.rooms.some((r) => r.name === n));
  const hasSegments = data.segments.length > 0;
  const countIn = (segId: string) => data.classes.filter((c) => c.segmentId === segId).length;

  return (
    <div className="flex flex-col gap-5">
      <Card
        title={`운영 구간 (${data.segments.length}개)`}
        desc="월·화에 오는 학년과 수·목·금에 오는 학년이 다를 때 나눕니다. 구간을 정해 두면 그 반은 자기 요일에만 배치되고, 시간표는 하나로 합쳐져 나옵니다."
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => set((d) => ({ ...d, segments: [...d.segments, newSegment(`구간 ${d.segments.length + 1}`)] }))}
          >
            + 구간 추가
          </Button>
          {data.segments.length === 0 && data.days.length >= 3 && (
            <Button onClick={splitPreset}>
              {data.days.slice(0, 2).join("·")} / {data.days.slice(2).join("·")} 로 나누기
            </Button>
          )}
        </div>

        {data.segments.length === 0 ? (
          <div className="mt-4">
            <Empty>구간을 나누지 않으면 모든 체험반이 모든 운영 요일에 옵니다. 그대로 두어도 됩니다.</Empty>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {data.segments.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-tt-200 p-2">
                <div className="w-44">
                  <TextInput
                    value={s.name}
                    placeholder="예) 월·화 (3학년)"
                    onChange={(e) =>
                      set((d) => ({
                        ...d,
                        segments: d.segments.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)),
                      }))
                    }
                  />
                </div>
                <div className="flex flex-wrap gap-1">
                  {data.days.map((day, di) => {
                    const on = s.days.includes(di);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleSegDay(s.id, di)}
                        className={`h-8 w-8 rounded-lg border text-sm font-bold transition ${
                          on
                            ? "border-tt-600 bg-tt-600 text-white"
                            : "border-tt-300 bg-white text-tt-500 hover:bg-tt-50"
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
                <span className="text-xs font-semibold text-tt-500">체험반 {countIn(s.id)}개</span>
                <Button variant="danger" title="구간 삭제" onClick={() => removeSegment(s.id)}>
                  ×
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title={`체험반 (${data.classes.length}개)`}
        desc="시간표가 만들어지는 단위입니다. 캠프반이든 방문 학급이든, 한 팀이 곧 한 줄의 시간표가 됩니다."
      >
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-36">
            <Field label="이름 형식">
              <Select value={scheme} onChange={(e) => setScheme(e.target.value as typeof scheme)}>
                <option value="alpha">TEAM A, TEAM B …</option>
                <option value="num">1반, 2반 …</option>
                <option value="grade">3-1, 3-2 … (방문 학급)</option>
              </Select>
            </Field>
          </div>
          {scheme === "grade" && (
            <div className="w-24">
              <Field label="학년">
                <TextInput value={prefix} onChange={(e) => setPrefix(e.target.value)} />
              </Field>
            </div>
          )}
          <div className="w-24">
            <Field label="반 수">
              <TextInput
                type="number"
                min={1}
                max={40}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(40, Number(e.target.value))))}
              />
            </Field>
          </div>
          {hasSegments && (
            <div className="w-44">
              <Field label="어느 구간에">
                <Select value={newFor} onChange={(e) => setNewFor(e.target.value)}>
                  <option value="">구간 없음 (모든 요일)</option>
                  {data.segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name || "(이름없음)"}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          <Button variant="primary" onClick={bulkAddClasses}>
            {preview[0]} ~ {preview[preview.length - 1]} 추가
          </Button>
          <Button
            onClick={() =>
              set((d) => ({ ...d, classes: [...d.classes, { id: uid("k"), name: "", segmentId: newFor || null }] }))
            }
          >
            + 빈 반
          </Button>
        </div>

        {data.classes.length === 0 ? (
          <Empty>체험반이 없습니다. 위에서 추가하세요.</Empty>
        ) : (
          <div className={`grid gap-2 ${hasSegments ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-3 lg:grid-cols-5"}`}>
            {data.classes.map((c) => (
              <div key={c.id} className="flex items-center gap-1">
                <TextInput
                  value={c.name}
                  placeholder="TEAM A"
                  onChange={(e) =>
                    set((d) => ({
                      ...d,
                      classes: d.classes.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)),
                    }))
                  }
                />
                {hasSegments && (
                  <div className="w-36 shrink-0">
                    <Select
                      value={c.segmentId ?? ""}
                      title={`오는 날: ${allowedDaysOf(data, c).map((i) => data.days[i]).join("·") || "-"}`}
                      onChange={(e) =>
                        set((d) => ({
                          ...d,
                          classes: d.classes.map((x) =>
                            x.id === c.id ? { ...x, segmentId: e.target.value || null } : x,
                          ),
                        }))
                      }
                    >
                      <option value="">모든 요일</option>
                      {data.segments.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name || "(이름없음)"}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                <Button variant="danger" onClick={() => removeClass(c.id)} title="삭제">
                  ×
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title={`체험반 묶음 (${(data.classGroups ?? []).length}개)`}
        desc="구간이 다른 두 반을 한 장으로 묶어 봅니다. 월·화에 오는 반과 수·목·금에 오는 반이 같은 팀 자리를 쓸 때, 합쳐서 인쇄하거나 받을 수 있습니다. 배치에는 영향을 주지 않습니다."
        right={
          <Button variant="primary" onClick={() => set((d) => ({ ...d, classGroups: [...(d.classGroups ?? []), newClassGroup("", [])] }))}>
            + 묶음 추가
          </Button>
        }
      >
        {(data.classGroups ?? []).length === 0 ? (
          <Empty>묶음이 없습니다. 합쳐 보고 싶은 반이 있으면 추가하세요.</Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {(data.classGroups ?? []).map((g) => {
              const picked = g.classIds.filter((id) => data.classes.some((c) => c.id === id));
              // 요일이 겹치면 한 장에 다 담기지 않는다 — 먼저 고른 반이 이긴다.
              const seen = new Set<number>();
              let clash = false;
              for (const id of picked) {
                const k = data.classes.find((c) => c.id === id)!;
                for (const d of allowedDaysOf(data, k)) {
                  if (seen.has(d)) clash = true;
                  seen.add(d);
                }
              }
              return (
                <li key={g.id} className="rounded-lg border border-tt-200 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <TextInput
                      value={g.name}
                      placeholder="TEAM C"
                      onChange={(e) =>
                        set((d) => ({
                          ...d,
                          classGroups: (d.classGroups ?? []).map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)),
                        }))
                      }
                    />
                    <Button
                      variant="danger"
                      title="삭제"
                      onClick={() => set((d) => ({ ...d, classGroups: (d.classGroups ?? []).filter((x) => x.id !== g.id) }))}
                    >
                      ×
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {data.classes.map((c) => {
                      const on = g.classIds.includes(c.id);
                      const seg = data.segments.find((x) => x.id === c.segmentId);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() =>
                            set((d) => ({
                              ...d,
                              classGroups: (d.classGroups ?? []).map((x) =>
                                x.id === g.id
                                  ? { ...x, classIds: on ? x.classIds.filter((i) => i !== c.id) : [...x.classIds, c.id] }
                                  : x,
                              ),
                            }))
                          }
                          className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                            on ? "border-tt-600 bg-tt-600 text-white" : "border-tt-300 bg-white text-tt-600 hover:bg-tt-50"
                          }`}
                          title={seg ? seg.name : "구간 없음"}
                        >
                          {c.name || "(이름없음)"}
                          {seg ? ` · ${seg.name}` : ""}
                        </button>
                      );
                    })}
                  </div>
                  {clash && (
                    <p className="mt-2 text-xs font-semibold text-amber-700">
                      고른 반들이 같은 요일에 옵니다. 그 요일은 먼저 고른 반의 시간표만 나옵니다.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card
        title={`체험존 (${data.rooms.length}개)`}
        desc="같은 교시에 한 팀만 들어갈 수 있는 공간입니다. 체험센터에서는 보통 여기가 병목이 되므로, 프로그램마다 존을 지정해 두면 겹치지 않게 배치합니다."
      >
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label="체험존 이름">
              <TextInput
                value={roomName}
                placeholder="예) 공항·출입국존"
                onChange={(e) => setRoomName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  addRoom(roomName);
                  setRoomName("");
                }}
              />
            </Field>
          </div>
          <Button
            variant="primary"
            disabled={!roomName.trim()}
            onClick={() => {
              addRoom(roomName);
              setRoomName("");
            }}
          >
            + 추가
          </Button>
        </div>

        {unusedPresets.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-tt-600">자주 쓰는 존:</span>
            {unusedPresets.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => addRoom(n)}
                className="rounded-md border border-dashed border-tt-300 px-2 py-1 text-xs font-semibold text-tt-600 hover:border-tt-500 hover:bg-tt-50"
              >
                + {n}
              </button>
            ))}
          </div>
        )}

        {data.rooms.length === 0 ? (
          <Empty>존을 쓰지 않는 프로그램만 있다면 비워 두어도 됩니다.</Empty>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {data.rooms.map((r) => (
              <div key={r.id} className="flex items-center gap-1">
                <TextInput
                  value={r.name}
                  onChange={(e) =>
                    set((d) => ({
                      ...d,
                      rooms: d.rooms.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)),
                    }))
                  }
                />
                <Button variant="danger" onClick={() => removeRoom(r.id)} title="삭제">
                  ×
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
