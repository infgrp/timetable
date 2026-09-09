import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultData, DEFAULT_GEN, generateSlots, buildSolveRequest, fixedCellNames, allowedDaysOf, classCapacity, validate, migrate } from "../src/store";
import { calendarPeriods, changeDays, changeSlots, dayPeriods, scopeData, mergeSolved } from "../src/calendar";
import { buildGrids, conflictsOf, fits, fromSolveResult, newAssignment } from "../src/assignments";
import { sampleData } from "../src/sample";
import { solve } from "../src/solver";
import { applyRotation, previewRotation, previewUndo, rotateAssignments, undoRotation } from "../src/rotation";
import { scheduleRows } from "../src/scheduleLayout";
import { toSheet } from "../src/timetableSheet";
import { buildXlsx } from "../src/xlsx";
import { readXlsx } from "../src/xlsxRead";
import { importSheets, parseCsv, toTemplateRows } from "../src/importTimetable";
import { toCsv } from "../src/export";
import Timetable from "../src/components/Timetable";
import ViewerPanel from "../src/components/ViewerPanel";
import type { AppData } from "../src/types";

let count = 0;
async function check(name: string, run: () => unknown) {
  await run();
  console.log(`  ok   ${name}`);
  count++;
}
function solved(data: AppData, seed = 1, reserved: AppData["timetable"] = []) {
  const req = buildSolveRequest(data, { seed, timeLimitMs: 1000, reserved });
  const result = solve(req);
  assert.equal(result.ok, true, JSON.stringify(result.shortfalls));
  const timetable = fromSolveResult(result, req.lectures);
  assert.deepEqual(conflictsOf(data, timetable), []);
  return timetable;
}

await check("새 데이터에 월·수 Orientation / 화·금 Closing 기본값", () => {
  assert.deepEqual([...fixedCellNames(defaultData())], [["0:0", "Orientation"], ["2:0", "Orientation"], ["1:5", "Closing"], ["4:5", "Closing"]]);
  const old = { ...defaultData(), fixedActivities: [] };
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(old)))!.fixedActivities, []);
});

await check("요일 삭제·추가·순서 변경에서 기존 요일 의미 유지", () => {
  const data = sampleData();
  data.timetable = solved(data);
  const next = changeDays(data, ["금", "수", "화", "목", "토"]);
  const fixed = fixedCellNames(next);
  assert.equal(fixed.get("1:0"), "Orientation");
  assert.equal(fixed.get("2:5"), "Closing");
  assert.equal(fixed.get("0:5"), "Closing");
  assert.deepEqual(allowedDaysOf(next, next.classes[0]).map((d) => next.days[d]), ["화"]);
  for (const a of next.timetable) assert.equal(next.days[a.day], data.days[data.timetable.find((x) => x.id === a.id)!.day]);
  for (const t of next.teachers) {
    const previous = data.teachers.find((x) => x.id === t.id)!;
    assert.deepEqual(t.unavailable.map((k) => { const [d,p] = k.split(":").map(Number); return `${next.days[d]}:${p}`; }),
      previous.unavailable.filter((k) => !k.startsWith("0:")).map((k) => { const [d,p] = k.split(":").map(Number); return `${data.days[d]}:${p}`; }));
  }
  const emptySegment = changeDays(data, ["수", "목", "금"]);
  assert.deepEqual(allowedDaysOf(emptySegment, emptySegment.classes[0]), []);
  assert(validate(emptySegment).some((i) => i.level === "error" && i.text.includes("요일이 없습니다")));
});

await check("교시 삭제 시 배정·고정 활동·회피 시간의 참조 보정", () => {
  const data = sampleData();
  data.timetable = [newAssignment({ classId: data.classes[0].id, day: 1, period: 2, subject: "Keep" })];
  const next = changeSlots(data, "", data.slots.filter((s) => s.id !== data.slots[0].id));
  assert.equal(next.timetable[0].period, 1);
  assert.equal(fixedCellNames(next).get("1:4"), "Closing");
  assert(!fixedCellNames(next).has("0:0"));
  assert.deepEqual(next.teachers.find((t) => t.name === "Sophia Wilson")!.unavailable, ["4:3"]);
});

await check("월화 생성 → 수목금 생성 → 월화 재생성에서 수목금 보존", () => {
  let data = sampleData();
  const early = scopeData(data, data.segments[0].id);
  data = mergeSolved(data, early.classes.map((c) => c.id), solved(early));
  assert.equal(data.timetable.reduce((n,a) => n+a.length,0), 30);
  const late = scopeData(data, data.segments[1].id);
  data = mergeSolved(data, late.classes.map((c) => c.id), solved(late, 2, data.timetable));
  const lateIds = new Set(late.classes.map((c) => c.id));
  const preserved = data.timetable.filter((a) => lateIds.has(a.classId));
  const next = mergeSolved(data, early.classes.map((c) => c.id), solved(early, 3, preserved));
  assert.deepEqual(next.timetable.filter((a) => lateIds.has(a.classId)), preserved);
  assert.equal(next.timetable.reduce((n,a) => n+a.length,0), 78);
  assert.deepEqual(conflictsOf(next, next.timetable), []);
});

await check("구간이 같은 요일을 쓸 때 보존한 강사·체험존 시간 회피", () => {
  const data: AppData = { ...defaultData(), days: ["월"], fixedActivities: [],
    slots: generateSlots({ ...DEFAULT_GEN, periodCount: 3, lunchAfter: 0 }),
    classes: [{ id: "keep", name: "기존", segmentId: "one" }, { id: "new", name: "신규", segmentId: "two" }],
    segments: [{ id: "one", name: "기존", days: [0] }, { id: "two", name: "신규", days: [0] }],
    teachers: ["A", "B"].map((id) => ({ id, name: id, unavailable: [] })), rooms: [{ id: "R", name: "R" }],
    courses: [
      { id: "c1", teacherId: "A", subject: "Teacher", classIds: ["new"], hours: 1, blocks: 0, roomId: null },
      { id: "c2", teacherId: "B", subject: "Room", classIds: ["new"], hours: 1, blocks: 0, roomId: "R" },
    ], timetable: [newAssignment({ classId: "keep", teacherId: "A", roomId: "R", day: 0, period: 0, subject: "Keep" })],
  };
  const selected = scopeData(data, "two");
  const list = solved(selected, 1, data.timetable);
  assert(list.every((a) => a.period > 0));
  assert.deepEqual(conflictsOf(data, [...data.timetable, ...list]), []);
});

const rotating: AppData = { ...defaultData(), fixedActivities: [],
  classes: [{ id: "K1", name: "D반" }, { id: "K2", name: "E반" }],
  teachers: ["A", "B", "C"].map((id) => ({ id, name: id, unavailable: [] })),
  timetable: [newAssignment({ id: "adventure", classId: "K1", teacherId: "A", subject: "Adventure", day: 0, period: 1, hideTeacher: true })],
  rotation: { groups: [{ id: "G", name: "교사", teacherIds: ["A", "B", "C"] }], turns: 0, log: [] },
};

await check("로테이션 조 중복·회피 시간 침범 차단 및 원본 유지", () => {
  const overlap = [{ id: "a", name: "a", teacherIds: ["A", "B"] }, { id: "b", name: "b", teacherIds: ["B", "C"] }];
  assert.throws(() => rotateAssignments(rotating.timetable, overlap, 1), /한 강사/);
  const avoid = { ...rotating, teachers: rotating.teachers.map((t) => t.id === "C" ? { ...t, unavailable: ["0:1"] } : t) };
  const before = JSON.stringify(avoid);
  assert(previewRotation(avoid).errors.some((e) => e.includes("회피")));
  assert.throws(() => applyRotation(avoid, "거부"), /회피/);
  assert.equal(JSON.stringify(avoid), before);
});

await check("규칙 변경·저장 후 되돌리기와 수정된 담당자 보호", () => {
  const applied = applyRotation(rotating, "이번 주");
  assert.equal(applied.timetable[0].teacherId, "C");
  const changedRules = { ...applied, rotation: { ...applied.rotation, groups: [] } };
  const loaded = migrate(JSON.parse(JSON.stringify(changedRules)))!;
  assert.deepEqual(undoRotation(loaded).timetable, rotating.timetable);
  const edited = { ...applied, timetable: applied.timetable.map((a) => ({ ...a, teacherId: "B" })) };
  assert(previewUndo(edited).errors.length);
  assert.throws(() => undoRotation(edited), /修正|수정/);
  assert(previewUndo({ ...applied, timetable: [] }).errors.length);
});

await check("등원하지 않는 날의 고정 활동 제외", () => {
  const data = sampleData();
  const grid = buildGrids(data, []).byClass.get(data.classes[0].id)!;
  assert.equal(grid[0][2], null);
  assert.equal(grid[5][4], null);
  assert.equal((grid[0][0] as { top: string }).top, "Orientation");
  assert.equal(classCapacity(data, data.classes[0]), 10);
});

const daily: AppData = { ...rotating, days: ["월", "화"], slots: generateSlots({ ...DEFAULT_GEN, periodCount: 4, lunchAfter: 2 }),
  daySlots: { 화: generateSlots({ ...DEFAULT_GEN, firstStart: "10:00", periodMinutes: 30, periodCount: 3, lunchAfter: 1 }) },
  timetable: [newAssignment({ classId: "K1", teacherId: "A", subject: "Block", day: 0, period: 0, length: 2 }),
    newAssignment({ classId: "K1", teacherId: "B", subject: "Tuesday", day: 1, period: 1, length: 2 })],
};

await check("요일별 교시 수·시각·점심 위치 및 블록 제약", () => {
  assert.equal(calendarPeriods(daily).length, 4);
  assert.equal(dayPeriods(daily, 1)[0].start, "10:00");
  assert.equal(fits(daily, 0, 0, 2), true);
  assert.equal(fits(daily, 1, 0, 2), false);
  assert.equal(fits(daily, 1, 1, 2), true);
  assert.equal(fits(daily, 1, 3, 1), false);
  assert.deepEqual(conflictsOf(daily, daily.timetable), []);
  const blockOnly: AppData = { ...daily, classes: [{ id: "K1", name: "D반", segmentId: "tue" }], segments: [{ id: "tue", name: "화", days: [1] }],
    courses: [{ id: "c", teacherId: "A", subject: "Block", classIds: ["K1"], hours: 2, blocks: 1, roomId: null }], timetable: [] };
  for (let i = 0; i < 5; i++) {
    const list = solved(blockOnly, i);
    assert.equal(list[0].day, 1);
    assert.equal(list[0].period, 1);
  }
});

await check("요일별 점심이 다른 통합 표의 화면·엑셀 병합 및 왕복", async () => {
  const grid = buildGrids(daily, daily.timetable).byClass.get("K1")!;
  const layout = scheduleRows(daily.days, daily.slots, daily.daySlots!, grid);
  assert.equal(layout[0].entries[0].span, 3);
  assert.equal(layout[0].entries[0].slot?.end, dayPeriods(daily, 0)[1].end);
  assert.equal(layout[1].entries[0].continuation, true);
  assert.equal(layout[1].entries[1].slot?.label, "점심시간");
  const html = renderToStaticMarkup(createElement(Timetable, { title: "D반", days: daily.days, slots: daily.slots, daySlots: daily.daySlots, grid }));
  assert(html.includes('rowSpan="3"'));
  assert(html.includes("10:00"));
  assert(html.includes("점심시간"));
  const sheet = toSheet({ sheetName: "D반", title: "D반", days: daily.days, slots: daily.slots, daySlots: daily.daySlots, grid });
  const read = await readXlsx(await buildXlsx([sheet]).arrayBuffer());
  const imported = importSheets(daily, read);
  assert.equal(imported.assignments.length, 2);
  assert(imported.assignments.every((a) => a.length === 2));
  assert.deepEqual(conflictsOf(daily, imported.assignments), []);
  assert.equal(imported.newTeachers.length, 0);
  const renamed = { ...daily, daySlots: { ...daily.daySlots, 화: daily.daySlots!.화.map((slot, i) => ({ ...slot, label: slot.kind === "period" ? `프로그램 ${10 + i}` : slot.label })) } };
  const renamedGrid = buildGrids(renamed, renamed.timetable).byClass.get("K1")!;
  const renamedSheet = toSheet({ sheetName: "D반", title: "D반", days: renamed.days, slots: renamed.slots, daySlots: renamed.daySlots, grid: renamedGrid });
  const renamedBack = importSheets(renamed, await readXlsx(await buildXlsx([renamedSheet]).arrayBuffer()));
  assert.equal(renamedBack.assignments.find((a) => a.subject === "Tuesday")!.period, 1);
});

await check("D반 Adventure 숨김은 로테이션·CSV·개인 시간표에 유지", () => {
  const data = applyRotation(rotating, "다음 주");
  const a = data.timetable[0];
  const grids = buildGrids(data, data.timetable);
  const cls = grids.byClass.get(a.classId)![a.period][a.day];
  const teacher = grids.byTeacher.get(a.teacherId!)![a.period][a.day];
  assert(cls && cls !== "cont" && !cls.bottom);
  assert(teacher && teacher !== "cont" && teacher.bottom === "Adventure");
  const back = importSheets(data, [{ name: "시간표", rows: parseCsv(toCsv(toTemplateRows(data, data.timetable))), merges: [] }]);
  assert(back.assignments[0].hideTeacher);
  assert.equal(back.assignments[0].teacherId, "C");
});

await check("전체 예시 20회 배치·통합 보기 회귀", () => {
  const data = sampleData();
  for (let seed = 1; seed <= 20; seed++) {
    const list = solved(data, seed);
    assert.equal(list.reduce((n,a) => n+a.length,0), 78);
    assert(list.filter((a) => a.subject === "Adventure").every((a) => a.hideTeacher));
    data.timetable = list;
  }
  const html = renderToStaticMarkup(createElement(ViewerPanel, { data, onBuild: () => {} }));
  assert(html.includes("Adventure"));
  assert(html.includes("빈 칸 0"));
});

console.log(`\n${count}개 요구사항 회귀 검사 통과`);
