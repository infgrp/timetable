/**
 * 화면이 실제로 그려지는지만 본다 (브라우저 없이 서버 렌더링으로).
 * 보기·구성·편집·로테이션 화면이 한 번씩 그려지면 통과.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { AppData, Assignment } from "../src/types";
import { DEFAULT_GEN, generateSlots, uid } from "../src/store";
import { buildGrids, newAssignment } from "../src/assignments";
import ResultPanel from "../src/components/ResultPanel";
import RotationPanel from "../src/components/RotationPanel";
import ViewerPanel from "../src/components/ViewerPanel";
import AssignmentEditor from "../src/components/AssignmentEditor";
import FixedActivitiesCard from "../src/components/FixedActivitiesCard";
import ClassesPanel from "../src/components/ClassesPanel";
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

const segEarly = { id: uid("sg"), name: "월·화 (3학년)", days: [0, 1] };
const segLate = { id: uid("sg"), name: "수·목·금 (4학년)", days: [2, 3, 4] };

const classes = [
  { id: uid("k"), name: "A반", segmentId: segEarly.id },
  { id: uid("k"), name: "D반", segmentId: segLate.id },
];
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
    period: 1,
    length: 2,
  }),
  // 일부러 겹치게 둔다 — 충돌 목록이 그려지는지 보려고
  newAssignment({
    classId: classes[0].id,
    teacherId: teachers[0].id,
    roomId: rooms[0].id,
    subject: "겹치는 수업",
    day: 0,
    period: 2,
    length: 1,
  }),
  // 매주 담당이 바뀌는 수업
  newAssignment({
    classId: classes[1].id,
    teacherId: teachers[2].id,
    roomId: null,
    subject: "Adventure",
    day: 2,
    period: 1,
    length: 1,
    hideTeacher: true,
  }),
];

const data: AppData = {
  version: 3,
  schoolName: "○○영어체험센터",
  days: ["월", "화", "수", "목", "금"],
  slots: generateSlots(DEFAULT_GEN),
  fixedActivities: [
    { id: uid("f"), name: "Orientation", cells: ["0:0", "2:0"] },
    { id: uid("f"), name: "Closing", cells: ["1:5", "4:5"] },
  ],
  segments: [segEarly, segLate],
  classes,
  rooms,
  teachers,
  courses: [],
  timetable,
  rotation: {
    groups: [{ id: uid("g"), name: "존 담당", teacherIds: teachers.map((t) => t.id) }],
    turns: 2,
    log: [{ id: uid("rt"), at: "2026-09-01T09:00:00.000Z", turns: 2, note: "10월부터" }],
  },
};

const noop = () => {};

check(
  "시간표 보기 (메인)",
  () => renderToString(createElement(ViewerPanel, { data, onBuild: noop })),
  // 숫자는 SSR 이 텍스트 노드를 쪼개므로 붙어 있는 말만 본다.
  ["Immigration", "Orientation", "월·화 (3학년)", "적용된 시간표입니다"],
);

check(
  "시간표 보기 (아직 아무것도 없음)",
  () => renderToString(createElement(ViewerPanel, { data: { ...data, timetable: [] }, onBuild: noop })),
  ["아직 시간표가 없습니다"],
);

check(
  "시간표 짜기 (충돌 있음)",
  () => renderToString(createElement(ResultPanel, { data, set: noop })),
  ["시간표 배치", "엑셀로 이미 짜인 시간표 올리기", "겹치는 곳", "보이는 구간", "Immigration"],
);

check(
  "로테이션 탭",
  () => renderToString(createElement(RotationPanel, { data, set: noop })),
  ["로테이션 규칙", "다음으로 돌리기", "돌리면 이렇게 됩니다", "돌린 기록", "10월부터"],
);

check(
  "체험반·구간 탭",
  () => renderToString(createElement(ClassesPanel, { data, set: noop })),
  ["운영 구간", "체험반", "체험존"],
);

check(
  "고정 활동 편집기",
  () => renderToString(createElement(FixedActivitiesCard, { data, set: noop })),
  ["요일별 고정 활동", "Orientation"],
);

check(
  "칸 편집 폼 (강사 숨김)",
  () =>
    renderToString(
      createElement(AssignmentEditor, {
        data,
        value: timetable[2],
        onChange: noop,
        onDelete: noop,
        onClose: noop,
      }),
    ),
  ["칸 편집", "연속 2교시", "강사 숨기기"],
);

check(
  "편집 모드 격자",
  () => {
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
  },
  ["draggable", "점심시간", "Orientation"],
);

console.log(failed === 0 ? "\n전부 통과" : `\n${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
