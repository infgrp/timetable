/**
 * 이미 짜여 있는 시간표를 엑셀·CSV 로 받아 들인다.
 *
 * 두 가지 모양을 읽는다.
 *   목록형 — 한 줄에 한 칸.  체험반 | 요일 | 교시 | 프로그램 | 강사 | 체험존 | 연속
 *            (앱의 "전체 목록 CSV" 와 같은 모양이고, [양식 받기] 로 빈 서식을 받을 수 있다)
 *   시간표형 — 앱이 내보낸 체험반별 시트 모양 그대로. 세로 병합을 연속 2교시로 되살린다.
 *
 * 체험반·강사·체험존은 이름이 처음 보이면 새로 만든다.
 * 요일·교시는 자리(index)가 곧 뜻이라 함부로 늘리지 않고, 모르는 값이면 건너뛰고 알린다.
 */
import type { AppData, Assignment, Klass, Room, Teacher } from "./types";
import { emptyTeacher, fixedCellSet, slotKey, uid } from "./store";
import { dayPeriods } from "./calendar";
import { newAssignment, sortAssignments } from "./assignments";
import { readXlsx } from "./xlsxRead";
import type { Merge, ReadSheet } from "./xlsxRead";
import { buildXlsx, safeSheetName } from "./xlsx";
import type { XCell, XSheet } from "./xlsx";

/** ── CSV ─────────────────────────────────────────────── */

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch !== '"') cur += ch;
      else if (src[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else if (ch !== "\r") cur += ch;
  }
  row.push(cur);
  rows.push(row);
  return rows;
}

/** 확장자를 보고 엑셀이든 CSV 든 같은 모양으로 돌려준다. */
export async function readSpreadsheet(file: File): Promise<ReadSheet[]> {
  if (/\.csv$/i.test(file.name)) {
    return [{ name: file.name.replace(/\.csv$/i, ""), rows: parseCsv(await file.text()), merges: [] }];
  }
  return readXlsx(await file.arrayBuffer());
}

/** ── 열 이름 ─────────────────────────────────────────── */

const ALIAS = {
  klass: ["체험반", "반", "학급", "반명", "학반", "class"],
  day: ["요일", "day"],
  period: ["교시", "시간", "period"],
  subject: ["프로그램", "과목", "수업", "활동", "subject", "program"],
  teacher: ["강사", "교사", "선생님", "담당", "담당강사", "teacher"],
  room: ["체험존", "존", "교실", "장소", "실", "room", "zone"],
  block: ["연속", "블록", "block"],
  hide: ["강사표기", "강사표시", "강사숨김", "표기", "hideteacher"],
} as const;

type FieldName = keyof typeof ALIAS;

const norm = (s: string) => s.trim().replace(/\s+/g, " ");
const key = (s: string) => norm(s).toLowerCase();

function columnOf(header: string[], field: FieldName): number {
  const names = ALIAS[field];
  const exact = header.findIndex((h) => names.some((n) => key(h) === n));
  if (exact >= 0) return exact;
  return header.findIndex((h) => h.trim() !== "" && names.some((n) => key(h).includes(n)));
}

const DAY_EN: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

/** ── 파일에서 뽑아낸 한 칸 ───────────────────────────── */

type Raw = {
  className: string;
  day: string;
  period: string;
  subject: string;
  teacher: string;
  room: string;
  /** 이미 길이를 아는 경우(시간표형의 세로 병합) */
  span: 1 | 2;
  /** 길이를 모르고 "연속" 표시만 있는 경우(목록형) — 붙어 있는 짝을 찾아 되붙인다. */
  block: boolean;
  /** 체험반 시간표에 강사를 적지 않는 수업 */
  hideTeacher: boolean;
  /** 요일별 출력은 표준 교시 번호 축을 사용한다. 사용자 교시 이름과 구별한다. */
  periodNumber?: number;
  where: string;
};

function isBlank(row: string[] | undefined): boolean {
  return !row || row.every((c) => c.trim() === "");
}

function findHeaderRow(rows: string[][]): { index: number; header: string[] } | null {
  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    const header = rows[r] ?? [];
    if (columnOf(header, "klass") >= 0 && columnOf(header, "day") >= 0 && columnOf(header, "period") >= 0)
      return { index: r, header };
  }
  return null;
}

function parseListSheet(sheet: ReadSheet): Raw[] | null {
  const found = findHeaderRow(sheet.rows);
  if (!found) return null;
  const { index, header } = found;
  const col = {
    klass: columnOf(header, "klass"),
    day: columnOf(header, "day"),
    period: columnOf(header, "period"),
    subject: columnOf(header, "subject"),
    teacher: columnOf(header, "teacher"),
    room: columnOf(header, "room"),
    block: columnOf(header, "block"),
    hide: columnOf(header, "hide"),
  };
  const pick = (row: string[], c: number) => (c >= 0 ? (row[c] ?? "") : "");

  const out: Raw[] = [];
  for (let r = index + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    if (isBlank(row)) continue;
    const blockText = key(pick(row, col.block));
    const hideText = key(pick(row, col.hide));
    out.push({
      className: norm(pick(row, col.klass)),
      day: norm(pick(row, col.day)),
      period: norm(pick(row, col.period)),
      subject: norm(pick(row, col.subject)),
      teacher: norm(pick(row, col.teacher)),
      room: norm(pick(row, col.room)),
      span: 1,
      block: blockText === "블록" || blockText === "o" || blockText === "y" || blockText === "true",
      hideTeacher:
        hideText === "숨김" || hideText === "비공개" || hideText === "hidden" || hideText === "hide",
      where: `[${sheet.name}] ${r + 1}행`,
    });
  }
  return out;
}

function mergeAt(merges: Merge[], r: number, c: number): Merge | undefined {
  return merges.find((m) => m.r1 === r && m.c1 === c && (m.r2 > m.r1 || m.c2 > m.c1));
}

/**
 * 칸 아래줄("강사 · 체험존")을 갈라낸다.
 *
 * 존 이름 자체에 가운뎃점이 들어가는 일이 흔해서(`공항·출입국존`) 단순히 "·" 로 자르면 안 된다.
 * 아는 이름이면 통째로 알아보고, 아니면 앱이 쓰는 구분자(양쪽에 공백이 있는 " · ")를 먼저 본다.
 */
function splitBottom(
  bottom: string,
  knownRoomNames: Set<string>,
  knownTeacherNames: Set<string>,
): { teacher: string; room: string } {
  const text = norm(bottom);
  if (!text) return { teacher: "", room: "" };
  if (knownRoomNames.has(key(text))) return { teacher: "", room: text };
  if (knownTeacherNames.has(key(text))) return { teacher: text, room: "" };

  const spaced = text.split(/\s+·\s+/).map(norm).filter(Boolean);
  if (spaced.length >= 2) return { teacher: spaced[0], room: spaced.slice(1).join(" · ") };

  const bare = text.split("·").map(norm).filter(Boolean);
  if (bare.length >= 2) {
    // 뒤쪽 조각들을 이어 붙였을 때 아는 존이 되는 지점에서 자른다.
    for (let i = 1; i < bare.length; i++) {
      const room = bare.slice(i).join("·");
      if (knownRoomNames.has(key(room))) return { teacher: bare.slice(0, i).join("·"), room };
    }
    return { teacher: bare[0], room: bare.slice(1).join("·") };
  }
  return { teacher: text, room: "" };
}

/**
 * 앱이 내보낸 체험반별 시트 모양을 되읽는다.
 * 시트 이름이 체험반 이름이고, 교시 칸(첫 열)은 "1교시\n09:00~09:40" 처럼 줄바꿈이 들어 있다.
 */
function parseGridSheet(
  sheet: ReadSheet,
  knownRoomNames: Set<string>,
  knownTeacherNames: Set<string>,
): Raw[] | null {
  const headerRow = sheet.rows.findIndex(
    (row) => row && key(row[0] ?? "") === "교시" && (row.length > 1) && row.slice(1).some((c) => c.trim() !== ""),
  );
  if (headerRow < 0) return null;

  const header = sheet.rows[headerRow];
  const dayCols: { col: number; day: string }[] = [];
  for (let c = 1; c < header.length; c++) {
    const text = norm(header[c]);
    if (text) dayCols.push({ col: c, day: text });
  }
  if (dayCols.length === 0) return null;

  const lastCol = dayCols[dayCols.length - 1].col;
  const className = norm(sheet.name);
  const out: Raw[] = [];

  for (let r = headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    if (isBlank(row)) continue;

    // 점심·쉬는시간 줄 — 요일 칸 전체가 하나로 병합되어 있거나 "점심시간 · 12:00~13:00" 꼴이다.
    const wide = mergeAt(sheet.merges, r, 1);
    if (wide && wide.c2 >= lastCol && wide.r1 === wide.r2) continue;
    if (/·\s*\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}/.test(row[1] ?? "") && dayCols.length > 1) continue;

    const label = (row[0] ?? "").split("\n")[0].trim();
    if (label === "휴식") continue;

    for (const { col, day } of dayCols) {
      const text = (row[col] ?? "").trim();
      if (!text) continue;
      if (/^\d{1,2}:\d{2}~\d{1,2}:\d{2}$/.test(text)) continue;
      const [top, bottom = ""] = text.split("\n");
      const hasDayTime = /^\d{1,2}:\d{2}~\d{1,2}:\d{2}$/.test(text.split("\n")[2] ?? "");
      const { teacher, room } = splitBottom(bottom, knownRoomNames, knownTeacherNames);
      const merge = mergeAt(sheet.merges, r, col);
      out.push({
        className,
        day,
        period: label,
        periodNumber: hasDayTime ? Number.parseInt(label, 10) : undefined,
        subject: norm(top),
        teacher,
        room,
        span: merge && sheet.rows.slice(merge.r1, merge.r2 + 1).filter((row) => row[0] !== "휴식").length === 2 ? 2 : 1,
        block: false,
        // 격자에는 강사 숨김 여부가 남지 않는다. 아래줄이 비어 있으면 그냥 강사 미지정으로 들어온다.
        hideTeacher: false,
        where: `[${sheet.name}] ${r + 1}행 ${day}`,
      });
    }
  }
  return out.length > 0 ? out : null;
}

/** ── 앱 데이터로 옮기기 ──────────────────────────────── */

export type ImportPreview = {
  assignments: Assignment[];
  newClasses: Klass[];
  newTeachers: Teacher[];
  newRooms: Room[];
  warnings: string[];
  /** 시트별로 어떤 모양으로 읽었는지 */
  sources: { sheet: string; format: "목록형" | "시간표형" | "건너뜀"; count: number }[];
};

export function importSheets(data: AppData, sheets: ReadSheet[]): ImportPreview {
  const warnings: string[] = [];
  const sources: ImportPreview["sources"] = [];
  const fixed = fixedCellSet(data);

  const knownRoomNames = new Set(data.rooms.map((r) => key(r.name)));
  const knownTeacherNames = new Set(data.teachers.map((t) => key(t.name)));

  const raws: Raw[] = [];
  for (const sheet of sheets) {
    const list = parseListSheet(sheet);
    if (list) {
      raws.push(...list);
      sources.push({ sheet: sheet.name, format: "목록형", count: list.length });
      continue;
    }
    const grid = parseGridSheet(sheet, knownRoomNames, knownTeacherNames);
    if (grid) {
      raws.push(...grid);
      sources.push({ sheet: sheet.name, format: "시간표형", count: grid.length });
      continue;
    }
    sources.push({ sheet: sheet.name, format: "건너뜀", count: 0 });
  }

  if (raws.length === 0)
    warnings.push(
      "읽을 수 있는 표를 찾지 못했습니다. [양식 받기]로 서식을 내려받아 그 열 이름을 그대로 쓰세요.",
    );

  // 이름 → id. 없으면 새로 만든다.
  const newClasses: Klass[] = [];
  const newTeachers: Teacher[] = [];
  const newRooms: Room[] = [];
  const classIds = new Map(data.classes.map((c) => [key(c.name), c.id]));
  const teacherIds = new Map(data.teachers.map((t) => [key(t.name), t.id]));
  const roomIds = new Map(data.rooms.map((r) => [key(r.name), r.id]));

  const resolveClass = (name: string): string => {
    const k = key(name);
    const hit = classIds.get(k);
    if (hit) return hit;
    const made: Klass = { id: uid("k"), name: norm(name) };
    classIds.set(k, made.id);
    newClasses.push(made);
    return made.id;
  };
  const resolveTeacher = (name: string): string | null => {
    if (!norm(name)) return null;
    const k = key(name);
    const hit = teacherIds.get(k);
    if (hit) return hit;
    const made = emptyTeacher(norm(name));
    teacherIds.set(k, made.id);
    newTeachers.push(made);
    return made.id;
  };
  const resolveRoom = (name: string): string | null => {
    if (!norm(name)) return null;
    const k = key(name);
    const hit = roomIds.get(k);
    if (hit) return hit;
    const made: Room = { id: uid("rm"), name: norm(name) };
    roomIds.set(k, made.id);
    newRooms.push(made);
    return made.id;
  };

  const dayIndex = new Map(data.days.map((d, i) => [key(d), i]));
  const resolveDay = (text: string): number | null => {
    const k = key(text);
    if (dayIndex.has(k)) return dayIndex.get(k)!;
    const first = norm(text).charAt(0);
    if (dayIndex.has(key(first))) return dayIndex.get(key(first))!;
    const en = DAY_EN[k.slice(0, 3)];
    if (en && dayIndex.has(en)) return dayIndex.get(en)!;
    return null;
  };

  const resolvePeriod = (text: string, day: number): number | null => {
    const periods = dayPeriods(data, day);
    const periodByLabel = new Map(periods.map((p, i) => [key(p.label), i]));
    const periodByStart = new Map(periods.map((p, i) => [p.start, i]));
    const k = key(text);
    if (periodByLabel.has(k)) return periodByLabel.get(k)!;
    const time = /^(\d{1,2}:\d{2})/.exec(norm(text));
    if (time && periodByStart.has(time[1])) return periodByStart.get(time[1])!;
    const n = /(\d+)/.exec(k);
    if (n) {
      const i = Number(n[1]) - 1;
      if (i >= 0 && i < periods.length) return i;
    }
    return null;
  };

  const missedDays = new Set<string>();
  const missedPeriods = new Set<string>();
  let skipped = 0;
  let onFixed = 0;

  type Pending = { a: Assignment; block: boolean };
  const pending: Pending[] = [];

  for (const raw of raws) {
    if (!raw.className) {
      skipped += 1;
      continue;
    }
    if (!raw.subject && !raw.teacher) continue; // 빈 칸
    const day = resolveDay(raw.day);
    if (day === null) {
      missedDays.add(raw.day || "(빈 칸)");
      skipped += 1;
      continue;
    }
    const period = raw.periodNumber !== undefined
      ? (raw.periodNumber > 0 && raw.periodNumber <= dayPeriods(data, day).length ? raw.periodNumber - 1 : null)
      : resolvePeriod(raw.period, day);
    if (period === null) {
      missedPeriods.add(raw.period || "(빈 칸)");
      skipped += 1;
      continue;
    }
    // 내보낸 격자를 되읽으면 Orientation·Closing 칸까지 딸려 온다. 고정 활동 자리는 수업이 아니다.
    if (fixed.has(slotKey(day, period))) {
      onFixed += 1;
      continue;
    }

    pending.push({
      a: newAssignment({
        classId: resolveClass(raw.className),
        teacherId: resolveTeacher(raw.teacher),
        roomId: resolveRoom(raw.room),
        subject: raw.subject,
        day,
        period,
        length: raw.span,
        hideTeacher: raw.hideTeacher || undefined,
      }),
      block: raw.block,
    });
  }

  if (missedDays.size > 0)
    warnings.push(
      `운영 요일에 없는 요일 ${[...missedDays].join(", ")} — [운영 시간] 탭에서 먼저 요일을 켜 주세요.`,
    );
  if (missedPeriods.size > 0)
    warnings.push(
      `교시를 알아볼 수 없는 값 ${[...missedPeriods].slice(0, 6).join(", ")} — 교시 수를 늘리거나 "3교시"처럼 적어 주세요.`,
    );

  // 목록형은 연속 2교시가 두 줄로 나뉘어 있다. 붙어 있는 같은 수업이면 하나로 되붙인다.
  pending.sort(
    (x, y) => x.a.classId.localeCompare(y.a.classId) || x.a.day - y.a.day || x.a.period - y.a.period,
  );
  const merged: Assignment[] = [];
  const same = (a: Assignment, b: Assignment) =>
    a.classId === b.classId &&
    a.day === b.day &&
    a.subject === b.subject &&
    a.teacherId === b.teacherId &&
    a.roomId === b.roomId &&
    Boolean(a.hideTeacher) === Boolean(b.hideTeacher);
  for (let i = 0; i < pending.length; i++) {
    const cur = pending[i];
    const next = pending[i + 1];
    if (
      cur.block &&
      next?.block &&
      cur.a.length === 1 &&
      next.a.length === 1 &&
      same(cur.a, next.a) &&
      next.a.period === cur.a.period + 1
    ) {
      merged.push({ ...cur.a, length: 2 });
      i += 1;
    } else {
      merged.push(cur.a);
    }
  }

  // 같은 반·요일·교시가 두 번 나오면 앞의 것만 남긴다.
  const taken = new Set<string>();
  const assignments: Assignment[] = [];
  let duplicates = 0;
  for (const a of merged) {
    const cells = a.length === 2 ? [a.period, a.period + 1] : [a.period];
    const keys = cells.map((p) => `${a.classId}|${a.day}|${p}`);
    if (keys.some((k) => taken.has(k))) {
      duplicates += 1;
      continue;
    }
    for (const k of keys) taken.add(k);
    assignments.push(a);
  }
  if (duplicates > 0) warnings.push(`같은 반의 같은 자리에 두 번 적힌 ${duplicates}칸은 앞의 것만 남겼습니다.`);
  if (skipped > 0) warnings.push(`요일·교시를 알아볼 수 없어 건너뛴 줄 ${skipped}개.`);
  if (onFixed > 0)
    warnings.push(`고정 활동(Orientation·Closing 등) 자리에 있던 ${onFixed}칸은 수업이 아니므로 넘겼습니다.`);

  return {
    assignments: sortAssignments(assignments),
    newClasses,
    newTeachers,
    newRooms,
    warnings,
    sources,
  };
}

/** 미리 본 결과를 실제 데이터에 반영한다. */
export function applyImport(data: AppData, preview: ImportPreview, mode: "replace" | "merge"): AppData {
  const kept =
    mode === "replace"
      ? []
      : // 겹치는 자리는 새로 올린 쪽이 이긴다.
        data.timetable.filter((old) => {
          const cells = old.length === 2 ? [old.period, old.period + 1] : [old.period];
          return !preview.assignments.some((a) => {
            if (a.classId !== old.classId || a.day !== old.day) return false;
            const mine = a.length === 2 ? [a.period, a.period + 1] : [a.period];
            return mine.some((p) => cells.includes(p));
          });
        });

  return {
    ...data,
    classes: [...data.classes, ...preview.newClasses],
    teachers: [...data.teachers, ...preview.newTeachers],
    rooms: [...data.rooms, ...preview.newRooms],
    timetable: sortAssignments([...kept, ...preview.assignments]),
  };
}

/** ── 업로드 양식 ─────────────────────────────────────── */

const TEMPLATE_HEADER = ["체험반", "요일", "교시", "프로그램", "강사", "체험존", "연속", "강사표기"];

/** 지금 입력된 값으로 예시 두 줄을 채운 빈 서식 */
export function buildTemplate(data: AppData): Blob {
  const periods = dayPeriods(data, 0);
  const cls = data.classes[0]?.name || "A반";
  const day = data.days[0] || "월";
  const p1 = periods[0]?.label || "1교시";
  const p2 = periods[1]?.label || "2교시";
  const teacher = data.teachers[0]?.name || "홍길동";
  const room = data.rooms[0]?.name || "";

  const rows: XCell[][] = [
    TEMPLATE_HEADER.map((t) => ({ text: t, style: "header" as const })),
    [cls, day, p1, "Airport & Immigration", teacher, room, "블록", ""].map((t) => ({
      text: t,
      style: "empty" as const,
    })),
    [cls, day, p2, "Airport & Immigration", teacher, room, "블록", ""].map((t) => ({
      text: t,
      style: "empty" as const,
    })),
    [cls, day, periods[2]?.label || "3교시", "Homeroom English", teacher, "", "", ""].map((t) => ({
      text: t,
      style: "empty" as const,
    })),
    [cls, day, periods[3]?.label || "4교시", "Adventure", teacher, "", "", "숨김"].map((t) => ({
      text: t,
      style: "empty" as const,
    })),
  ];

  const guide: XCell[][] = [
    [],
    [{ text: "· 한 줄이 한 칸입니다. 연속 2교시는 두 줄로 적고 [연속] 칸에 '블록'이라고 씁니다.", style: "title" }],
    [{ text: "· 체험반·강사·체험존은 이름이 처음 나오면 자동으로 만들어집니다.", style: "title" }],
    [{ text: "· 요일과 교시는 [운영 시간] 탭에 있는 것만 인식합니다.", style: "title" }],
    [
      {
        text: "· [강사표기] 칸에 '숨김'이라고 쓰면 체험반 시간표에는 강사가 나오지 않고 강사 시간표에만 들어갑니다.",
        style: "title",
      },
    ],
  ];

  const sheet: XSheet = {
    name: safeSheetName("시간표", "시간표"),
    colWidths: [14, 8, 14, 26, 14, 18, 8, 10],
    rows: [...rows, ...guide],
    rowHeights: [22, 20, 20, 20, 20, 10, 18, 18, 18, 18],
    merges: [],
  };
  return buildXlsx([sheet]);
}

/** 지금 구성된 시간표를 양식과 같은 모양으로 펼친다 (내보냈다가 고쳐서 다시 올릴 수 있게). */
export function toTemplateRows(data: AppData, list: Assignment[]): string[][] {
  const className = new Map(data.classes.map((c) => [c.id, c.name]));
  const teacherName = new Map(data.teachers.map((t) => [t.id, t.name]));
  const roomName = new Map(data.rooms.map((r) => [r.id, r.name]));
  const rows: string[][] = [TEMPLATE_HEADER];
  for (const a of sortAssignments(list)) {
    const periods = dayPeriods(data, a.day);
    for (let k = 0; k < a.length; k++) {
      rows.push([
        className.get(a.classId) ?? "",
        data.days[a.day] ?? "",
        periods[a.period + k]?.label ?? "",
        a.subject,
        a.teacherId ? (teacherName.get(a.teacherId) ?? "") : "",
        a.roomId ? (roomName.get(a.roomId) ?? "") : "",
        a.length === 2 ? "블록" : "",
        a.hideTeacher ? "숨김" : "",
      ]);
    }
  }
  return rows;
}
