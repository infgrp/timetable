import type { AppData, Course, DaySlot, Lecture, Teacher } from "./types";

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

export const DEFAULT_GEN: SlotGenOptions = {
  firstStart: "08:50",
  periodMinutes: 50,
  breakMinutes: 10,
  periodCount: 7,
  lunchAfter: 4,
  lunchMinutes: 50,
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

export function defaultData(): AppData {
  const classes = [1, 2, 3, 4].map((n) => ({ id: uid("k"), name: `1-${n}` }));
  return {
    version: 1,
    schoolName: "",
    days: ["월", "화", "수", "목", "금"],
    slots: generateSlots(DEFAULT_GEN),
    classes,
    rooms: [],
    teachers: [],
    courses: [],
  };
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
        roomId: course.roomId,
        hours: course.hours,
        blocks: Math.max(0, Math.min(course.blocks, Math.floor(course.hours / 2))),
      });
    }
  }
  return out;
}

export type Issue = { level: "error" | "warn"; text: string };

/** 풀기 전에 명백히 불가능하거나 의심스러운 입력을 걸러낸다. */
export function validate(data: AppData): Issue[] {
  const issues: Issue[] = [];
  const P = periodsOf(data.slots).length;
  const D = data.days.length;
  const capacity = P * D;

  if (D === 0) issues.push({ level: "error", text: "요일이 하나도 선택되지 않았습니다." });
  if (P === 0) issues.push({ level: "error", text: "수업 교시가 하나도 없습니다." });
  if (data.classes.length === 0) issues.push({ level: "error", text: "학급이 없습니다." });

  const lectures = buildLectures(data);
  if (lectures.length === 0)
    issues.push({ level: "error", text: "배정된 수업이 없습니다. [담당 배정] 탭에서 입력하세요." });

  const teacherName = new Map(data.teachers.map((t) => [t.id, t.name || "(이름없음)"]));
  const className = new Map(data.classes.map((c) => [c.id, c.name]));

  // 학급별 총 시수
  const perClass = new Map<string, number>();
  for (const lec of lectures) perClass.set(lec.classId, (perClass.get(lec.classId) ?? 0) + lec.hours);
  for (const k of data.classes) {
    const h = perClass.get(k.id) ?? 0;
    if (h > capacity)
      issues.push({
        level: "error",
        text: `${k.name} 학급의 총 시수 ${h}시간이 주당 수업 칸 ${capacity}칸을 넘습니다.`,
      });
    else if (h < capacity)
      issues.push({
        level: "warn",
        text: `${k.name} 학급은 ${capacity - h}칸이 빈 시간으로 남습니다. (총 ${h}시간)`,
      });
  }

  // 교사별 총 시수 vs 가용 슬롯
  const perTeacher = new Map<string, number>();
  for (const lec of lectures) perTeacher.set(lec.teacherId, (perTeacher.get(lec.teacherId) ?? 0) + lec.hours);
  for (const t of data.teachers) {
    const h = perTeacher.get(t.id) ?? 0;
    const blockedInRange = t.unavailable.filter((key) => {
      const [d, p] = key.split(":").map(Number);
      return d < D && p < P;
    }).length;
    const free = capacity - blockedInRange;
    if (h > free)
      issues.push({
        level: "error",
        text: `${t.name || "(이름없음)"} 교사의 총 시수 ${h}시간이 회피 시간을 뺀 ${free}칸보다 많습니다.`,
      });
  }

  // 같은 학급 같은 과목 하루 1회 → 배치 단위 수가 요일 수를 넘으면 불가능
  for (const lec of lectures) {
    const unitCount = lec.blocks + (lec.hours - lec.blocks * 2);
    if (unitCount > D)
      issues.push({
        level: "error",
        text: `${className.get(lec.classId) ?? ""} ${lec.subject}: 하루 1회 규칙 때문에 주 ${D}회까지만 가능한데 ${unitCount}회가 필요합니다. 블록 수를 늘리거나 시수를 줄이세요.`,
      });
  }

  // 블록 배치가 가능한 자리가 있는지
  const flags = blockableFlags(data.slots);
  const blockSlots = flags.filter(Boolean).length;
  if (blockSlots === 0 && lectures.some((l) => l.blocks > 0))
    issues.push({
      level: "error",
      text: "연속 2교시로 붙일 수 있는 자리가 없습니다. 교시 사이에 쉬는시간 칸이 들어가 있는지 확인하세요.",
    });

  for (const c of data.courses) {
    if (!c.subject.trim()) issues.push({ level: "warn", text: "과목명이 비어 있는 배정이 있습니다." });
    if (c.classIds.length === 0)
      issues.push({
        level: "warn",
        text: `${teacherName.get(c.teacherId) ?? ""} ${c.subject}: 학급이 지정되지 않아 무시됩니다.`,
      });
  }

  return issues;
}

/** ── 저장 ─────────────────────────────────────────────── */

export function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw) as AppData;
    if (!parsed || parsed.version !== 1) return defaultData();
    return { ...defaultData(), ...parsed };
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
