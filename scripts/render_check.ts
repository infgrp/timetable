/**
 * 화면이 실제로 그려지는지만 본다 (브라우저 없이 서버 렌더링으로).
 * 배치·편집·로테이션 화면이 한 번씩 그려지면 통과.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { AppData, Assignment } from "../src/types";
import { DEFAULT_GEN, generateSlots, uid } from "../src/store";
import { buildGrids, newAssignment } from "../src/assignments";
import ResultPanel from "../src/components/ResultPanel";
import RotationPanel from "../src/components/RotationPanel";
import AssignmentEditor from "../src/components/AssignmentEditor";
import Timetable from "../src/components/Timetable";

let failed = 0;
function check(label: string, fn: () => string, mustInclude: string[] = []) {
  try {
    const html = fn();
    const missing = mustInclude.filter((s) => !html.includes(s));
    if (missing.length > 0) {
      console.log(` FAIL  ${label} — 화면에 없음: ${missing.join(", ")}`);
      failed += 1;
      return;
    }
    console.log(`  ok   ${label} — ${html.length}자`);
  } catch (e) {
    console.log(` FAIL  ${label} — ${e instanceof Error ? e.message : String(e)}`);
    failed += 1;
  }
}

const classes = ["A반", "B반"].map((name) => ({ id: uid("k"), name }));
const rooms = [{ id: uid("r"), name: "공항·출입국존" }];
const teachers = ["Emma Clark", "김지영", "한도윤"].map((name) => ({
  id: uid("t"),
  name,
  unavailable: [] as string[],
}));

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
  // 일부러 겹치게 둔다 — 충돌 목록이 그려지는지 보려고
  newAssignment({
    classId: classes[0].id,
    teacherId: teachers[0].id,
    roomId: rooms[0].id,
    subject: "겹치는 수업",
    day: 0,
    period: 1,
    length: 1,
  }),
];

const data: AppData = {
  version: 2,
  schoolName: "○○영어체험센터",
  days: ["월", "화", "수", "목", "금"],
  slots: generateSlots(DEFAULT_GEN),
  classes,
  rooms,
  teachers,
  courses: [],
  timetable,
  rotation: {
    groups: [{ id: uid("g"), name: "존 담당", teacherIds: teachers.map((t) => t.id) }],
    rounds: [
      { id: uid("rd"), name: "3월", step: 0 },
      { id: uid("rd"), name: "4월", step: 1 },
    ],
  },
};

const noop = () => {};

check("시간표 탭 (시간표 있음 · 충돌 있음)", () =>
  renderToString(createElement(ResultPanel, { data, set: noop })),
  // & 는 HTML 로 나가면서 &amp; 가 되므로 그 앞부분만 본다.
  ["시간표 배치", "엑셀로 이미 짜인 시간표 올리기", "겹치는 곳", "로테이션 회차", "Immigration"],
);

check("시간표 탭 (아직 아무것도 없음)", () =>
  renderToString(createElement(ResultPanel, { data: { ...data, timetable: [] }, set: noop })),
  ["빈 시간표에 직접 입력"],
);

check("로테이션 탭", () => renderToString(createElement(RotationPanel, { data, set: noop })), [
  "강사 로테이션",
  "회차별 담당",
  "3월",
  "4월",
  "김지영",
]);

check("칸 편집 폼", () =>
  renderToString(
    createElement(AssignmentEditor, {
      data,
      value: timetable[0],
      onChange: noop,
      onDelete: noop,
      onClose: noop,
    }),
  ),
  ["칸 편집", "연속 2교시"],
);

check("편집 모드 격자", () => {
  const grid = buildGrids(data, timetable, new Set([timetable[1].id])).byClass.get(classes[0].id) ?? [];
  return renderToString(
    createElement(Timetable, {
      title: "A반",
      days: data.days,
      slots: data.slots,
      grid,
      edit: { selectedId: null, onPick: noop, onAddAt: noop, onMove: noop },
    }),
  );
}, ["draggable", "점심시간"]);

console.log(failed === 0 ? "\n전부 통과" : `\n${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
