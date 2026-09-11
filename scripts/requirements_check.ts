import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildLectures, defaultData, DEFAULT_GEN, generateSlots, buildSolveRequest, comboLimitOf, dayGroups, fixedCellNames, allowedDaysOf, classCapacity, programRoomOf, validate, migrate } from "../src/store";
import { calendarPeriods, changeDays, changeSlots, dayPeriods, scopeData, mergeSolved } from "../src/calendar";
import { buildGrids, conflictsOf, draftForOwner, fits, fromSolveResult, mergedGrid, newAssignment } from "../src/assignments";
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
  // 기대 시수는 예시 데이터에서 직접 뽑는다 — 예시를 손봐도 검사가 깨지지 않도록.
  const hoursOf = (d: AppData, ids: Set<string>) =>
    buildLectures(d).filter((l) => ids.has(l.classId)).reduce((n, l) => n + l.hours, 0);
  const allHours = hoursOf(data, new Set(data.classes.map((c) => c.id)));
  const early = scopeData(data, data.segments[0].id);
  const earlyIds = new Set(early.classes.map((c) => c.id));
  data = mergeSolved(data, early.classes.map((c) => c.id), solved(early));
  assert.equal(data.timetable.reduce((n,a) => n+a.length,0), hoursOf(data, earlyIds));
  const late = scopeData(data, data.segments[1].id);
  data = mergeSolved(data, late.classes.map((c) => c.id), solved(late, 2, data.timetable));
  const lateIds = new Set(late.classes.map((c) => c.id));
  const preserved = data.timetable.filter((a) => lateIds.has(a.classId));
  const next = mergeSolved(data, early.classes.map((c) => c.id), solved(early, 3, preserved));
  assert.deepEqual(next.timetable.filter((a) => lateIds.has(a.classId)), preserved);
  assert.equal(next.timetable.reduce((n,a) => n+a.length,0), allHours);
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

await check("[구간당 1회]를 켠 프로그램은 여러 배정으로 나뉘어도 한 번만", () => {
  const base: AppData = {
    ...defaultData(), days: ["월", "화", "수"], fixedActivities: [],
    slots: generateSlots({ ...DEFAULT_GEN, periodCount: 3, lunchAfter: 0 }),
    classes: [{ id: "K", name: "D반", segmentId: "seg" }, { id: "N", name: "N반" }],
    segments: [{ id: "seg", name: "월화", days: [0, 1] }],
    teachers: [{ id: "T1", name: "강사1", unavailable: [] }, { id: "T2", name: "강사2", unavailable: [] }],
    rooms: [],
    courses: [
      { id: "c1", teacherId: "T1", subject: "Adventure", classIds: ["K"], hours: 1, blocks: 0, roomId: null, oncePerSegment: true },
      { id: "c2", teacherId: "T2", subject: "Adventure", classIds: ["K"], hours: 1, blocks: 0, roomId: null, oncePerSegment: true },
    ], timetable: [],
  };
  // 월·화 구간의 반에 같은 프로그램이 두 배정으로 2회 → 구간당 1회라 불가능. 검증이 막는다.
  assert(validate(base).some((i) => i.level === "error" && i.text.includes("구간당 1회")));
  assert.deepEqual(dayGroups(base), [3, 3, 2]);
  // 손으로 같은 구간의 다른 날에 두 번 넣어도 중복 충돌로 잡힌다.
  const dup = [
    newAssignment({ classId: "K", subject: "Adventure", teacherId: "T1", day: 0, period: 0 }),
    newAssignment({ classId: "K", subject: "Adventure", teacherId: "T2", day: 1, period: 1 }),
  ];
  assert(conflictsOf(base, dup).some((c) => c.kind === "duplicate" && c.text.includes("구간당 1회")));

  // 기본(하루 1회)인 수업은 서로 다른 날에 놓인다.
  const repeat: AppData = { ...base, courses: [
    { id: "c", teacherId: "T1", subject: "Homeroom", classIds: ["K"], hours: 2, blocks: 0, roomId: null },
  ] };
  assert.equal(validate(repeat).filter((i) => i.level === "error").length, 0);
  for (let seed = 1; seed <= 5; seed++) {
    const days = solved(repeat, seed).map((a) => a.day);
    assert.equal(days.length, 2);
    assert.equal(new Set(days).size, 2);
    assert(days.every((d) => d < 2));
  }
  // 기본이어도 같은 날 두 번은 안 된다. 엑셀에서 올라온 배치(표시 없음)도 배정 설정을 빌려 판정한다.
  const sameDay = [
    newAssignment({ classId: "K", subject: "Homeroom", teacherId: "T1", day: 0, period: 0 }),
    newAssignment({ classId: "K", subject: "Homeroom", teacherId: "T1", day: 0, period: 2 }),
  ];
  assert(conflictsOf(repeat, sameDay).some((c) => c.kind === "duplicate" && c.text.includes("하루 1회")));
  const twoDays = [sameDay[0], { ...sameDay[1], day: 1 }];
  assert.deepEqual(conflictsOf(repeat, twoDays), []);
  // [구간당 1회]를 켜면 같은 시수라도 구간당 1회에 걸린다.
  const strict: AppData = { ...repeat, courses: [{ ...repeat.courses[0], oncePerSegment: true }] };
  assert(validate(strict).some((i) => i.level === "error" && i.text.includes("구간당 1회")));
  assert(conflictsOf(strict, twoDays).some((c) => c.kind === "duplicate"));

  // 구간이 없는 반은 예전처럼 하루 1회 — 2시수가 서로 다른 날로 나뉜다.
  const free: AppData = { ...base, courses: [
    { id: "c", teacherId: "T1", subject: "Adventure", classIds: ["N"], hours: 2, blocks: 0, roomId: null },
  ] };
  for (let seed = 1; seed <= 5; seed++) {
    const days = solved(free, seed).map((a) => a.day);
    assert.equal(new Set(days).size, 2);
  }
});

await check("[구간당 1회] 배정은 구간마다 한 번만 놓임", () => {
  // 월·화 반에 프로그램 1시수 배정 → 월 또는 화 중 하루에만. 20회 돌려 어느 요일에도 두 번 나오지 않는지.
  const data: AppData = {
    ...defaultData(), days: ["월", "화", "수", "목"], fixedActivities: [],
    slots: generateSlots({ ...DEFAULT_GEN, periodCount: 2, lunchAfter: 0 }),
    classes: [{ id: "K", name: "K반", segmentId: "a" }, { id: "L", name: "L반", segmentId: "b" }],
    segments: [{ id: "a", name: "월화", days: [0, 1] }, { id: "b", name: "수목", days: [2, 3] }],
    teachers: [{ id: "T1", name: "T1", unavailable: [] }, { id: "T2", name: "T2", unavailable: [] }],
    rooms: [],
    courses: [
      { id: "c1", teacherId: "T1", subject: "Airport", classIds: ["K", "L"], hours: 1, blocks: 0, roomId: null, oncePerSegment: true },
      { id: "c2", teacherId: "T2", subject: "Shop", classIds: ["K", "L"], hours: 1, blocks: 0, roomId: null, oncePerSegment: true },
      { id: "c3", teacherId: "T1", subject: "Homeroom", classIds: ["K", "L"], hours: 2, blocks: 0, roomId: null },
    ], timetable: [],
  };
  assert.equal(validate(data).filter((i) => i.level === "error").length, 0);
  for (let seed = 1; seed <= 20; seed++) {
    const list = solved(data, seed);
    for (const classId of ["K", "L"]) {
      const mine = list.filter((a) => a.classId === classId);
      assert.equal(mine.filter((a) => a.subject === "Airport").length, 1);
      assert.equal(new Set(mine.filter((a) => a.subject === "Homeroom").map((a) => a.day)).size, 2);
    }
  }
});

await check("강사 시간표용 프로그램명 별도 표기", () => {
  const data: AppData = {
    ...defaultData(), days: ["월"], fixedActivities: [],
    slots: generateSlots({ ...DEFAULT_GEN, periodCount: 2, lunchAfter: 0 }),
    classes: [{ id: "K", name: "D반" }], rooms: [{ id: "R", name: "컬처룸" }],
    teachers: [{ id: "T", name: "정하늘", unavailable: [] }],
    courses: [{ id: "c", teacherId: "T", subject: "Adventure", teacherSubject: "Adventure ①", classIds: ["K"], hours: 1, blocks: 0, roomId: "R" }],
    timetable: [],
  };
  const list = solved(data, 1);
  assert.equal(list[0].teacherSubject, "Adventure ①");
  const g = buildGrids(data, list);
  const cls = g.byClass.get("K")![list[0].period][0];
  const tea = g.byTeacher.get("T")![list[0].period][0];
  const room = g.byRoom.get("R")![list[0].period][0];
  assert(cls && cls !== "cont" && cls.top === "Adventure");
  assert(tea && tea !== "cont" && tea.bottom!.includes("Adventure ①"));
  assert(room && room !== "cont" && room.bottom!.includes("Adventure") && !room.bottom!.includes("①"));
});

await check("고정 활동 체험존은 그 존 시간표에도 나타남", () => {
  const data: AppData = {
    ...defaultData(), days: ["월"],
    slots: generateSlots({ ...DEFAULT_GEN, periodCount: 3, lunchAfter: 0 }),
    classes: [{ id: "K", name: "D반" }], rooms: [{ id: "HALL", name: "강당" }, { id: "R2", name: "컬처룸" }],
    teachers: [], courses: [], timetable: [],
    fixedActivities: [
      { id: "f", name: "Orientation", cells: ["0:0"], roomId: "HALL" },
      { id: "f2", name: "Closing", cells: ["0:2"] },
    ],
  };
  const g = buildGrids(data, []);
  const hall = g.byRoom.get("HALL")![0][0];
  assert(hall && hall !== "cont" && hall.fixed && hall.top === "Orientation");
  // 존을 지정하지 않은 고정 활동은 어느 존 표에도 들어가지 않는다.
  assert.equal(g.byRoom.get("R2")![2][0], null);
  assert.equal(g.byRoom.get("HALL")![2][0], null);
});

await check("구간에 모든 운영 요일을 넣어도 하루 1회로 그대로 배치됨", () => {
  // 신고된 증상: 구간에 요일을 전부 고르면 시간표가 반영되지 않았다.
  // 원인은 구간 전체가 한 묶음이 되어 같은 프로그램이 주 1회로 묶인 것.
  const days = ["월", "화", "수", "목", "금"];
  const make = (segDays: number[] | null): AppData => ({
    ...defaultData(), days, fixedActivities: [],
    slots: generateSlots({ ...DEFAULT_GEN, periodCount: 2, lunchAfter: 0 }),
    classes: [{ id: "K", name: "A반", segmentId: segDays ? "all" : null }],
    segments: segDays ? [{ id: "all", name: "전체 등원", days: segDays }] : [],
    teachers: [{ id: "T1", name: "김선생", unavailable: [] }],
    rooms: [],
    courses: [
      { id: "c", teacherId: "T1", subject: "Homeroom", classIds: ["K"], hours: 4, blocks: 0, roomId: null },
    ],
    timetable: [],
  });

  const withAll = make([0, 1, 2, 3, 4]);
  assert.deepEqual(allowedDaysOf(withAll, withAll.classes[0]), [0, 1, 2, 3, 4]);
  assert.equal(comboLimitOf(withAll, withAll.classes[0], false), 5);
  assert.equal(validate(withAll).filter((i) => i.level === "error").length, 0);

  // 구간을 둔 쪽과 두지 않은 쪽이 똑같이 4시간을 서로 다른 날에 넣는다.
  for (const data of [withAll, make(null)]) {
    for (let seed = 1; seed <= 10; seed++) {
      const list = solved(data, seed);
      assert.equal(list.length, 4);
      assert.equal(new Set(list.map((a) => a.day)).size, 4);
    }
  }

  // [구간당 1회]를 켜야만 주 1회로 묶인다.
  const once: AppData = { ...withAll, courses: [{ ...withAll.courses[0], hours: 1, oncePerSegment: true }] };
  assert.equal(comboLimitOf(once, once.classes[0], true), 1);
});

await check("프로그램을 특정 요일에 못 박기 (Science 1 은 월, Science 2 는 화)", () => {
  const data: AppData = {
    ...defaultData(), days: ["월", "화", "수"], fixedActivities: [],
    slots: generateSlots({ ...DEFAULT_GEN, periodCount: 3, lunchAfter: 0 }),
    classes: [{ id: "K", name: "A반" }],
    segments: [],
    teachers: [{ id: "T1", name: "김선생", unavailable: [] }],
    rooms: [],
    courses: [
      // 2시수를 하루에 못 박으려면 연속 2교시(블록)여야 한다 — 하루 1회 규칙과 어긋나지 않게.
      { id: "s1", teacherId: "T1", subject: "Science 1", classIds: ["K"], hours: 2, blocks: 1, roomId: null, days: [0] },
      { id: "s2", teacherId: "T1", subject: "Science 2", classIds: ["K"], hours: 1, blocks: 0, roomId: null, days: [1] },
      { id: "f", teacherId: "T1", subject: "Free", classIds: ["K"], hours: 1, blocks: 0, roomId: null },
    ],
    timetable: [],
  };
  assert.equal(validate(data).filter((i) => i.level === "error").length, 0);

  for (let seed = 1; seed <= 20; seed++) {
    const list = solved(data, seed);
    assert.equal(list.reduce((n, a) => n + a.length, 0), 4);
    // Science 1 은 월요일 연속 2교시 한 덩어리로만 들어간다.
    const s1 = list.filter((a) => a.subject === "Science 1");
    assert.equal(s1.length, 1);
    assert.equal(s1[0].day, 0);
    assert.equal(s1[0].length, 2);
    const s2 = list.filter((a) => a.subject === "Science 2");
    assert.equal(s2.length, 1);
    assert.equal(s2[0].day, 1);
  }

  // 지정 요일이 그 반의 등원일이 아니면 미리 막는다.
  const offDay: AppData = {
    ...data,
    classes: [{ id: "K", name: "A반", segmentId: "seg" }],
    segments: [{ id: "seg", name: "화수", days: [1, 2] }],
  };
  assert(validate(offDay).some((i) => i.level === "error" && i.text.includes("그 요일에 오지 않습니다")));
});

await check("체험반 기본 이름은 TEAM A 형식", () => {
  assert.deepEqual(defaultData().classes.map((c) => c.name), ["TEAM A", "TEAM B", "TEAM C", "TEAM D"]);
  assert(sampleData().classes.every((c) => /^TEAM [A-F]$/.test(c.name)));
});

await check("프로그램-체험존 묶음: 이름만 정하면 존이 따라온다", () => {
  const data = sampleData();
  const studio = data.rooms.find((r) => r.name === "미디어 스튜디오")!.id;
  assert.equal(programRoomOf(data, "Media Studio"), studio);
  // 대소문자와 앞뒤 공백은 무시한다.
  assert.equal(programRoomOf(data, "  media studio "), studio);
  // 묶음에 없는 이름은 존을 정하지 않는다 (손으로 고른 값을 건드리지 않으려고).
  assert.equal(programRoomOf(data, "Homeroom English"), null);
  // 존이 지워지면 그 묶음도 무시된다.
  const gone = { ...data, rooms: data.rooms.filter((r) => r.id !== studio) };
  assert.equal(programRoomOf(gone, "Media Studio"), null);
});

await check("강사 격자에서 만든 칸이 그 강사의 반·프로그램으로 채워진다", () => {
  const data: AppData = {
    ...defaultData(), days: ["월", "화"], fixedActivities: [],
    slots: generateSlots({ ...DEFAULT_GEN, periodCount: 2, lunchAfter: 0 }),
    classes: [{ id: "K1", name: "TEAM A" }, { id: "K2", name: "TEAM B" }],
    rooms: [{ id: "R", name: "컬처룸" }],
    teachers: [{ id: "T", name: "정하늘", unavailable: [] }],
    courses: [{ id: "c", teacherId: "T", subject: "Adventure", classIds: ["K2"], hours: 1, blocks: 0, roomId: "R", hideTeacher: true }],
    timetable: [],
  };
  // 이 강사가 맡은 반(K2)을 고르고 프로그램·존·강사 숨김까지 물려받는다.
  const d1 = draftForOwner(data, [], "T", "teacher", 0, 0)!;
  assert.equal(d1.classId, "K2");
  assert.equal(d1.subject, "Adventure");
  assert.equal(d1.roomId, "R");
  assert.equal(d1.teacherId, "T");
  assert.equal(d1.hideTeacher, true);

  // 그 반이 이미 그 시간에 차 있으면 비어 있는 다른 반을 고른다.
  const busy = [newAssignment({ classId: "K2", day: 0, period: 0, subject: "X" })];
  assert.equal(draftForOwner(data, busy, "T", "teacher", 0, 0)!.classId, "K1");

  // 모든 반이 차 있으면 만들지 않는다 (엉뚱한 반에 얹지 않으려고).
  const full = [...busy, newAssignment({ classId: "K1", day: 0, period: 0, subject: "Y" })];
  assert.equal(draftForOwner(data, full, "T", "teacher", 0, 0), null);

  // 배정에 존이 없으면 프로그램-체험존 묶음에서 가져온다.
  const linked: AppData = { ...data, courses: [{ ...data.courses[0], roomId: null }], programRooms: [{ subject: "adventure", roomId: "R" }] };
  assert.equal(draftForOwner(linked, [], "T", "teacher", 0, 0)!.roomId, "R");
});

await check("합본 시간표: 구간이 다른 두 반을 한 장으로", () => {
  const data: AppData = {
    ...defaultData(), days: ["월", "화", "수"], fixedActivities: [],
    slots: generateSlots({ ...DEFAULT_GEN, periodCount: 1, lunchAfter: 0 }),
    segments: [{ id: "lo", name: "LOW(3학년)", days: [0, 1] }, { id: "hi", name: "HIGH(5학년)", days: [2] }],
    classes: [{ id: "A", name: "TEAM A", segmentId: "lo" }, { id: "C", name: "TEAM C", segmentId: "hi" }],
    classGroups: [{ id: "g", name: "TEAM A+C", classIds: ["A", "C"] }],
    rooms: [], teachers: [{ id: "T", name: "T", unavailable: [] }], courses: [],
    timetable: [
      newAssignment({ classId: "A", teacherId: "T", subject: "월수업", day: 0, period: 0 }),
      newAssignment({ classId: "C", teacherId: "T", subject: "수수업", day: 2, period: 0 }),
    ],
  };
  const grids = buildGrids(data, data.timetable);
  const { grid, bands, overlap } = mergedGrid(data, grids, ["A", "C"], [0, 1, 2]);
  assert.equal(overlap, false);
  // 월·화는 TEAM A 의 칸, 수요일은 TEAM C 의 칸이 온다.
  assert.equal((grid[0][0] as { top: string }).top, "월수업");
  assert.equal(grid[0][1], null);
  assert.equal((grid[0][2] as { top: string }).top, "수수업");
  // 표 위 머리는 구간 이름으로 묶인다.
  assert.deepEqual(bands, [{ label: "LOW(3학년)", span: 2 }, { label: "HIGH(5학년)", span: 1 }]);

  // 엑셀에도 그 머리줄이 병합되어 들어간다.
  const sheet = toSheet({ sheetName: "합본", title: "TEAM A+C", days: ["월", "화", "수"], slots: data.slots, grid, bands });
  assert.equal(sheet.rows[1][1]?.text, "LOW(3학년)");
  assert(sheet.merges.some((m) => m.r1 === 1 && m.c1 === 1 && m.c2 === 2));

  // 요일이 겹치면 먼저 고른 반이 이기고 그 사실을 알린다.
  const sameSeg = { ...data, classes: data.classes.map((c) => ({ ...c, segmentId: "lo" })) };
  assert.equal(mergedGrid(sameSeg, grids, ["A", "C"], [0, 1]).overlap, true);
});

await check("강사를 비워 둔 배정도 자리를 잡는다 (나중에 손으로 채움)", () => {
  const data: AppData = {
    ...defaultData(), days: ["월", "화"], fixedActivities: [],
    slots: generateSlots({ ...DEFAULT_GEN, periodCount: 2, lunchAfter: 0 }),
    classes: [{ id: "K", name: "TEAM A" }], rooms: [], segments: [],
    teachers: [{ id: "T", name: "정하늘", unavailable: [] }],
    courses: [
      // Adventure 는 담당이 매주 바뀌어 지금은 비워 둔다.
      { id: "adv", teacherId: "", subject: "Adventure", classIds: ["K"], hours: 2, blocks: 0, roomId: null },
      { id: "hr", teacherId: "T", subject: "Homeroom", classIds: ["K"], hours: 2, blocks: 0, roomId: null },
    ],
    timetable: [],
  };
  // 예전에는 강사가 없는 배정을 통째로 건너뛰어 시수조차 세지 않았다.
  const lectures = buildLectures(data);
  assert.equal(lectures.length, 2);
  assert.equal(lectures.find((l) => l.subject === "Adventure")!.teacherId, "");
  assert.equal(validate(data).filter((i) => i.level === "error").length, 0);

  for (let seed = 1; seed <= 5; seed++) {
    const list = solved(data, seed);
    assert.equal(list.reduce((n, a) => n + a.length, 0), 4);
    const adv = list.filter((a) => a.subject === "Adventure");
    assert.equal(adv.length, 2);
    // 강사 칸은 비어 있고, 어느 강사의 시간도 잡아먹지 않는다.
    assert(adv.every((a) => a.teacherId === null));
    const grids = buildGrids(data, list);
    const mine = grids.byTeacher.get("T")!.flat().filter((c) => c && c !== "cont");
    assert.equal(mine.length, 2);   // Homeroom 두 칸만
  }

  // 미지정 칸이 같은 교시에 둘 있어도 강사 겹침으로 잡지 않는다.
  const two = [
    newAssignment({ classId: "K", subject: "Adventure", day: 0, period: 0 }),
    newAssignment({ classId: "K2", subject: "Adventure", day: 0, period: 0 }),
  ];
  const twoClasses = { ...data, classes: [...data.classes, { id: "K2", name: "TEAM B" }] };
  assert.equal(conflictsOf(twoClasses, two).filter((c) => c.kind === "teacher").length, 0);
});

await check("두 강사가 한 프로그램을 같은 칸에서 함께 맡는다", () => {
  const data: AppData = {
    ...defaultData(), days: ["월", "화"], fixedActivities: [],
    slots: generateSlots({ ...DEFAULT_GEN, periodCount: 2, lunchAfter: 0 }),
    classes: [{ id: "K", name: "TEAM A" }], rooms: [{ id: "R", name: "컬처룸" }], segments: [],
    teachers: [
      { id: "T1", name: "정하늘", unavailable: [] },
      { id: "T2", name: "박세계", unavailable: [] },
      { id: "T3", name: "김지영", unavailable: [] },
    ],
    courses: [
      { id: "adv", teacherId: "T1", coTeacherIds: ["T2"], subject: "Adventure", classIds: ["K"], hours: 1, blocks: 0, roomId: "R" },
      { id: "hr", teacherId: "T3", subject: "Homeroom", classIds: ["K"], hours: 2, blocks: 0, roomId: null },
    ],
    timetable: [],
  };
  const lec = buildLectures(data).find((l) => l.subject === "Adventure")!;
  assert.deepEqual(lec.coTeacherIds, ["T2"]);
  // 함께 들어가는 강사도 그 시간을 쓰므로 시수에 잡힌다.
  assert.equal(validate(data).filter((i) => i.level === "error").length, 0);

  for (let seed = 1; seed <= 5; seed++) {
    const list = solved(data, seed);
    const adv = list.find((a) => a.subject === "Adventure")!;
    assert.equal(adv.teacherId, "T1");
    assert.deepEqual(adv.coTeacherIds, ["T2"]);
    // 한 칸이 두 강사의 표에 동시에 나타난다 — 같은 요일·교시로.
    const grids = buildGrids(data, list);
    const cell1 = grids.byTeacher.get("T1")![adv.period][adv.day];
    const cell2 = grids.byTeacher.get("T2")![adv.period][adv.day];
    assert(cell1 && cell1 !== "cont" && cell2 && cell2 !== "cont");
    assert.equal(cell1.top, "TEAM A");
    assert.equal(cell2.top, "TEAM A");
    // 체험반 표에는 두 이름이 함께 적힌다.
    const klass = grids.byClass.get("K")![adv.period][adv.day];
    assert(klass && klass !== "cont" && klass.bottom!.includes("정하늘") && klass.bottom!.includes("박세계"));
    // 함께 맡는 것은 겹침이 아니다.
    assert.deepEqual(conflictsOf(data, list), []);
  }

  // 함께 들어가는 강사가 그 시간에 다른 반을 맡고 있으면 겹침으로 잡는다.
  const clash = [
    newAssignment({ classId: "K", subject: "Adventure", teacherId: "T1", coTeacherIds: ["T2"], day: 0, period: 0 }),
    newAssignment({ classId: "K2", subject: "Other", teacherId: "T2", day: 0, period: 0 }),
  ];
  const withB = { ...data, classes: [...data.classes, { id: "K2", name: "TEAM B" }] };
  assert(conflictsOf(withB, clash).some((c) => c.kind === "teacher" && c.text.includes("박세계")));

  // 함께 들어가는 강사의 회피 시간도 지켜야 한다.
  const avoidData = { ...data, teachers: data.teachers.map((t) => (t.id === "T2" ? { ...t, unavailable: ["0:0"] } : t)) };
  const onAvoid = [newAssignment({ classId: "K", subject: "Adventure", teacherId: "T1", coTeacherIds: ["T2"], day: 0, period: 0 })];
  assert(conflictsOf(avoidData, onAvoid).some((c) => c.kind === "avoid" && c.text.includes("박세계")));
});

console.log(`\n${count}개 요구사항 회귀 검사 통과`);
