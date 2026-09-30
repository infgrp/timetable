/**
 * 날짜별 배정(혼합과정 3일/3일)이 센터의 실제 운영표와 같은지 확인한다.
 *
 * 기준: 2026년 10~12월 운영표(센터가 보낸 달력 그림)
 *   10/12(월)부터 [5,6] 3일 → [3,4] 3일 → [5,6] 3일 … 이 주말을 건너뛰며 이어지고,
 *   12/16(수)에 [3,4] 원천·수지가 끝난다. 12/17·18 은 준비기간.
 */
import type { AppData } from "../src/types";
import { defaultData, migrate } from "../src/store";
import { changeDays } from "../src/calendar";
import { buildGrids } from "../src/assignments";
import {
  assignDates, calendarIssues, cyclePlan, dayNumber, initialWeek, mondayOf, weekBands, weekColumns, weekGrid,
} from "../src/weekly";

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

/** ── 틀: 5·6학년 1~3일차, 3·4학년 1~3일차 ─────────────── */
const plan = cyclePlan(["5·6학년", "3·4학년"], 3);
check("틀 — 일차 여섯", plan.days.length === 6, plan.days.join(", "));
check("틀 — 구간 둘(묶음마다 세 일차)", plan.segments.length === 2 && plan.segments[1].days.join() === "3,4,5");

const base = defaultData();
const data: AppData = {
  ...base,
  days: plan.days,
  segments: plan.segments.map((s, i) => ({ id: `s${i}`, ...s })),
  timetable: [],
  calendar: { enabled: true, start: "2026-10-12", end: "2026-12-16", order: [], weekdays: [1, 2, 3, 4, 5], skip: [] },
};
check("설정에 고칠 것 없음", calendarIssues(data).length === 0, calendarIssues(data).join(" / "));

/** 운영표 그대로 — 날짜 → 무슨 일차 */
const G56 = "5·6학년", G34 = "3·4학년";
const expected: [string, string, number][] = [
  ["2026-10-12", G56, 1], ["2026-10-13", G56, 2], ["2026-10-14", G56, 3], ["2026-10-15", G34, 1], ["2026-10-16", G34, 2],
  ["2026-10-19", G34, 3], ["2026-10-20", G56, 1], ["2026-10-21", G56, 2], ["2026-10-22", G56, 3], ["2026-10-23", G34, 1],
  ["2026-10-26", G34, 2], ["2026-10-27", G34, 3], ["2026-10-28", G56, 1], ["2026-10-29", G56, 2], ["2026-10-30", G56, 3],
  ["2026-11-02", G34, 1], ["2026-11-03", G34, 2], ["2026-11-04", G34, 3], ["2026-11-05", G56, 1], ["2026-11-06", G56, 2],
  ["2026-11-09", G56, 3], ["2026-11-10", G34, 1], ["2026-11-11", G34, 2], ["2026-11-12", G34, 3], ["2026-11-13", G56, 1],
  ["2026-11-16", G56, 2], ["2026-11-17", G56, 3], ["2026-11-18", G34, 1], ["2026-11-19", G34, 2], ["2026-11-20", G34, 3],
  ["2026-11-23", G56, 1], ["2026-11-24", G56, 2], ["2026-11-25", G56, 3], ["2026-11-26", G34, 1], ["2026-11-27", G34, 2],
  ["2026-11-30", G34, 3], ["2026-12-01", G56, 1], ["2026-12-02", G56, 2], ["2026-12-03", G56, 3], ["2026-12-04", G34, 1],
  ["2026-12-07", G34, 2], ["2026-12-08", G34, 3], ["2026-12-09", G56, 1], ["2026-12-10", G56, 2], ["2026-12-11", G56, 3],
  ["2026-12-14", G34, 1], ["2026-12-15", G34, 2], ["2026-12-16", G34, 3],
];
const map = assignDates(data, "2026-10-01", "2026-12-31");
const wrong = expected.filter(([date, g, k]) => {
  const hit = map.get(date);
  return !hit || hit.day === null || data.days[hit.day] !== `${g} ${k}일차`;
});
check(`운영표 48일이 모두 맞는다`, wrong.length === 0,
  wrong.slice(0, 4).map(([d]) => `${d}: ${map.get(d)?.day != null ? data.days[map.get(d)!.day!] : map.get(d)?.state}`).join(" / "));

check("주말은 운영하지 않는다", map.get("2026-10-17")?.state === "off" && map.get("2026-10-18")?.state === "off");
check("시작 전은 비운다", map.get("2026-10-09")?.state === "before");
check("끝난 뒤(준비기간 12/17)는 비운다", map.get("2026-12-17")?.state === "after");
check("열여섯 번의 방문(8바퀴)으로 끝난다", map.get("2026-12-16")?.turn === 8, `turn=${map.get("2026-12-16")?.turn}`);

/** 쉬는 날을 넣으면 다음 운영일이 이어받는다 */
const withHoliday: AppData = { ...data, calendar: { ...data.calendar!, skip: ["2026-10-14"] } };
const shifted = assignDates(withHoliday, "2026-10-12", "2026-10-16");
check("쉬는 날은 건너뛰고 다음 날이 3일차를 이어받는다",
  shifted.get("2026-10-14")?.state === "skip" && withHoliday.days[shifted.get("2026-10-15")!.day!] === "5·6학년 3일차");

/** 먼저 오는 묶음을 바꿀 수 있다 */
const threeFirst: AppData = { ...data, calendar: { ...data.calendar!, order: [3, 4, 5, 0, 1, 2] } };
check("3·4학년부터 시작하는 차례도 된다", threeFirst.days[assignDates(threeFirst, "2026-10-12", "2026-10-12").get("2026-10-12")!.day!] === "3·4학년 1일차");

/** 주별 칸 — 둘째 주(10/19) */
const cols = weekColumns(data, "2026-10-19");
check("둘째 주 칸 다섯(월~금)", cols.length === 5, cols.map((c) => c.label).join(" "));
check("둘째 주 머리 — 3·4 3일차, 5·6 1~3일차, 3·4 1일차",
  weekBands(data, cols).map((b) => b.label).join(" | ") === "3·4학년 3일차 | 5·6학년 1일차 | 5·6학년 2일차 | 5·6학년 3일차 | 3·4학년 1일차",
  weekBands(data, cols).map((b) => b.label).join(" | "));
check("날짜 표기", cols[0].label === "10/19 (월)" && weekColumns(data, "2026-10-19", "en")[0].label === "10/19 (Mon)");

/** 일차로 짠 격자를 주로 옮기면 그 일차의 칸이 그날로 온다 */
const cls = { id: "c1", name: "TEAM A", segmentId: "s0" };
const withLesson: AppData = {
  ...data,
  classes: [cls],
  // 1일차 1교시는 Orientation — 요일이 아니라 일차에 붙는 고정 활동
  fixedActivities: [{ id: "f", name: "Orientation", cells: ["0:0", "3:0"] }],
  timetable: [{ id: "x", classId: "c1", teacherId: null, roomId: null, subject: "Airport", day: 1, period: 0, length: 1 }],
};
const grid = buildGrids(withLesson, withLesson.timetable).byClass.get("c1")!;
const wk = weekGrid(grid, weekColumns(withLesson, "2026-10-19"));
const firstRow = wk[0].map((x) => (x && x !== "cont" ? x.top : null));
check("5·6 2일차 1교시 수업이 10/21(수) 1교시로 온다", firstRow[2] === "Airport", JSON.stringify(firstRow));
check("일차에 붙은 Orientation 도 그 날짜로 따라온다 — 5·6 반은 10/20(1일차)에만",
  firstRow[1] === "Orientation" && firstRow[4] === null && firstRow[0] === null, JSON.stringify(firstRow));
const low = { id: "c2", name: "TEAM A(3·4)", segmentId: "s1" };
const both = { ...withLesson, classes: [cls, low] };
const lowRow = weekGrid(buildGrids(both, both.timetable).byClass.get("c2")!, weekColumns(both, "2026-10-19"))[0]
  .map((x) => (x && x !== "cont" ? x.top : null));
check("3·4 반은 10/23(3·4 1일차)에 Orientation, 5·6 날짜에는 비어 있다",
  lowRow[4] === "Orientation" && lowRow[1] === null && lowRow[2] === null, JSON.stringify(lowRow));

/** 처음 보여 줄 주 */
check("운영 전에는 첫 주를 보여 준다", initialWeek(data, "2026-09-30") === "2026-10-12");
check("운영 중에는 이번 주", initialWeek(data, "2026-11-11") === "2026-11-09");
check("끝난 뒤에는 마지막 주", initialWeek(data, "2027-01-05") === mondayOf("2026-12-16"));

/** 일차 이름을 바꾸거나 지워도 도는 차례가 따라간다 */
const renamed = changeDays({ ...data, calendar: { ...data.calendar!, order: [3, 4, 5, 0, 1, 2] } }, [...data.days.slice(0, 5)]);
check("일차를 지우면 차례에서도 빠진다", renamed.calendar!.order.join() === "3,4,0,1,2", renamed.calendar!.order.join());

/** 저장·불러오기 */
const restored = migrate(JSON.parse(JSON.stringify(data)))!;
check("저장했다 불러와도 설정이 그대로", JSON.stringify(restored.calendar) === JSON.stringify(data.calendar));
check("예전 저장본(설정 없음)도 열린다", migrate({ ...JSON.parse(JSON.stringify(base)), calendar: undefined })!.calendar === undefined);
check("깨진 날짜는 걸러 낸다", migrate({ ...JSON.parse(JSON.stringify(data)), calendar: { ...data.calendar, skip: ["2026-13-45x", "2026-10-14"] } })!.calendar!.skip.join() === "2026-10-14");

/** 잘못 넣은 설정을 짚어 준다 */
check("시작일이 토요일이면 알린다", calendarIssues({ ...data, calendar: { ...data.calendar!, start: "2026-10-10" } }).some((s) => s.includes("운영 요일")));
check("일차 이름이 겹치면 알린다", calendarIssues({ ...data, days: ["1일차", "1일차"] }).some((s) => s.includes("겹칩니다")));
check("없는 날짜(2월 30일)는 받지 않는다", Number.isNaN(dayNumber("2026-02-30")));

console.log(failed === 0 ? "\n전부 통과" : `\n${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
