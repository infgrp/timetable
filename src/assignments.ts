/**
 * 구성된 시간표(Assignment 목록)를 다루는 곳.
 *
 * 자동 배치 결과, 엑셀로 올린 기존 시간표, 손으로 고친 내용이 전부 같은 목록에 들어온다.
 * 화면 격자·엑셀 내보내기·로테이션은 모두 이 목록만 읽는다.
 */
import type { AppData, Assignment, Lecture, SolveResult } from "./types";
import { allowedDaysOf, blockableFlags, fixedCellNames, fixedCellRooms, slotKey, uid } from "./store";
import { hueOf } from "./components/Timetable";
import type { Cell, Grid } from "./components/Timetable";
import { calendarPeriods, dayPeriods, slotsFor } from "./calendar";

export function newAssignment(init: Partial<Assignment> = {}): Assignment {
  return {
    id: uid("a"),
    classId: "",
    teacherId: null,
    roomId: null,
    subject: "",
    day: 0,
    period: 0,
    length: 1,
    ...init,
  };
}

/** 솔버가 돌려준 배치를 편집 가능한 목록으로 옮긴다. */
export function fromSolveResult(result: SolveResult, lectures: Lecture[]): Assignment[] {
  const out: Assignment[] = [];
  for (const unit of result.placed) {
    const lec = lectures[unit.lectureIndex];
    if (!lec) continue;
    out.push(
      newAssignment({
        classId: lec.classId,
        teacherId: lec.teacherId,
        roomId: lec.roomId,
        subject: lec.subject,
        teacherSubject: lec.teacherSubject,
        day: unit.day,
        period: unit.period,
        length: unit.length === 2 ? 2 : 1,
        hideTeacher: lec.hideTeacher,
      }),
    );
  }
  return sortAssignments(out);
}

export function sortAssignments(list: Assignment[]): Assignment[] {
  return [...list].sort((a, b) => a.day - b.day || a.period - b.period || a.classId.localeCompare(b.classId));
}

/** 이 배치가 차지하는 교시들 */
export function periodsCovered(a: Assignment): number[] {
  return a.length === 2 ? [a.period, a.period + 1] : [a.period];
}

/** 지정한 자리에 이 길이가 들어갈 수 있는지 (칸 범위 + 연속 2교시 자리) */
export function fits(data: AppData, day: number, period: number, length: 1 | 2): boolean {
  const P = dayPeriods(data, day).length;
  if (day < 0 || day >= data.days.length) return false;
  if (period < 0 || period + length > P) return false;
  if (length === 2 && !blockableFlags(slotsFor(data, day))[period]) return false;
  return true;
}

/**
 * 고정 활동이 막고 있는 자리면 그 이름을 돌려준다.
 * 자리 자체는 성립하지만 Orientation·Closing 이 이미 쓰고 있는 칸이다.
 */
export function blockedBy(data: AppData, day: number, period: number, length: 1 | 2): string | null {
  const fixed = fixedCellNames(data);
  for (let k = 0; k < length; k++) {
    const name = fixed.get(slotKey(day, period + k));
    if (name) return name;
  }
  return null;
}

/** 이 체험반이 그 요일에 오는지 (운영 구간 밖이면 false) */
export function dayAllowedFor(data: AppData, classId: string, day: number): boolean {
  const klass = data.classes.find((c) => c.id === classId);
  if (!klass) return true;
  return allowedDaysOf(data, klass).includes(day);
}

export function setPosition(list: Assignment[], id: string, day: number, period: number): Assignment[] {
  return list.map((a) => (a.id === id ? { ...a, day, period } : a));
}

/** 두 배치의 자리를 맞바꾼다 (칸을 끌어다 이미 찬 자리에 놓았을 때) */
export function swapPositions(list: Assignment[], idA: string, idB: string): Assignment[] {
  const a = list.find((x) => x.id === idA);
  const b = list.find((x) => x.id === idB);
  if (!a || !b) return list;
  return list.map((x) => {
    if (x.id === idA) return { ...x, day: b.day, period: b.period };
    if (x.id === idB) return { ...x, day: a.day, period: a.period };
    return x;
  });
}

export function upsert(list: Assignment[], a: Assignment): Assignment[] {
  return list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a];
}

export function removeAssignment(list: Assignment[], id: string): Assignment[] {
  return list.filter((a) => a.id !== id);
}

/** ── 충돌 검사 ───────────────────────────────────────── */

export type Conflict = {
  kind: "class" | "teacher" | "room" | "avoid" | "range" | "fixed" | "segment" | "duplicate";
  text: string;
  /** 이 충돌에 얽힌 배치 id */
  ids: string[];
};

const KIND_LABEL: Record<Conflict["kind"], string> = {
  class: "체험반 겹침",
  teacher: "강사 겹침",
  room: "체험존 겹침",
  avoid: "강사 회피 시간",
  range: "자리 오류",
  fixed: "고정 활동 자리",
  segment: "운영 구간 밖",
  duplicate: "같은 프로그램 중복",
};

export function conflictLabel(kind: Conflict["kind"]): string {
  return KIND_LABEL[kind];
}

/**
 * 손으로 고치다 보면 잠깐 겹치는 일이 생긴다. 막지 않고 전부 찾아 보여 준다.
 * (자동 배치가 0으로 몰아가는 하드 제약과 같은 항목이다.)
 */
export function conflictsOf(data: AppData, list: Assignment[]): Conflict[] {
  const out: Conflict[] = [];
  const periods = calendarPeriods(data);
  const P = periods.length;
  const fixed = fixedCellNames(data);
  const classById = new Map(data.classes.map((c) => [c.id, c]));
  const className = new Map(data.classes.map((c) => [c.id, c.name || "(이름없음)"]));
  const teacherName = new Map(data.teachers.map((t) => [t.id, t.name || "(이름없음)"]));
  const roomName = new Map(data.rooms.map((r) => [r.id, r.name || "(이름없음)"]));
  const at = (day: number, period: number) =>
    `${data.days[day] ?? `${day + 1}번째 요일`} ${periods[period]?.label ?? `${period + 1}교시`}`;

  // 자리 자체가 성립하지 않는 것부터
  const usable: Assignment[] = [];
  for (const a of list) {
    if (!fits(data, a.day, a.period, a.length)) {
      const why =
        a.length === 2 && a.period + 1 < P && !blockableFlags(slotsFor(data, a.day))[a.period]
          ? "연속 2교시로 붙일 수 없는 자리입니다(사이에 점심·쉬는시간)."
          : "운영 요일·교시 범위를 벗어났습니다.";
      out.push({
        kind: "range",
        text: `${className.get(a.classId) ?? "?"} ${a.subject || "(프로그램 미입력)"} — ${why}`,
        ids: [a.id],
      });
      continue;
    }

    const onFixed = periodsCovered(a).find((p) => fixed.has(slotKey(a.day, p)));
    if (onFixed !== undefined) {
      out.push({
        kind: "fixed",
        text: `${className.get(a.classId) ?? "?"} ${a.subject || "(프로그램 미입력)"} — ${at(
          a.day,
          onFixed,
        )}는 ${fixed.get(slotKey(a.day, onFixed))} 시간입니다.`,
        ids: [a.id],
      });
      continue;
    }

    const klass = classById.get(a.classId);
    if (klass && !allowedDaysOf(data, klass).includes(a.day)) {
      out.push({
        kind: "segment",
        text: `${klass.name || "(이름없음)"} — ${data.days[a.day] ?? "?"}요일은 이 반이 오는 날이 아닙니다: ${
          a.subject || "(프로그램 미입력)"
        }`,
        ids: [a.id],
      });
      continue;
    }

    usable.push(a);
  }

  const bucket = (map: Map<string, Assignment[]>, key: string, a: Assignment) => {
    const arr = map.get(key);
    if (arr) arr.push(a);
    else map.set(key, [a]);
  };

  const byClass = new Map<string, Assignment[]>();
  const byTeacher = new Map<string, Assignment[]>();
  const byRoom = new Map<string, Assignment[]>();

  for (const a of usable) {
    for (const p of periodsCovered(a)) {
      bucket(byClass, `${a.classId}|${a.day}|${p}`, a);
      if (a.teacherId) bucket(byTeacher, `${a.teacherId}|${a.day}|${p}`, a);
      if (a.roomId) bucket(byRoom, `${a.roomId}|${a.day}|${p}`, a);
    }
  }

  const collect = (
    map: Map<string, Assignment[]>,
    kind: Conflict["kind"],
    nameOf: (id: string) => string,
  ) => {
    const seen = new Set<string>();
    for (const [key, arr] of map) {
      if (arr.length < 2) continue;
      const [ownerId, day, period] = key.split("|");
      // 같은 짝이 연속 2교시 때문에 두 번 잡히는 것을 한 번만 보고한다.
      const sig = `${ownerId}|${[...new Set(arr.map((a) => a.id))].sort().join(",")}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({
        kind,
        text: `${nameOf(ownerId)} — ${at(Number(day), Number(period))}에 ${arr.length}개가 겹칩니다: ${[
          ...new Set(arr.map((a) => a.subject || "(프로그램 미입력)")),
        ].join(", ")}`,
        ids: arr.map((a) => a.id),
      });
    }
  };

  collect(byClass, "class", (id) => className.get(id) ?? "(삭제된 체험반)");
  collect(byTeacher, "teacher", (id) => teacherName.get(id) ?? "(삭제된 강사)");
  collect(byRoom, "room", (id) => roomName.get(id) ?? "(삭제된 체험존)");

  // 같은 체험반의 같은 프로그램은 하루 1회만 — 손으로 고치다 두 번 넣으면 알린다.
  const byDup = new Map<string, Assignment[]>();
  for (const a of usable) {
    if (!a.subject.trim()) continue;
    bucket(byDup, `${a.classId}|${a.subject.trim()}|${a.day}`, a);
  }
  for (const [key, arr] of byDup) {
    const ids = [...new Set(arr.map((a) => a.id))];
    if (ids.length < 2) continue;
    const [classId, subject, day] = key.split("|");
    out.push({
      kind: "duplicate",
      text: `${className.get(classId) ?? "?"} — ${data.days[Number(day)] ?? "?"}에 "${subject}"가 ${ids.length}번 있습니다. 같은 프로그램은 하루 1회만 진행합니다.`,
      ids,
    });
  }

  // 강사 회피 시간
  const avoid = new Map(data.teachers.map((t) => [t.id, new Set(t.unavailable)]));
  for (const a of usable) {
    if (!a.teacherId) continue;
    const blocked = avoid.get(a.teacherId);
    if (!blocked) continue;
    const hit = periodsCovered(a).find((p) => blocked.has(slotKey(a.day, p)));
    if (hit === undefined) continue;
    out.push({
      kind: "avoid",
      text: `${teacherName.get(a.teacherId) ?? "?"} — ${at(a.day, hit)}는 회피 시간인데 ${
        a.subject || "(프로그램 미입력)"
      }이(가) 잡혀 있습니다.`,
      ids: [a.id],
    });
  }

  return out;
}

/** ── 화면 격자 ───────────────────────────────────────── */

export type Grids = {
  byClass: Map<string, Grid>;
  byTeacher: Map<string, Grid>;
  byRoom: Map<string, Grid>;
};

export function buildGrids(data: AppData, list: Assignment[], badIds?: Set<string>): Grids {
  const periods = calendarPeriods(data);
  const teacherName = new Map(data.teachers.map((t) => [t.id, t.name || "(이름없음)"]));
  const className = new Map(data.classes.map((c) => [c.id, c.name || "(이름없음)"]));
  const roomName = new Map(data.rooms.map((r) => [r.id, r.name || "(이름없음)"]));

  const blank = (): Grid => Array.from({ length: periods.length }, () => new Array(data.days.length).fill(null));
  const byClass = new Map<string, Grid>();
  const byTeacher = new Map<string, Grid>();
  const byRoom = new Map<string, Grid>();
  for (const c of data.classes) byClass.set(c.id, blank());
  for (const t of data.teachers) byTeacher.set(t.id, blank());
  for (const r of data.rooms) byRoom.set(r.id, blank());

  // 고정 활동을 먼저 깐다 — 체험반도 강사도 그 시간에는 여기에 묶여 있다.
  // 체험존이 지정된 활동(예: 강당에서 하는 Orientation)은 그 존 시간표에도 나타낸다.
  const fixedRooms = fixedCellRooms(data);
  for (const [key, name] of fixedCellNames(data)) {
    const [d, p] = key.split(":").map(Number);
    if (!(d >= 0 && d < data.days.length && p >= 0 && p < periods.length)) continue;
    const cell: Cell = { top: name, span: 1, hue: 0, fixed: true };
    for (const c of data.classes) if (allowedDaysOf(data, c).includes(d)) byClass.get(c.id)![p][d] = cell;
    for (const grid of byTeacher.values()) grid[p][d] = cell;
    const roomId = fixedRooms.get(key);
    if (roomId && byRoom.has(roomId)) byRoom.get(roomId)![p][d] = cell;
  }

  const put = (grid: Grid | undefined, a: Assignment, cell: Cell) => {
    if (!grid) return;
    if (!grid[a.period] || a.period + a.length > periods.length) return;
    // 이미 찬 자리면 덮어쓰지 않는다 — 겹침은 충돌 목록이 알린다.
    if (Array.from({ length: a.length }, (_, k) => grid[a.period + k]?.[a.day]).some(Boolean)) return;
    grid[a.period][a.day] = cell;
    for (let k = 1; k < a.length; k++) {
      if (grid[a.period + k]) grid[a.period + k][a.day] = "cont";
    }
  };

  for (const a of list) {
    if (a.day < 0 || a.day >= data.days.length) continue;
    const room = a.roomId ? roomName.get(a.roomId) : undefined;
    const teacher = a.teacherId ? teacherName.get(a.teacherId) : undefined;
    // 매주 담당이 바뀌는 수업은 체험반·체험존 표에 강사를 적지 않는다.
    const shownTeacher = a.hideTeacher ? undefined : teacher;
    const hue = hueOf(a.subject);
    const bad = badIds?.has(a.id) ?? false;
    const base = { span: a.length, hue, id: a.id, bad };

    put(byClass.get(a.classId), a, {
      ...base,
      top: a.subject || "(프로그램 미입력)",
      bottom: [shownTeacher, room].filter(Boolean).join(" · "),
    });
    if (a.teacherId)
      put(byTeacher.get(a.teacherId), a, {
        ...base,
        top: className.get(a.classId) ?? "(삭제된 체험반)",
        // 강사 개인 표에는 teacherSubject(예: "Adventure ①")를 우선 쓴다.
        bottom: [a.teacherSubject?.trim() || a.subject, room].filter(Boolean).join(" · "),
      });
    if (a.roomId)
      put(byRoom.get(a.roomId), a, {
        ...base,
        top: className.get(a.classId) ?? "(삭제된 체험반)",
        bottom: [a.subject, shownTeacher].filter(Boolean).join(" · "),
      });
  }

  return { byClass, byTeacher, byRoom };
}

/** 격자에서 고른 요일만 남긴다 (운영 구간별로 볼 때). */
export function sliceGrid(grid: Grid, dayIndices: number[]): Grid {
  return grid.map((row) => dayIndices.map((d) => row[d] ?? null));
}

/** 실제 수업이 든 칸 수 (고정 활동은 세지 않는다) */
export function usedCells(grid: Grid): number {
  let n = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell === "cont") n += 1;
      else if (cell && !cell.fixed) n += 1;
    }
  }
  return n;
}

/** 프로그램명 자동완성 후보 — 배정 탭과 이미 짜인 시간표에서 모은다. */
export function knownSubjects(data: AppData): string[] {
  const set = new Set<string>();
  for (const c of data.courses) if (c.subject.trim()) set.add(c.subject.trim());
  for (const a of data.timetable) if (a.subject.trim()) set.add(a.subject.trim());
  return [...set].sort((a, b) => a.localeCompare(b));
}
