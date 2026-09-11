import type { AppData, Klass } from "./types";
import { DEFAULT_GEN, generateSlots, uid } from "./store";

/**
 * 영어체험센터 예시 — 새로 들어온 기능이 한눈에 보이도록 짰다.
 *
 *   운영 구간   월·화에는 3학년 3반, 수·목·금에는 4학년 3반이 온다.
 *   고정 활동   월·수 1교시 Orientation, 화·금 6교시 Closing.
 *   강사 숨김   Adventure 는 매주 담당이 바뀌므로 체험반 시간표에 강사를 적지 않는다.
 *   로테이션    존을 맡은 원어민 6명이 한 조로 돈다.
 */
export function sampleData(): AppData {
  const days = ["월", "화", "수", "목", "금"];

  const segEarly = { id: uid("sg"), name: "월·화 (3학년)", days: [0, 1] };
  const segLate = { id: uid("sg"), name: "수·목·금 (4학년)", days: [2, 3, 4] };

  const classes: Klass[] = [
    ...["A", "B", "C"].map((n) => ({ id: uid("k"), name: `TEAM ${n}`, segmentId: segEarly.id })),
    ...["D", "E", "F"].map((n) => ({ id: uid("k"), name: `TEAM ${n}`, segmentId: segLate.id })),
  ];
  const earlyIds = classes.filter((c) => c.segmentId === segEarly.id).map((c) => c.id);
  const lateIds = classes.filter((c) => c.segmentId === segLate.id).map((c) => c.id);
  const allIds = classes.map((c) => c.id);

  const rooms = [
    "공항·출입국존",
    "레스토랑존",
    "마트·쇼핑존",
    "병원·클리닉존",
    "미디어 스튜디오",
    "컬처룸",
  ].map((name) => ({ id: uid("r"), name }));
  const zone = (name: string) => rooms.find((r) => r.name === name)!.id;

  // [강사, 프로그램, 담당 체험반, 반당 주당 시수, 연속 2교시 횟수, 체험존, 강사 숨김, 구간당 1회, 지정 요일]
  // 기본은 하루 1회. 존 체험처럼 "그 방문 동안 한 번"이어야 하는 것만 구간당 1회를 켠다.
  const spec: [string, string, string[], number, number, string | null, boolean, boolean, number[]][] = [
    ["Emma Clark", "Airport & Immigration", allIds, 1, 0, zone("공항·출입국존"), false, true, []],
    ["Jack Miller", "Restaurant & Ordering", allIds, 1, 0, zone("레스토랑존"), false, true, []],
    ["Olivia Brown", "Shopping & Money", allIds, 1, 0, zone("마트·쇼핑존"), false, true, []],
    ["Liam Davis", "Clinic & Health", allIds, 1, 0, zone("병원·클리닉존"), false, true, []],
    ["박세계", "World Culture", allIds, 1, 0, zone("컬처룸"), false, true, []],
    // 요일을 못 박은 프로그램 — Media Studio 는 월·화반이 월요일, 수·목·금반이 목요일에 한다.
    // (한 강사가 세 반을 맡으므로 그 요일 안에서 서로 다른 교시로 나뉜다.)
    ["Sophia Wilson", "Media Studio", earlyIds, 1, 0, zone("미디어 스튜디오"), false, true, [0]],
    ["Sophia Wilson", "Media Studio", lateIds, 1, 0, zone("미디어 스튜디오"), false, true, [3]],
    ["김지영", "Homeroom English", earlyIds, 2, 0, null, false, false, []],
    ["한도윤", "Project Time", earlyIds, 2, 1, null, false, false, []],
    ["이수민", "Homeroom English", lateIds, 4, 1, null, false, false, []],
    ["최윤아", "Phonics & Reading", lateIds, 3, 0, null, false, false, []],
    // 매주 담당이 바뀌는 수업 — 체험반 시간표에는 강사를 적지 않는다.
    ["정하늘", "Adventure", lateIds, 3, 0, null, true, false, []],
  ];

  const teacherId = new Map<string, string>();
  for (const [name] of spec) if (!teacherId.has(name)) teacherId.set(name, uid("t"));

  // 회피 시간 (요일 0=월, 교시 0=1교시)
  const avoid: Record<string, string[]> = {
    "Sophia Wilson": ["4:4"], // 금 5교시 장비 정비
    박세계: ["3:0", "3:1", "3:2"], // 목요일 오전 타 기관 출강
    최윤아: ["2:1"], // 수 2교시 운영회의
  };

  const rotationTeachers = [
    "Emma Clark",
    "Jack Miller",
    "Olivia Brown",
    "Liam Davis",
    "Sophia Wilson",
    "박세계",
  ].map((name) => teacherId.get(name)!);

  return {
    version: 3,
    schoolName: "○○영어체험센터",
    days,
    slots: generateSlots(DEFAULT_GEN),
    fixedActivities: [
      { id: uid("f"), name: "Orientation", cells: ["0:0", "2:0"] },
      { id: uid("f"), name: "Closing", cells: ["1:5", "4:5"] },
    ],
    segments: [segEarly, segLate],
    classes,
    // 월·화 TEAM A 와 수·목·금 TEAM D 는 같은 팀 자리라 한 장으로 묶어 본다.
    classGroups: [{ id: uid("cg"), name: "TEAM A+D 합본", classIds: [earlyIds[0], lateIds[0]] }],
    rooms,
    // 존 체험은 프로그램마다 존이 고정이다 — 배정할 때 자동으로 채워진다.
    programRooms: [
      { subject: "Airport & Immigration", roomId: zone("공항·출입국존") },
      { subject: "Restaurant & Ordering", roomId: zone("레스토랑존") },
      { subject: "Shopping & Money", roomId: zone("마트·쇼핑존") },
      { subject: "Clinic & Health", roomId: zone("병원·클리닉존") },
      { subject: "Media Studio", roomId: zone("미디어 스튜디오") },
      { subject: "World Culture", roomId: zone("컬처룸") },
    ],
    teachers: [...teacherId.entries()].map(([name, id]) => ({
      id,
      name,
      unavailable: avoid[name] ?? [],
    })),
    courses: spec.map(([name, subject, ids, hours, blocks, roomId, hideTeacher, oncePerSegment, days]) => ({
      id: uid("c"),
      teacherId: teacherId.get(name)!,
      subject,
      classIds: [...ids],
      hours,
      blocks,
      roomId,
      hideTeacher: hideTeacher || undefined,
      oncePerSegment: oncePerSegment || undefined,
      days: days && days.length > 0 ? days : undefined,
    })),
    timetable: [],
    rotation: {
      groups: [{ id: uid("g"), name: "존 담당 원어민", teacherIds: rotationTeachers }],
      turns: 0,
      log: [],
    },
  };
}
