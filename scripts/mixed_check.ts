/**
 * 혼합과정(3일/3일)을 처음부터 끝까지 — 틀 만들기 → 자동 배치 → 주별 보기.
 *   1) 예시(기본과정 월·화 / 수·목·금)를 3일/3일 일차 틀로 바꾼다
 *   2) 자동 배치로 풀고 하드 제약(반·강사·존 겹침)을 직접 센다
 *   3) 날짜별 배정을 켜고, 주마다 요일 칸에 맞는 일차가 오는지 본다
 * 결과 설정은 mixed_sample.json 으로 남긴다(브라우저 확인용).
 */
import { writeFileSync } from "node:fs";
import type { AppData } from "../src/types";
import { sampleData } from "../src/sample";
import { changeDays } from "../src/calendar";
import { buildSolveRequest, uid, validate } from "../src/store";
import { solve } from "../src/solver";
import { buildGrids, conflictsOf, fromSolveResult } from "../src/assignments";
import { cyclePlan, weekBands, weekColumns, weekDaySlots, weekGrid } from "../src/weekly";
import { toSheet } from "../src/timetableSheet";
import { buildXlsx } from "../src/xlsx";

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

const base = sampleData();
const plan = cyclePlan(["5·6학년", "3·4학년"], 3);
const moved = changeDays(base, plan.days);
const segments = plan.segments.map((s) => ({ id: uid("sg"), ...s }));
const [high, low] = segments;

// 예시의 TEAM A~C 는 5·6학년, D~F 는 3·4학년으로
const classes = base.classes.map((c, i) => ({ ...c, segmentId: i < 3 ? high.id : low.id }));
const data: AppData = {
  ...moved,
  schoolName: "혼합과정 시험",
  segments,
  classes,
  daySlots: {},
  // 요일에 묶여 있던 과목은 일차와 맞지 않으므로 풀어 둔다
  courses: moved.courses.map((c) => ({ ...c, days: [] })),
  // 1일차 1교시 Orientation, 3일차 마지막 교시 Closing — 묶음마다
  fixedActivities: [
    { id: uid("f"), name: "Orientation", cells: ["0:0", "3:0"] },
    { id: uid("f"), name: "Closing", cells: ["2:5", "5:5"] },
  ],
  timetable: [],
  calendar: { enabled: true, start: "2026-10-12", end: "2026-12-16", order: [0, 1, 2, 3, 4, 5], weekdays: [1, 2, 3, 4, 5], skip: [] },
};

const errors = validate(data).filter((i) => i.level === "error");
check("설정 검사에 막히는 것 없음", errors.length === 0, errors.map((e) => e.text).join(" / "));

const req = buildSolveRequest(data, { timeLimitMs: 8000, seed: 20261012 });
const result = solve(req);
const timetable = fromSolveResult(result, req.lectures);
const solved: AppData = { ...data, timetable };
check(`자동 배치 완료 (${result.elapsedMs}ms)`, result.ok, result.message);
const conflicts = conflictsOf(solved, timetable);
check("반·강사·체험존 겹침 없음", conflicts.length === 0, conflicts.slice(0, 3).map((c) => c.text).join(" / "));

// 5·6 반은 5·6 일차에만, 3·4 반은 3·4 일차에만
const outside = timetable.filter((a) => {
  const seg = classes.find((c) => c.id === a.classId)!.segmentId === high.id ? high : low;
  return !seg.days.includes(a.day);
});
check("반마다 자기 묶음의 일차에만 들어간다", outside.length === 0, `${outside.length}칸 벗어남`);

// 주별 — 둘째 주(10/19~23): 월=3·4 3일차, 화수목=5·6 1~3일차, 금=3·4 1일차
const grids = buildGrids(solved, timetable);
const cols = weekColumns(solved, "2026-10-19");
check("둘째 주 일차 배치", weekBands(solved, cols).map((b) => b.label).join(" | ")
  === "3·4학년 3일차 | 5·6학년 1일차 | 5·6학년 2일차 | 5·6학년 3일차 | 3·4학년 1일차");

// 강사 한 명의 주별 시간표가 일차별 원본과 칸 수가 맞는가
const teacher = solved.teachers[0];
const byDay = grids.byTeacher.get(teacher.id)!;
const week = weekGrid(byDay, cols);
const count = (g: typeof week, cols: number[]) => g.reduce((n, row) => n + cols.filter((c) => row[c] && row[c] !== "cont").length, 0);
const fromTemplate = cols.reduce((n, c) => n + (c.day === null ? 0 : byDay.reduce((m, row) => m + (row[c.day!] && row[c.day!] !== "cont" ? 1 : 0), 0)), 0);
check(`강사(${teacher.name}) 주별 칸 수 = 그 주 일차들의 칸 수 합`, count(week, [0, 1, 2, 3, 4]) === fromTemplate, `${count(week, [0, 1, 2, 3, 4])} / ${fromTemplate}`);

// 엑셀로 받을 때도 날짜 머리와 일차 줄이 들어간다
const sheet = toSheet({
  sheetName: teacher.name,
  title: `${teacher.name} 강사 시간표 (10/19~10/23)`,
  days: cols.map((c) => c.label),
  slots: solved.slots,
  daySlots: weekDaySlots(solved, cols),
  grid: week,
  bands: weekBands(solved, cols),
});
const text = JSON.stringify(sheet);
check("엑셀 — 날짜 머리(10/19 (월))와 일차 줄(3·4학년 3일차)이 들어간다", text.includes("10/19 (월)") && text.includes("3·4학년 3일차"));
check("엑셀 — 파일로 묶어도 깨지지 않는다", buildXlsx([sheet]).size > 1000, `${buildXlsx([sheet]).size} bytes`);

writeFileSync("mixed_sample.json", JSON.stringify(solved, null, 2), "utf8");
console.log(`\n수업 ${timetable.length}칸 · mixed_sample.json 저장`);
console.log(failed === 0 ? "\n전부 통과" : `\n${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
