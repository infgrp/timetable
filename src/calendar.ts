import type { AppData, Assignment, DaySlot } from "./types";

export const slotsFor = (data: Pick<AppData, "days" | "slots" | "daySlots">, day: number): DaySlot[] =>
  data.daySlots?.[data.days[day]] ?? data.slots;

export const dayPeriods = (data: AppData, day: number): DaySlot[] =>
  slotsFor(data, day).filter((s) => s.kind === "period");

/** 공통 교시 번호 축. 요일마다 교시 수가 달라도 모든 교시를 포함한다. */
export function calendarPeriods(data: AppData): DaySlot[] {
  const lists = data.days.map((_, d) => dayPeriods(data, d));
  return Array.from({ length: Math.max(0, ...lists.map((s) => s.length)) }, (_, p) =>
    lists.find((s) => s[p])![p]);
}

/** 요일 배열이 바뀌어도 남아 있는 요일의 의미를 유지한다. */
export function changeDays(data: AppData, days: string[]): AppData {
  const remap = (d: number) => days.indexOf(data.days[d]);
  const cells = (keys: string[]) => keys.flatMap((key) => {
    const [d, p] = key.split(":").map(Number);
    const next = remap(d);
    return next < 0 ? [] : [`${next}:${p}`];
  });
  return {
    ...data, days,
    fixedActivities: data.fixedActivities.map((f) => ({ ...f, cells: cells(f.cells) })),
    teachers: data.teachers.map((t) => ({ ...t, unavailable: cells(t.unavailable) })),
    segments: data.segments.map((s) => ({ ...s, days: s.days.map(remap).filter((d) => d >= 0) })),
    timetable: data.timetable.flatMap((a) => remap(a.day) < 0 ? [] : [{ ...a, day: remap(a.day) }]),
  };
}

/** 칸 삭제·이동 시 교시 ID로 참조를 옮긴다. 재생성 때는 교시 번호를 유지한다. */
export function changeSlots(data: AppData, dayName: string, slots: DaySlot[], byIndex = false): AppData {
  const next: AppData = dayName
    ? { ...data, daySlots: { ...data.daySlots, [dayName]: slots } }
    : { ...data, slots };
  const maps = data.days.map((name, d) => {
    const before = dayPeriods(data, d);
    const after = dayPeriods(next, d);
    const affected = dayName ? name === dayName : !data.daySlots?.[name];
    return before.map((s, p) => !affected ? p : byIndex ? (after[p] ? p : -1) : after.findIndex((x) => x.id === s.id));
  });
  const cells = (keys: string[]) => keys.flatMap((key) => {
    const [d, p] = key.split(":").map(Number);
    const mapped = maps[d]?.[p] ?? -1;
    return mapped < 0 ? [] : [`${d}:${mapped}`];
  });
  const timetable: Assignment[] = data.timetable.flatMap((a) => {
    const ps = Array.from({ length: a.length }, (_, k) => maps[a.day]?.[a.period + k] ?? -1).filter((p) => p >= 0);
    if (ps.length === 2 && ps[1] === ps[0] + 1) return [{ ...a, period: ps[0] }];
    return ps.map((period, i) => ({ ...a, id: i ? `${a.id}_split` : a.id, period, length: 1 as const }));
  });
  return {
    ...next, timetable,
    fixedActivities: data.fixedActivities.map((f) => ({ ...f, cells: cells(f.cells) })),
    teachers: data.teachers.map((t) => ({ ...t, unavailable: cells(t.unavailable) })),
  };
}

export function scopeData(data: AppData, segmentId = ""): AppData {
  if (!segmentId) return data;
  const classes = data.classes.filter((c) => c.segmentId === segmentId);
  const ids = new Set(classes.map((c) => c.id));
  return { ...data, classes, courses: data.courses.map((c) => ({ ...c, classIds: c.classIds.filter((id) => ids.has(id)) })).filter((c) => c.classIds.length) };
}

export function mergeSolved(data: AppData, classIds: string[], list: Assignment[]): AppData {
  const ids = new Set(classIds);
  return { ...data, timetable: [...data.timetable.filter((a) => !ids.has(a.classId)), ...list] };
}
