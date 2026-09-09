/**
 * 내보낸 파일을 다시 읽어 같은 시간표가 나오는지 확인한다.
 *   1) 목록형 CSV 왕복
 *   2) 체험반별 xlsx(세로 병합 포함) 왕복
 *   3) 로테이션이 규칙대로 강사를 미는지
 */
import type { AppData, Assignment } from "../src/types";
import { allowedDaysOf, classCapacity, DEFAULT_GEN, generateSlots, uid, weekCapacity } from "../src/store";
import { buildGrids, conflictsOf, newAssignment } from "../src/assignments";
import { applyImport, buildTemplate, importSheets, parseCsv, toTemplateRows } from "../src/importTimetable";
import { readXlsx } from "../src/xlsxRead";
import { toCsv } from "../src/export";
import { buildXlsx } from "../src/xlsx";
import { toSheet } from "../src/timetableSheet";
import { rotateAssignments, rotationPlan } from "../src/rotation";

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

/** ── 시험용 데이터 ───────────────────────────────────── */

const classes = ["A반", "B반"].map((name) => ({ id: uid("k"), name }));
const rooms = ["공항·출입국존", "레스토랑존"].map((name) => ({ id: uid("r"), name }));
const teachers = ["Emma Clark", "김지영", "한도윤"].map((name) => ({
  id: uid("t"),
  name,
  unavailable: [] as string[],
}));

const data: AppData = {
  version: 3,
  schoolName: "○○영어체험센터",
  days: ["월", "화", "수", "목", "금"],
  slots: generateSlots(DEFAULT_GEN),
  fixedActivities: [],
  segments: [],
  classes,
  rooms,
  teachers,
  courses: [],
  timetable: [],
  rotation: {
    groups: [{ id: uid("g"), name: "존 담당", teacherIds: teachers.map((t) => t.id) }],
    turns: 0,
    log: [],
  },
};

const timetable: Assignment[] = [
  newAssignment({
    classId: classes[0].id,
    teacherId: teachers[0].id,
    roomId: rooms[0].id,
    subject: "Airport & Immigration",
    day: 0,
    period: 0,
    length: 2,
  }),
  newAssignment({
    classId: classes[0].id,
    teacherId: teachers[1].id,
    roomId: null,
    subject: "Homeroom English",
    day: 0,
    period: 2,
    length: 1,
  }),
  // 점심 뒤 5·6교시 블록
  newAssignment({
    classId: classes[1].id,
    teacherId: teachers[2].id,
    roomId: rooms[1].id,
    subject: "Project Time",
    day: 3,
    period: 4,
    length: 2,
  }),
  // 강사 없이 존만 적힌 칸
  newAssignment({
    classId: classes[1].id,
    teacherId: null,
    roomId: rooms[0].id,
    subject: "Free Talking",
    day: 1,
    period: 1,
    length: 1,
  }),
];
data.timetable = timetable;

const className = new Map(classes.map((c) => [c.id, c.name]));
const teacherName = new Map(teachers.map((t) => [t.id, t.name]));
const roomName = new Map(rooms.map((r) => [r.id, r.name]));

/** 비교용 지문 — id 가 아니라 사람이 읽는 값으로 맞춰 본다. */
const fingerprint = (list: Assignment[]) =>
  list
    .map((a) =>
      [
        className.get(a.classId) ?? "?",
        a.day,
        a.period,
        a.length,
        a.subject,
        a.teacherId ? (teacherName.get(a.teacherId) ?? "?") : "-",
        a.roomId ? (roomName.get(a.roomId) ?? "?") : "-",
      ].join("|"),
    )
    .sort()
    .join("\n");

const want = fingerprint(timetable);

check("기준 시간표에 충돌 없음", conflictsOf(data, timetable).length === 0);

/** ── 1) 목록형 CSV 왕복 ──────────────────────────────── */

const csv = toCsv(toTemplateRows(data, timetable));
const fromCsv = importSheets(data, [{ name: "시간표", rows: parseCsv(csv), merges: [] }]);
check(
  "목록형 CSV 왕복",
  fingerprint(fromCsv.assignments) === want,
  `${fromCsv.assignments.length}칸`,
);
check(
  "목록형: 새로 만든 항목 없음",
  fromCsv.newClasses.length + fromCsv.newTeachers.length + fromCsv.newRooms.length === 0,
);
if (fingerprint(fromCsv.assignments) !== want) {
  console.log("--- 기대\n" + want + "\n--- 실제\n" + fingerprint(fromCsv.assignments));
}

/** ── 2) 체험반별 xlsx 왕복 ───────────────────────────── */

const grids = buildGrids(data, timetable);
const blob = buildXlsx(
  classes.map((c) =>
    toSheet({
      sheetName: c.name,
      title: `${data.schoolName} ${c.name} 시간표`,
      days: data.days,
      slots: data.slots,
      grid: grids.byClass.get(c.id) ?? [],
    }),
  ),
);
const sheets = await readXlsx(await blob.arrayBuffer());
check("xlsx 시트 수", sheets.length === classes.length, `${sheets.length}장`);

const fromXlsx = importSheets(data, sheets);
check("시간표형 xlsx 왕복", fingerprint(fromXlsx.assignments) === want, `${fromXlsx.assignments.length}칸`);
check(
  "시간표형: 새로 만든 항목 없음",
  fromXlsx.newClasses.length + fromXlsx.newTeachers.length + fromXlsx.newRooms.length === 0,
);
check(
  "시간표형: 연속 2교시가 병합에서 복원됨",
  fromXlsx.assignments.filter((a) => a.length === 2).length === 2,
);
if (fingerprint(fromXlsx.assignments) !== want) {
  console.log("--- 기대\n" + want + "\n--- 실제\n" + fingerprint(fromXlsx.assignments));
}

/** ── 3) 업로드 양식이 스스로 읽히는지 ────────────────── */

const templateSheets = await readXlsx(await buildTemplate(data).arrayBuffer());
const fromTemplate = importSheets(data, templateSheets);
check("양식 파일이 그대로 읽힌다", fromTemplate.assignments.length === 3, `${fromTemplate.assignments.length}칸`);
check(
  "양식의 '블록' 두 줄이 연속 2교시로 되붙는다",
  fromTemplate.assignments.some((a) => a.length === 2),
);
check(
  "양식의 '숨김' 표시를 읽는다",
  fromTemplate.assignments.some((a) => a.hideTeacher === true),
);

/** ── 4) 겹침을 잡아내는지 ────────────────────────────── */

const clash = newAssignment({
  classId: classes[0].id,
  teacherId: teachers[0].id,
  roomId: rooms[0].id,
  subject: "겹치는 수업",
  day: 0,
  period: 1,
  length: 1,
});
const kinds = new Set(conflictsOf(data, [...timetable, clash]).map((c) => c.kind));
check("체험반 겹침을 잡는다", kinds.has("class"));
check("강사 겹침을 잡는다", kinds.has("teacher"));
check("체험존 겹침을 잡는다", kinds.has("room"));

const avoidData: AppData = {
  ...data,
  teachers: data.teachers.map((t) => (t.id === teachers[1].id ? { ...t, unavailable: ["0:2"] } : t)),
};
check(
  "강사 회피 시간을 잡는다",
  conflictsOf(avoidData, timetable).some((c) => c.kind === "avoid"),
);

const badBlock = newAssignment({
  classId: classes[0].id,
  subject: "점심을 넘는 블록",
  day: 2,
  period: 3,
  length: 2,
});
check(
  "점심을 넘는 연속 2교시를 잡는다",
  conflictsOf(data, [badBlock]).some((c) => c.kind === "range"),
);

/** ── 5) 합치기·덮어쓰기 ──────────────────────────────── */

const merged = applyImport(data, fromCsv, "merge");
check("합치기: 같은 자리는 올린 쪽이 이긴다", merged.timetable.length === timetable.length, `${merged.timetable.length}칸`);
const replaced = applyImport(data, fromCsv, "replace");
check("덮어쓰기: 올린 것만 남는다", replaced.timetable.length === fromCsv.assignments.length);

/** ── 6) 로테이션 ─────────────────────────────────────── */

const group = data.rotation.groups[0];
const plan1 = rotationPlan(group, 1).map((p) => `${teacherName.get(p.teacherId)}→${teacherName.get(p.sourceId)}`);
check(
  "1회차: 각자 다음 사람 시간표를 맡는다",
  plan1.join(", ") === "Emma Clark→김지영, 김지영→한도윤, 한도윤→Emma Clark",
  plan1.join(", "),
);

const rotated = rotateAssignments(timetable, data.rotation.groups, 1);
const emmaCell = timetable.find((a) => a.teacherId === teachers[0].id)!;
const movedTo = rotated.find((a) => a.id === emmaCell.id)!;
check(
  "Emma 의 칸은 한도윤에게 넘어간다",
  movedTo.teacherId === teachers[2].id,
  teacherName.get(movedTo.teacherId ?? "") ?? "-",
);
check(
  "로테이션은 자리를 건드리지 않는다",
  rotated.every((a, i) => a.day === timetable[i].day && a.period === timetable[i].period && a.length === timetable[i].length),
);
check(
  "한 바퀴 돌면 제자리",
  fingerprint(rotateAssignments(timetable, data.rotation.groups, teachers.length)) === want,
);

/** ── 7) 고정 활동 (Orientation·Closing) ──────────────── */

const fixedData: AppData = {
  ...data,
  fixedActivities: [
    { id: uid("f"), name: "Orientation", cells: ["0:0", "2:0"] },
    { id: uid("f"), name: "Closing", cells: ["1:5", "4:5"] },
  ],
};

check(
  "고정 활동 칸에 놓인 수업을 잡는다",
  conflictsOf(fixedData, timetable).some((c) => c.kind === "fixed"),
);
check(
  "고정 활동은 주당 칸 수에서 빠진다",
  weekCapacity(fixedData) === weekCapacity(data) - 4,
  `${weekCapacity(fixedData)} vs ${weekCapacity(data)}`,
);

const fixedGrid = buildGrids(fixedData, []).byClass.get(classes[0].id) ?? [];
const oriCell = fixedGrid[0]?.[0];
check(
  "체험반 격자에 고정 활동이 그려진다",
  Boolean(oriCell && oriCell !== "cont" && oriCell.fixed && oriCell.top === "Orientation"),
);
const teacherFixedGrid = buildGrids(fixedData, []).byTeacher.get(teachers[0].id) ?? [];
const teacherOri = teacherFixedGrid[0]?.[0];
check(
  "강사 격자에도 고정 활동이 그려진다",
  Boolean(teacherOri && teacherOri !== "cont" && teacherOri.fixed),
);

// 고정 활동이 든 격자를 내보냈다가 되읽어도 Orientation 이 수업으로 들어오면 안 된다.
const fixedSheets = await readXlsx(
  await buildXlsx([
    toSheet({
      sheetName: classes[0].name,
      title: "고정 활동 왕복",
      days: fixedData.days,
      slots: fixedData.slots,
      grid: fixedGrid,
    }),
  ]).arrayBuffer(),
);
const backFromFixed = importSheets(fixedData, fixedSheets);
check(
  "격자를 되읽어도 고정 활동은 수업이 되지 않는다",
  backFromFixed.assignments.length === 0,
  `${backFromFixed.assignments.length}칸`,
);

/** ── 8) 운영 구간 (월·화 / 수·목·금) ─────────────────── */

const segEarly = { id: uid("sg"), name: "월·화", days: [0, 1] };
const segLate = { id: uid("sg"), name: "수·목·금", days: [2, 3, 4] };
const segData: AppData = {
  ...data,
  segments: [segEarly, segLate],
  classes: [
    { ...classes[0], segmentId: segEarly.id },
    { ...classes[1], segmentId: segLate.id },
  ],
};

check(
  "구간이 오는 요일을 정한다",
  allowedDaysOf(segData, segData.classes[0]).join(",") === "0,1" &&
    allowedDaysOf(segData, segData.classes[1]).join(",") === "2,3,4",
);
check(
  "구간에 따라 쓸 수 있는 칸 수가 달라진다",
  classCapacity(segData, segData.classes[0]) === 12 && classCapacity(segData, segData.classes[1]) === 18,
  `${classCapacity(segData, segData.classes[0])} / ${classCapacity(segData, segData.classes[1])}`,
);

// A반은 월·화만 오는데 목요일에 놓으면 잡아야 한다.
const outOfSegment = newAssignment({
  classId: classes[0].id,
  subject: "구간 밖 수업",
  day: 3,
  period: 0,
  length: 1,
});
check(
  "구간 밖 요일에 놓인 수업을 잡는다",
  conflictsOf(segData, [outOfSegment]).some((c) => c.kind === "segment"),
);

/** ── 9) 강사 숨김 (매주 담당이 바뀌는 수업) ──────────── */

const hidden = newAssignment({
  classId: classes[1].id,
  teacherId: teachers[2].id,
  roomId: rooms[1].id,
  subject: "Adventure",
  day: 4,
  period: 2,
  length: 1,
  hideTeacher: true,
});
const hiddenGrids = buildGrids(data, [hidden]);
const hiddenClassCell = hiddenGrids.byClass.get(classes[1].id)?.[2]?.[4];
const hiddenTeacherCell = hiddenGrids.byTeacher.get(teachers[2].id)?.[2]?.[4];
const classBottom =
  hiddenClassCell && hiddenClassCell !== "cont" ? (hiddenClassCell.bottom ?? "") : "";
check("체험반 시간표에는 강사가 나오지 않는다", !classBottom.includes("한도윤"), classBottom || "(빈칸)");
check("그래도 체험존은 그대로 적힌다", classBottom.includes("레스토랑존"));
check(
  "강사 개인 시간표에는 그 수업이 들어간다",
  Boolean(
    hiddenTeacherCell &&
      hiddenTeacherCell !== "cont" &&
      (hiddenTeacherCell.bottom ?? "").includes("Adventure"),
  ),
);

const hiddenCsv = toCsv(toTemplateRows(data, [hidden]));
const hiddenBack = importSheets(data, [{ name: "시간표", rows: parseCsv(hiddenCsv), merges: [] }]);
check(
  "목록형 왕복에서 강사 숨김이 유지된다",
  hiddenBack.assignments.length === 1 &&
    hiddenBack.assignments[0].hideTeacher === true &&
    hiddenBack.assignments[0].teacherId === teachers[2].id,
);

/** ── 10) 로테이션을 실제로 돌리기 ────────────────────── */

let live = timetable;
let turns = 0;
for (let i = 0; i < teachers.length; i++) {
  live = rotateAssignments(live, data.rotation.groups, 1);
  turns += 1;
}
check("한 바퀴만큼 돌리면 처음으로 돌아온다", fingerprint(live) === want, `${turns}번`);

live = rotateAssignments(timetable, data.rotation.groups, 1);
check(
  "한 칸 되돌리면 원래대로",
  fingerprint(rotateAssignments(live, data.rotation.groups, -1)) === want,
);

console.log(failed === 0 ? "\n전부 통과" : `\n${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
