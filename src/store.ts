import type {
  AppData,
  Course,
  DaySlot,
  FixedActivity,
  Klass,
  Lecture,
  RotationConfig,
  Segment,
  SolveRequest,
  Teacher,
} from "./types";
import { calendarPeriods, dayPeriods, slotsFor } from "./calendar";

export const STORAGE_KEY = "timetable.data.v1";

let seq = 0;
export function uid(prefix = "id"): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export const ALL_DAYS = ["월", "화", "수", "목", "금", "토", "일"];

/** 시작 시각(분) + 길이(분) → "HH:MM" */
function hhmm(totalMinutes: number): string {
  const m = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

export type SlotGenOptions = {
  firstStart: string;
  periodMinutes: number;
  breakMinutes: number;
  periodCount: number;
  /** 몇 교시 뒤에 점심을 넣을지. 0이면 넣지 않음. */
  lunchAfter: number;
  lunchMinutes: number;
};

/** 영어체험센터 표준 운영에 맞춘 기본값 — 09:00 시작, 40분 프로그램, 6교시. */
export const DEFAULT_GEN: SlotGenOptions = {
  firstStart: "09:00",
  periodMinutes: 40,
  breakMinutes: 10,
  periodCount: 6,
  lunchAfter: 4,
  lunchMinutes: 60,
};

/** 1교시 시작 시각과 수업·쉬는시간 길이로 하루 시간표 칸을 만든다. */
export function generateSlots(opt: SlotGenOptions): DaySlot[] {
  const out: DaySlot[] = [];
  let t = parseHHMM(opt.firstStart);
  for (let i = 1; i <= opt.periodCount; i++) {
    out.push({
      id: uid("slot"),
      kind: "period",
      label: `${i}교시`,
      start: hhmm(t),
      end: hhmm(t + opt.periodMinutes),
    });
    t += opt.periodMinutes;
    if (opt.lunchAfter > 0 && i === opt.lunchAfter && i < opt.periodCount) {
      out.push({
        id: uid("slot"),
        kind: "break",
        label: "점심시간",
        start: hhmm(t),
        end: hhmm(t + opt.lunchMinutes),
      });
      t += opt.lunchMinutes;
    } else if (i < opt.periodCount) {
      t += opt.breakMinutes;
    }
  }
  return out;
}

export function emptyTeacher(name = ""): Teacher {
  return { id: uid("t"), name, unavailable: [] };
}

export function emptyCourse(teacherId: string): Course {
  return {
    id: uid("c"),
    teacherId,
    subject: "",
    classIds: [],
    hours: 1,
    blocks: 0,
    roomId: null,
  };
}

export function emptyRotation(): RotationConfig {
  return { groups: [], turns: 0, log: [] };
}

export function newFixedActivity(name = ""): FixedActivity {
  return { id: uid("f"), name, cells: [] };
}

export function newSegment(name = "", days: number[] = []): Segment {
  return { id: uid("sg"), name, days };
}

export function defaultData(): AppData {
  const classes: Klass[] = ["A", "B", "C", "D"].map((n) => ({
    id: uid("k"),
    name: `${n}반`,
    segmentId: null,
  }));
  return {
    version: 3,
    schoolName: "",
    days: ["월", "화", "수", "목", "금"],
    slots: generateSlots(DEFAULT_GEN),
    fixedActivities: [
      { id: uid("f"), name: "Orientation", cells: ["0:0", "2:0"] },
      { id: uid("f"), name: "Closing", cells: ["1:5", "4:5"] },
    ],
    segments: [],
    classes,
    rooms: [],
    teachers: [],
    courses: [],
    timetable: [],
    rotation: emptyRotation(),
  };
}

/** 체험존별 주당 사용 칸 수 (병목을 눈으로 확인하려고 쓴다) */
export function roomLoads(data: AppData): Map<string, number> {
  const load = new Map<string, number>();
  for (const course of data.courses) {
    if (!course.roomId) continue;
    load.set(course.roomId, (load.get(course.roomId) ?? 0) + course.hours * course.classIds.length);
  }
  return load;
}

/** ── 파생 값 ───────────────────────────────────────────── */

export function periodsOf(slots: DaySlot[]): DaySlot[] {
  return slots.filter((s) => s.kind === "period");
}

/**
 * blockable[p] === true 이면 p 교시 바로 다음이 p+1 교시다(사이에 점심·쉬는시간 칸이 없음).
 * 연속 2교시 블록은 이런 자리에만 놓을 수 있다.
 */
export function blockableFlags(slots: DaySlot[]): boolean[] {
  const flags: boolean[] = [];
  let lastPeriodIdx = -1;
  let sawBreak = false;
  for (const s of slots) {
    if (s.kind === "break") {
      if (lastPeriodIdx >= 0) sawBreak = true;
      continue;
    }
    if (lastPeriodIdx >= 0) flags[lastPeriodIdx] = !sawBreak;
    lastPeriodIdx += 1;
    sawBreak = false;
  }
  if (lastPeriodIdx >= 0) flags[lastPeriodIdx] = false;
  return flags;
}

export function slotKey(day: number, period: number): string {
  return `${day}:${period}`;
}

/** ── 고정 활동 ─────────────────────────────────────────── */

/** `${day}:${period}` → 고정 활동 이름. 겹치면 먼저 정의된 것이 이긴다. */
export function fixedCellNames(data: AppData): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of data.fixedActivities) {
    for (const key of f.cells) {
      const [d, p] = key.split(":").map(Number);
      if (d >= 0 && d < data.days.length && p >= 0 && p < dayPeriods(data, d).length && !map.has(key))
        map.set(key, f.name || "고정");
    }
  }
  return map;
}

/** 고정 활동이 차지한 칸 — 여기에는 어떤 수업도 들어갈 수 없다. */
export function fixedCellSet(data: AppData): Set<string> {
  return new Set(fixedCellNames(data).keys());
}

/**
 * `${day}:${period}` → 그 칸을 맡은 고정 활동의 체험존 id.
 * fixedCellNames 와 같은 순서(먼저 정의된 활동이 이긴다)로 계산해 이름·존이 어긋나지 않는다.
 * 존이 지정된 활동의 칸만 담긴다.
 */
export function fixedCellRooms(data: AppData): Map<string, string> {
  const map = new Map<string, string>();
  const seen = new Set<string>();
  for (const f of data.fixedActivities) {
    for (const key of f.cells) {
      const [d, p] = key.split(":").map(Number);
      if (!(d >= 0 && d < data.days.length && p >= 0 && p < dayPeriods(data, d).length)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      if (f.roomId) map.set(key, f.roomId);
    }
  }
  return map;
}

/** ── 운영 구간 ─────────────────────────────────────────── */

export function segmentOf(data: AppData, klass: Klass): Segment | null {
  if (!klass.segmentId) return null;
  return data.segments.find((s) => s.id === klass.segmentId) ?? null;
}

/** 이 체험반이 올 수 있는 요일 index 목록. 구간이 없으면 운영 요일 전체. */
export function allowedDaysOf(data: AppData, klass: Klass): number[] {
  const seg = segmentOf(data, klass);
  const all = data.days.map((_, i) => i);
  if (!seg) return all;
  const picked = seg.days.filter((d) => d >= 0 && d < data.days.length);
  return picked;
}

/** 이 체험반이 실제로 쓸 수 있는 칸 수 (구간 요일 × 교시 − 고정 활동) */
export function classCapacity(data: AppData, klass: Klass): number {
  const fixed = fixedCellSet(data);
  let n = 0;
  for (const d of allowedDaysOf(data, klass)) {
    for (let p = 0; p < dayPeriods(data, d).length; p++) if (!fixed.has(slotKey(d, p))) n += 1;
  }
  return n;
}

/** 강사·체험존이 쓸 수 있는 칸 수 (운영 요일 전체 − 고정 활동) */
export function weekCapacity(data: AppData): number {
  return data.days.reduce((n, _, d) => n + dayPeriods(data, d).length, 0) - fixedCellSet(data).size;
}

export function capacityForDays(data: AppData, days: number[], classId?: string): number {
  const klass = data.classes.find((c) => c.id === classId);
  const allowed = new Set(klass ? allowedDaysOf(data, klass) : days);
  const fixed = fixedCellSet(data);
  return days.reduce((n, d) => n + (allowed.has(d) ? dayPeriods(data, d).filter((_, p) => !fixed.has(slotKey(d, p))).length : 0), 0);
}

export function buildLectures(data: AppData): Lecture[] {
  const out: Lecture[] = [];
  const classExists = new Set(data.classes.map((c) => c.id));
  for (const course of data.courses) {
    if (!course.teacherId || course.hours <= 0) continue;
    for (const classId of course.classIds) {
      if (!classExists.has(classId)) continue;
      out.push({
        courseId: course.id,
        teacherId: course.teacherId,
        classId,
        subject: course.subject || "(과목 미입력)",
        teacherSubject: course.teacherSubject?.trim() || undefined,
        roomId: course.roomId,
        hours: course.hours,
        blocks: Math.max(0, Math.min(course.blocks, Math.floor(course.hours / 2))),
        hideTeacher: course.hideTeacher,
        oncePerSegment: course.oncePerSegment || undefined,
        days: course.days && course.days.length > 0 ? course.days : undefined,
      });
    }
  }
  return out;
}

/**
 * 요일 → 운영 구간 묶음 번호. 어느 구간에도 속하지 않은 요일은 저마다 다른 묶음(하루 1회)이다.
 * 한 요일이 여러 구간에 들어 있으면 먼저 정의된 구간이 이긴다.
 */
export function dayGroups(data: AppData): number[] {
  const D = data.days.length;
  const group = Array.from({ length: D }, (_, d) => d);
  const taken = new Set<number>();
  data.segments.forEach((seg, si) => {
    const days = seg.days.filter((d) => d >= 0 && d < D && !taken.has(d));
    for (const d of days) {
      group[d] = D + si;
      taken.add(d);
    }
  });
  return group;
}

/**
 * 이 체험반에서 같은 프로그램을 최대 몇 번 넣을 수 있는지.
 * 기본은 등원 요일 수(하루 1회). oncePerSegment 면 등원 요일이 속한 구간 묶음 수(구간당 1회).
 *
 * 요일이 지정된 프로그램이면 그 요일만 센다.
 */
export function comboLimitOf(
  data: AppData,
  klass: Klass,
  oncePerSegment: boolean,
  onlyDays?: number[],
): number {
  let days = allowedDaysOf(data, klass);
  if (onlyDays && onlyDays.length > 0) days = days.filter((d) => onlyDays.includes(d));
  if (!oncePerSegment) return days.length;
  const groups = dayGroups(data);
  return new Set(days.map((d) => groups[d])).size;
}

/**
 * 배치 엔진에 넘길 요청을 만든다.
 *
 * 고정 활동으로 막힌 칸과 구간별 요일 제한이 여기서 한 번에 계산되므로,
 * 화면이든 검증 스크립트든 이 함수만 쓰면 조건이 어긋날 일이 없다.
 */
export function buildSolveRequest(
  data: AppData,
  opt: { timeLimitMs: number; seed: number; reserved?: AppData["timetable"] },
): SolveRequest {
  const P = calendarPeriods(data).length;
  const D = data.days.length;
  const fixed = fixedCellSet(data);

  const blockedCells = new Array<boolean>(D * P).fill(false);
  for (let d = 0; d < D; d++) {
    for (let p = 0; p < P; p++)
      if (p >= dayPeriods(data, d).length || fixed.has(slotKey(d, p))) blockedCells[d * P + p] = true;
  }

  const reserved = (ids: string[], key: "teacherId" | "roomId") => ids.map((id) => {
    const cells = new Array<boolean>(D * P).fill(false);
    for (const a of opt.reserved ?? []) {
      if (a[key] !== id || a.day < 0 || a.day >= D) continue;
      for (let k = 0; k < a.length; k++) if (a.period + k >= 0 && a.period + k < P) cells[a.day * P + a.period + k] = true;
    }
    return cells;
  });

  return {
    dayCount: D,
    periodCount: P,
    dayGroup: dayGroups(data),
    blockable: blockableFlags(data.slots),
    blockableByDay: data.days.map((_, d) => blockableFlags(slotsFor(data, d))),
    reservedTeacherCells: reserved(data.teachers.map((t) => t.id), "teacherId"),
    reservedRoomCells: reserved(data.rooms.map((r) => r.id), "roomId"),
    lectures: buildLectures(data),
    teacherIds: data.teachers.map((t) => t.id),
    classIds: data.classes.map((c) => c.id),
    roomIds: data.rooms.map((r) => r.id),
    teacherBlocked: data.teachers.map((t) => {
      const arr = new Array<boolean>(D * P).fill(false);
      for (const key of t.unavailable) {
        const [d, p] = key.split(":").map(Number);
        if (d >= 0 && d < D && p >= 0 && p < P) arr[d * P + p] = true;
      }
      return arr;
    }),
    blockedCells,
    classAllowedDays: data.classes.map((c) => {
      const allowed = new Set(allowedDaysOf(data, c));
      return Array.from({ length: D }, (_, d) => allowed.has(d));
    }),
    timeLimitMs: opt.timeLimitMs,
    seed: opt.seed,
  };
}

export type Issue = { level: "error" | "warn"; text: string };

/** 풀기 전에 명백히 불가능하거나 의심스러운 입력을 걸러낸다. */
export function validate(data: AppData): Issue[] {
  const issues: Issue[] = [];
  const P = calendarPeriods(data).length;
  const D = data.days.length;
  const fixed = fixedCellSet(data);
  const capacity = weekCapacity(data);

  if (D === 0) issues.push({ level: "error", text: "운영 요일이 하나도 선택되지 않았습니다." });
  if (P === 0) issues.push({ level: "error", text: "프로그램 교시가 하나도 없습니다." });
  if (data.classes.length === 0) issues.push({ level: "error", text: "체험반이 없습니다." });

  for (let d = 0; d < D; d++) {
    let previousEnd = -1;
    for (const slot of slotsFor(data, d)) {
      const valid = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
      const start = parseHHMM(slot.start);
      const end = parseHHMM(slot.end);
      if (!valid.test(slot.start) || !valid.test(slot.end) || start >= end || start < previousEnd)
        issues.push({ level: "error", text: `${data.days[d]}요일 ${slot.label}: 시각이 올바르지 않거나 앞 시간과 겹칩니다. [운영 시간]에서 확인하세요.` });
      previousEnd = end;
    }
  }

  for (const seg of data.segments) {
    if (seg.days.filter((d) => d >= 0 && d < D).length === 0)
      issues.push({
        level: data.classes.some((c) => c.segmentId === seg.id) ? "error" : "warn",
        text: `운영 구간 "${seg.name || "(이름없음)"}"에 요일이 없습니다. 요일을 지정해야 배치할 수 있습니다.`,
      });
  }

  const lectures = buildLectures(data);
  if (lectures.length === 0)
    issues.push({ level: "error", text: "배정된 프로그램이 없습니다. [프로그램 배정] 탭에서 입력하세요." });

  const teacherName = new Map(data.teachers.map((t) => [t.id, t.name || "(이름없음)"]));
  const roomName = new Map(data.rooms.map((r) => [r.id, r.name]));

  // 체험반별 총 시수
  const perClass = new Map<string, number>();
  for (const lec of lectures) perClass.set(lec.classId, (perClass.get(lec.classId) ?? 0) + lec.hours);
  const gaps: string[] = [];
  for (const k of data.classes) {
    const h = perClass.get(k.id) ?? 0;
    const room = classCapacity(data, k);
    const seg = segmentOf(data, k);
    const where = seg ? `${seg.name || "구간"}의 ` : "";
    if (h > room)
      issues.push({
        level: "error",
        text: `${k.name}의 총 시수 ${h}시간이 ${where}쓸 수 있는 ${room}칸을 넘습니다.`,
      });
    else if (h < room) gaps.push(`${k.name} ${room - h}칸`);
  }
  // 방문형 운영에서는 빈 칸이 정상이므로 한 줄로 묶어 알린다.
  if (gaps.length > 0)
    issues.push({
      level: "warn",
      text: `빈 시간이 남는 체험반 ${gaps.length}개 — ${gaps.slice(0, 6).join(", ")}${
        gaps.length > 6 ? " …" : ""
      }. 상주형이 아니라면 정상입니다.`,
    });

  // 강사별 총 시수 vs 가용 칸
  const perTeacher = new Map<string, number>();
  for (const lec of lectures) perTeacher.set(lec.teacherId, (perTeacher.get(lec.teacherId) ?? 0) + lec.hours);
  for (const t of data.teachers) {
    const h = perTeacher.get(t.id) ?? 0;
    // 고정 활동 칸은 이미 capacity 에서 빠졌으므로 회피 시간에서도 빼서 두 번 세지 않는다.
    const blockedInRange = t.unavailable.filter((key) => {
      const [d, p] = key.split(":").map(Number);
      return d >= 0 && d < D && p >= 0 && p < dayPeriods(data, d).length && !fixed.has(key);
    }).length;
    const free = capacity - blockedInRange;
    if (h > free)
      issues.push({
        level: "error",
        text: `${t.name || "(이름없음)"} 강사의 총 시수 ${h}시간이 회피 시간을 뺀 ${free}칸보다 많습니다.`,
      });
  }

  // 체험존 수용량 — 체험센터에서 가장 먼저 터지는 곳
  const loads = roomLoads(data);
  for (const [roomId, load] of loads) {
    if (load > capacity)
      issues.push({
        level: "error",
        text: `${roomName.get(roomId) ?? "체험존"}에 주당 ${load}칸이 몰려 있는데 존은 ${capacity}칸뿐입니다. 존을 늘리거나 시수를 줄이세요.`,
      });
    else if (load > capacity * 0.85)
      issues.push({
        level: "warn",
        text: `${roomName.get(roomId) ?? "체험존"} 사용률이 ${Math.round((load / capacity) * 100)}%입니다 (${load}/${capacity}칸). 배치가 빡빡해질 수 있습니다.`,
      });
  }

  // 같은 체험반의 같은 프로그램은 하루 1회(구간당 1회를 켜면 구간 단위) → 넣을 수 있는 자리 수를
  // 넘게 배치되면 불가능. 여러 강사 배정으로 나뉘어 있을 수 있으므로 (반, 프로그램)별로 합산한다.
  const classById = new Map(data.classes.map((c) => [c.id, c]));
  const comboUnits = new Map<
    string,
    { classId: string; subject: string; count: number; courses: number; once: boolean; mixed: boolean; days: number[] }
  >();
  for (const lec of lectures) {
    if (!classById.has(lec.classId)) continue;
    const key = `${lec.classId}|${lec.subject}`;
    const units = lec.blocks + (lec.hours - lec.blocks * 2);
    const once = Boolean(lec.oncePerSegment);
    const e =
      comboUnits.get(key) ??
      { classId: lec.classId, subject: lec.subject, count: 0, courses: 0, once, mixed: false, days: [] as number[] };
    if (e.courses > 0 && e.once !== once) e.mixed = true;
    e.count += units;
    e.courses += 1;
    // 요일을 지정한 배정이 섞여 있으면 그 요일들의 합집합만 쓸 수 있다.
    if (lec.days && lec.days.length > 0) e.days = [...new Set([...e.days, ...lec.days])];
    comboUnits.set(key, e);
  }
  for (const e of comboUnits.values()) {
    const klass = classById.get(e.classId)!;
    const inSegment = Boolean(segmentOf(data, klass));
    const rule = e.once && inSegment ? "구간당 1회" : "하루 1회";
    const limit = comboLimitOf(data, klass, e.once, e.days);
    const pinned = e.days.length > 0 ? `${e.days.map((d) => data.days[d] ?? "?").join("·")}요일로 지정되어 ` : "";
    if (e.count > limit)
      issues.push({
        level: "error",
        text: `${klass.name} ${e.subject}: ${pinned}같은 프로그램은 ${rule}만 진행하므로 ${limit}회까지 가능한데 ${e.count}회가 필요합니다. ${
          e.once ? "배정에서 [구간당 1회]를 끄거나, " : e.days.length > 0 ? "지정 요일을 늘리거나, " : ""
        }연속 2교시(블록) 수를 늘리거나 시수를 줄이세요.`,
      });
    else if (e.mixed)
      issues.push({
        level: "warn",
        text: `${klass.name} ${e.subject}: 같은 프로그램인데 배정마다 [구간당 1회] 설정이 다릅니다. 켠 배정만 구간 안에서 한 번으로 묶입니다.`,
      });
    else if (e.courses > 1)
      issues.push({
        level: "warn",
        text: `${klass.name} ${e.subject}: 같은 프로그램이 배정 ${e.courses}건으로 나뉘어 있습니다. ${rule} 규칙에 걸릴 수 있으니 의도한 것인지 확인하세요.`,
      });
  }

  // 요일을 지정했는데 그 반이 오지 않는 날이면 아예 못 들어간다.
  for (const course of data.courses) {
    const days = course.days?.filter((d) => d >= 0 && d < D) ?? [];
    if (days.length === 0) continue;
    for (const classId of course.classIds) {
      const klass = classById.get(classId);
      if (!klass) continue;
      const usable = allowedDaysOf(data, klass).filter((d) => days.includes(d));
      if (usable.length === 0)
        issues.push({
          level: "error",
          text: `${klass.name} ${course.subject || "(프로그램 미입력)"}: ${days
            .map((d) => data.days[d] ?? "?")
            .join("·")}요일로 지정했는데 이 반은 그 요일에 오지 않습니다.`,
        });
    }
  }

  // 블록을 놓을 자리가 있는지 — 고정 활동에 막히지 않은 자리가 하나라도 있어야 한다.
  let blockSlots = 0;
  for (let d = 0; d < D; d++) {
    const flags = blockableFlags(slotsFor(data, d));
    for (let p = 0; p + 1 < P; p++) {
      if (!flags[p]) continue;
      if (fixed.has(slotKey(d, p)) || fixed.has(slotKey(d, p + 1))) continue;
      blockSlots += 1;
    }
  }
  if (blockSlots === 0 && lectures.some((l) => l.blocks > 0))
    issues.push({
      level: "error",
      text: "연속 2교시로 붙일 수 있는 자리가 없습니다. 교시 사이의 쉬는시간 칸과 고정 활동을 확인하세요.",
    });

  if (data.courses.some((c) => !c.subject.trim()))
    issues.push({ level: "warn", text: "프로그램명이 비어 있는 배정이 있습니다." });
  for (const c of data.courses) {
    if (c.classIds.length === 0)
      issues.push({
        level: "warn",
        text: `${teacherName.get(c.teacherId) ?? ""} ${c.subject}: 체험반이 지정되지 않아 무시됩니다.`,
      });
  }

  return issues;
}

/** ── 저장 ─────────────────────────────────────────────── */

/**
 * 예전 저장본을 지금 모양으로 올린다.
 *   v1 → 시간표·로테이션 칸이 없다.
 *   v2 → 고정 활동·운영 구간이 없고, 로테이션이 "회차 목록" 방식이었다.
 *        회차는 규칙만 남기고 버린다(이제 원할 때 직접 돌린다).
 * 알 수 없는 버전이면 손대지 않고 처음 상태로 돌아간다.
 */
export function migrate(raw: unknown): AppData | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = raw as Partial<Omit<AppData, "version" | "rotation">> & {
    version?: number;
    rotation?: Partial<RotationConfig> & { rounds?: unknown };
  };
  if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) return null;
  const base = defaultData();
  const rotation = parsed.rotation ?? {};
  return {
    ...base,
    ...parsed,
    version: 3,
    fixedActivities: Array.isArray(parsed.fixedActivities) ? parsed.fixedActivities : [],
    segments: Array.isArray(parsed.segments) ? parsed.segments : [],
    daySlots: parsed.daySlots && typeof parsed.daySlots === "object" ? parsed.daySlots : {},
    classes: Array.isArray(parsed.classes) ? parsed.classes : base.classes,
    timetable: Array.isArray(parsed.timetable) ? parsed.timetable : [],
    rotation: {
      groups: Array.isArray(rotation.groups) ? rotation.groups : [],
      turns: typeof rotation.turns === "number" ? rotation.turns : 0,
      log: Array.isArray(rotation.log) ? rotation.log : [],
    },
  };
}

export function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    return migrate(JSON.parse(raw)) ?? defaultData();
  } catch {
    return defaultData();
  }
}

export function save(data: AppData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* 저장 공간이 없으면 조용히 넘어간다 */
  }
}
