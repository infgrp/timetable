/**
 * 날짜별 배정 — 과정 일차를 날짜에 짝지어 준다(혼합과정 3일/3일).
 *
 * 규칙은 단순하다. 시작일부터 운영일(운영 요일이면서 쉬는 날이 아닌 날)을 하나씩 세며
 * 도는 차례(order)를 차례로 붙인다. 차례가 끝나면 처음으로 돌아간다.
 *   order = [5·6 1일차, 5·6 2일차, 5·6 3일차, 3·4 1일차, 3·4 2일차, 3·4 3일차]
 *   10/12(월)=5·6 1일차, 10/13=2일차, 10/14=3일차, 10/15(목)=3·4 1일차, 10/16=2일차,
 *   (주말 건너뜀) 10/19(월)=3·4 3일차, 10/20(화)=5·6 1일차 …
 * 날짜는 모두 "YYYY-MM-DD" 글자로 다루고, 계산은 UTC 날짜 수로 한다(시간대에 흔들리지 않게).
 */
import type { AppData, CalendarConfig } from "./types";
import { sliceGrid } from "./assignments";
import type { Grid } from "./components/Timetable";

export const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
export const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" → UTC 날짜 수. 모양이 틀리면 NaN */
export function dayNumber(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return NaN;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const back = new Date(t);
  // 2월 30일 같은 날짜는 받지 않는다
  if (back.getUTCMonth() !== +m[2] - 1 || back.getUTCDate() !== +m[3]) return NaN;
  return t / DAY_MS;
}

export function dateOf(n: number): string {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export const weekdayOf = (n: number) => new Date(n * DAY_MS).getUTCDay();

/** 그 날짜가 든 주의 월요일 */
export function mondayOf(date: string): string {
  const n = dayNumber(date);
  const w = weekdayOf(n);
  return dateOf(n - ((w + 6) % 7));
}

export const addDays = (date: string, k: number) => dateOf(dayNumber(date) + k);

/** 오늘 날짜(한국 시간) */
export function today(): string {
  const now = new Date(Date.now() + 9 * 3_600_000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

export function defaultCalendar(data: Pick<AppData, "days">): CalendarConfig {
  return { enabled: false, start: "", end: "", order: data.days.map((_, i) => i), weekdays: [1, 2, 3, 4, 5], skip: [] };
}

/** 도는 차례 — 지운 일차는 빼고, 비었으면 days 순서대로 */
export function orderOf(data: Pick<AppData, "days" | "calendar">): number[] {
  const order = (data.calendar?.order ?? []).filter((d) => d >= 0 && d < data.days.length);
  return order.length ? order : data.days.map((_, i) => i);
}

export const calendarOn = (data: Pick<AppData, "calendar">) =>
  Boolean(data.calendar?.enabled && Number.isFinite(dayNumber(data.calendar.start)));

/** 설정에서 사람이 고쳐야 할 것 */
export function calendarIssues(data: Pick<AppData, "days" | "calendar">): string[] {
  const c = data.calendar;
  if (!c?.enabled) return [];
  const issues: string[] = [];
  if (!Number.isFinite(dayNumber(c.start))) issues.push("시작 날짜를 넣어 주세요.");
  if (c.end && !Number.isFinite(dayNumber(c.end))) issues.push("끝 날짜가 올바르지 않습니다.");
  if (c.end && dayNumber(c.end) < dayNumber(c.start)) issues.push("끝 날짜가 시작 날짜보다 앞섭니다.");
  if (!c.weekdays.length) issues.push("운영 요일을 하나 이상 고르세요.");
  if (Number.isFinite(dayNumber(c.start)) && !c.weekdays.includes(weekdayOf(dayNumber(c.start))))
    issues.push("시작 날짜가 운영 요일이 아닙니다.");
  if (Number.isFinite(dayNumber(c.start)) && c.skip.includes(c.start)) issues.push("시작 날짜가 쉬는 날로 들어가 있습니다.");
  const names = data.days.filter((d, i) => data.days.indexOf(d) !== i);
  if (names.length) issues.push(`일차 이름이 겹칩니다: ${[...new Set(names)].join(", ")} — 서로 다르게 지어 주세요.`);
  return issues;
}

export type DayState = "before" | "after" | "off" | "skip" | "on";

/**
 * from~to(포함) 사이 날짜마다 몇 일차인지.
 * 시작일부터 세야 하므로 from 이 멀리 있어도 앞에서부터 센다(한두 해면 금방이다).
 */
export function assignDates(data: Pick<AppData, "days" | "calendar">, from: string, to: string): Map<string, { state: DayState; day: number | null; turn: number }> {
  const out = new Map<string, { state: DayState; day: number | null; turn: number }>();
  const c = data.calendar;
  const a = dayNumber(from), b = dayNumber(to);
  if (!c || !Number.isFinite(a) || !Number.isFinite(b)) return out;
  const start = dayNumber(c.start);
  const end = c.end ? dayNumber(c.end) : Infinity;
  const skip = new Set(c.skip);
  const weekdays = new Set(c.weekdays);
  const order = orderOf(data);

  let count = 0; // 지금까지 센 운영일
  const first = Number.isFinite(start) ? Math.min(start, a) : a;
  for (let n = first; n <= b; n++) {
    const date = dateOf(n);
    let state: DayState;
    if (!Number.isFinite(start) || n < start) state = "before";
    else if (n > end) state = "after";
    else if (!weekdays.has(weekdayOf(n))) state = "off";
    else if (skip.has(date)) state = "skip";
    else state = "on";

    const day = state === "on" ? order[count % order.length] : null;
    const turn = state === "on" ? Math.floor(count / order.length) + 1 : 0;
    if (state === "on") count++;
    if (n >= a) out.set(date, { state, day, turn });
  }
  return out;
}

export type WeekColumn = {
  date: string;
  /** 표 머리에 쓰는 글자 "10/12 (월)" */
  label: string;
  /** 이날의 일차 (days index). 운영하지 않으면 null */
  day: number | null;
  state: DayState;
};

/** 한 주(월요일부터)의 칸들 — 운영 요일만 */
export function weekColumns(data: Pick<AppData, "days" | "calendar">, monday: string, lang: "ko" | "en" = "ko"): WeekColumn[] {
  const weekdays = data.calendar?.weekdays?.length ? data.calendar.weekdays : [1, 2, 3, 4, 5];
  const dates = Array.from({ length: 7 }, (_, k) => addDays(monday, k)).filter((d) => weekdays.includes(weekdayOf(dayNumber(d))));
  if (!dates.length) return [];
  const map = assignDates(data, dates[0], dates[dates.length - 1]);
  return dates.map((date) => {
    const n = dayNumber(date);
    const [, m, d] = date.split("-").map(Number);
    const wd = (lang === "en" ? WEEKDAY_EN : WEEKDAY_KO)[weekdayOf(n)];
    const hit = map.get(date) ?? { state: "before" as DayState, day: null };
    return { date, label: `${m}/${d} (${wd})`, day: hit.day, state: hit.state };
  });
}

/** 과정 일차로 짠 격자를 한 주의 날짜 칸으로 옮긴다 — 운영하지 않는 날은 빈 칸 */
export function weekGrid(grid: Grid, columns: WeekColumn[]): Grid {
  return sliceGrid(grid, columns.map((c) => (c.day === null ? -1 : c.day)));
}

const STATE_LABEL: Record<Exclude<DayState, "on">, string> = {
  before: "운영 전",
  after: "운영 끝",
  off: "쉬는 요일",
  skip: "쉬는 날",
};

/** 날짜 머리 위에 얹는 줄 — 그날이 몇 일차인지(쉬는 날이면 그렇게) */
export function weekBands(data: Pick<AppData, "days">, columns: WeekColumn[], t: (s: string) => string = (s) => s): { label: string; span: number }[] {
  return columns.map((c) => ({ label: c.day === null ? t(STATE_LABEL[c.state as Exclude<DayState, "on">] ?? "") : data.days[c.day], span: 1 }));
}

/** 요일 이름이 키인 하루 구성(daySlots)을 날짜 머리 글자에 맞춰 옮긴다 */
export function weekDaySlots(data: Pick<AppData, "days" | "daySlots">, columns: WeekColumn[]): AppData["daySlots"] {
  const out: NonNullable<AppData["daySlots"]> = {};
  for (const c of columns) {
    const slots = c.day === null ? undefined : data.daySlots?.[data.days[c.day]];
    if (slots) out[c.label] = slots;
  }
  return out;
}

/** 이 주가 운영 기간 안인지 — 주 이동 단추를 어디까지 열지 정한다 */
export function weekRange(data: Pick<AppData, "calendar">): { first: string; last: string | null } | null {
  const c = data.calendar;
  if (!c || !Number.isFinite(dayNumber(c.start))) return null;
  return { first: mondayOf(c.start), last: c.end && Number.isFinite(dayNumber(c.end)) ? mondayOf(c.end) : null };
}

/** 처음 보여 줄 주 — 오늘이 든 주, 운영 전이면 첫 주, 끝났으면 마지막 주 */
export function initialWeek(data: Pick<AppData, "calendar">, now = today()): string {
  const range = weekRange(data);
  const here = mondayOf(now);
  if (!range) return here;
  if (dayNumber(here) < dayNumber(range.first)) return range.first;
  if (range.last && dayNumber(here) > dayNumber(range.last)) return range.last;
  return here;
}

/**
 * 3일/3일처럼 "묶음 여러 개 × 일차 몇 개" 틀을 만든다.
 *   groups = ["5·6학년", "3·4학년"], length = 3
 *   → days = [5·6학년 1일차, 5·6학년 2일차, 5·6학년 3일차, 3·4학년 1일차, …]
 *   → 구간 = 묶음마다 하나(그 묶음의 일차들)
 */
export function cyclePlan(groups: string[], length: number): { days: string[]; segments: { name: string; days: number[] }[] } {
  const days: string[] = [];
  const segments: { name: string; days: number[] }[] = [];
  groups.forEach((name) => {
    const idx: number[] = [];
    for (let k = 1; k <= length; k++) {
      idx.push(days.length);
      days.push(`${name} ${k}일차`);
    }
    segments.push({ name, days: idx });
  });
  return { days, segments };
}
