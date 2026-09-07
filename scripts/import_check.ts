/**
 * 내보낸 파일을 다시 읽어 같은 시간표가 나오는지 확인한다.
 *   1) 목록형 CSV 왕복
 *   2) 체험반별 xlsx(세로 병합 포함) 왕복
 *   3) 로테이션이 규칙대로 강사를 미는지
 */
import type { AppData, Assignment } from "../src/types";
import { DEFAULT_GEN, generateSlots, uid } from "../src/store";
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
  version: 2,
  schoolName: "○○영어체험센터",
  days: ["월", "화", "수", "목", "금"],
  slots: generateSlots(DEFAULT_GEN),
  classes,
  rooms,
  teachers,
  courses: [],
  timetable: [],
  rotation: {
    groups: [{ id: uid("g"), name: "존 담당", teacherIds: teachers.map((t) => t.id) }],
    rounds: [],
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
check("양식 파일이 그대로 읽힌다", fromTemplate.assignments.length === 2, `${fromTemplate.assignments.length}칸`);
check(
  "양식의 '블록' 두 줄이 연속 2교시로 되붙는다",
  fromTemplate.assignments.some((a) => a.length === 2),
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

console.log(failed === 0 ? "\n전부 통과" : `\n${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
