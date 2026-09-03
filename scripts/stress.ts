import { solve } from "../src/solver";
import { blockableFlags, DEFAULT_GEN, generateSlots, periodsOf, uid } from "../src/store";
import type { AppData, SolveRequest } from "../src/types";

/** 30학급 규모의 인문계 고교를 흉내 낸 부하 테스트 */
function bigSchool(): AppData {
  const slots = generateSlots({ ...DEFAULT_GEN, periodCount: 7 });
  const days = ["월", "화", "수", "목", "금"];
  const P = periodsOf(slots).length;
  const capacity = P * days.length;

  const classes = [];
  for (let g = 1; g <= 3; g++) for (let n = 1; n <= 10; n++) classes.push({ id: uid("k"), name: `${g}-${n}` });

  // [과목, 학급당 시수, 블록 수, 교사 1명이 맡는 학급 수, 특별실 필요]
  const subjects: [string, number, number, number, boolean][] = [
    ["국어", 4, 0, 5, false],
    ["수학", 4, 0, 5, false],
    ["영어", 4, 0, 5, false],
    ["한국사", 3, 0, 6, false],
    ["통합사회", 3, 0, 6, false],
    ["통합과학", 2, 1, 7, true],
    ["과학탐구실험", 2, 1, 10, true],
    ["체육", 3, 0, 6, false],
    ["음악", 2, 1, 10, true],
    ["미술", 2, 1, 10, true],
    ["정보", 2, 1, 10, true],
    ["창의적체험활동", 3 + Number(process.env.EXTRA ?? 0), 0, 6, false],
  ];

  const teachers: AppData["teachers"] = [];
  const rooms: AppData["rooms"] = [];
  const courses: AppData["courses"] = [];

  for (const [subject, hours, blocks, perTeacher, needsRoom] of subjects) {
    // 교사 한 명이 맡는 학급 묶음
    const groups: string[][] = [];
    for (let i = 0; i < classes.length; i += perTeacher) {
      groups.push(classes.slice(i, i + perTeacher).map((c) => c.id));
    }
    // 특별실은 시수 합이 주당 칸 수를 넘지 않는 선에서 나눠 쓴다.
    let roomId: string | null = null;
    let roomLoad = 0;
    groups.forEach((group, gi) => {
      const t = { id: uid("t"), name: `${subject}${gi + 1}`, unavailable: [] as string[] };
      teachers.push(t);
      const load = group.length * hours;
      if (needsRoom) {
        if (!roomId || roomLoad + load > capacity * 0.75) {
          roomId = uid("r");
          rooms.push({ id: roomId, name: `${subject}실${rooms.length + 1}` });
          roomLoad = 0;
        }
        roomLoad += load;
      }
      courses.push({
        id: uid("c"),
        teacherId: t.id,
        subject,
        classIds: group,
        hours,
        blocks,
        roomId: needsRoom ? roomId : null,
      });
    });
  }

  // 교사마다 회피 시간 몇 칸 (재현 가능하게 고정 규칙)
  teachers.forEach((t, i) => {
    const d = i % days.length;
    t.unavailable =
      process.env.HARD === "1"
        ? Array.from({ length: P }, (_, p) => `${d}:${p}`)
        : [`${d}:${P - 1}`, `${d}:${P - 2}`];
  });

  return { version: 1, schoolName: "부하테스트고", days, slots, classes, rooms, teachers, courses };
}

const data = bigSchool();
const P = periodsOf(data.slots).length;
const lectures = data.courses.flatMap((c) =>
  c.classIds.map((classId) => ({
    courseId: c.id,
    teacherId: c.teacherId,
    classId,
    subject: c.subject,
    roomId: c.roomId,
    hours: c.hours,
    blocks: c.blocks,
  })),
);
const req: SolveRequest = {
  dayCount: data.days.length,
  periodCount: P,
  blockable: blockableFlags(data.slots),
  lectures,
  teacherIds: data.teachers.map((t) => t.id),
  classIds: data.classes.map((c) => c.id),
  roomIds: data.rooms.map((r) => r.id),
  teacherBlocked: data.teachers.map((t) => {
    const arr = new Array<boolean>(data.days.length * P).fill(false);
    for (const key of t.unavailable) {
      const [d, p] = key.split(":").map(Number);
      arr[d * P + p] = true;
    }
    return arr;
  }),
  timeLimitMs: Number(process.argv[2] ?? 30000),
  seed: 7,
};

const hoursPerClass = data.courses.reduce((a, c) => a + c.hours, 0) / 1; // 모든 학급이 같은 구성
const perClass = new Map<string, number>();
for (const l of lectures) perClass.set(l.classId, (perClass.get(l.classId) ?? 0) + l.hours);
console.log(
  `학급 ${data.classes.length} · 교사 ${data.teachers.length} · 특별실 ${data.rooms.length} · 강의 ${lectures.length}`,
);
console.log(`학급당 시수 ${[...new Set(perClass.values())].join(",")} / 주당 칸 ${P * data.days.length}`);
void hoursPerClass;

const t0 = Date.now();
const r = solve(req, (restarts, conflicts, total, ms) => console.log(`  재시작 ${restarts} 남은충돌 ${conflicts} / ${total}단위 ${ms}ms`));
console.log("ok:", r.ok, "elapsed:", Date.now() - t0, "ms restarts:", r.restarts);

// 검증
let violations = 0;
const seen = { cls: new Set<string>(), tch: new Set<string>(), room: new Set<string>(), day: new Set<string>() };
let placedHours = 0;
for (const u of r.placed) {
  const lec = lectures[u.lectureIndex];
  placedHours += u.length;
  if (u.length === 2 && !req.blockable[u.period]) violations++;
  const dk = `${lec.classId}|${lec.courseId}|${u.day}`;
  if (seen.day.has(dk)) { violations++; console.log("day dup", dk); }
  seen.day.add(dk);
  for (let k = 0; k < u.length; k++) {
    const s = u.day * P + u.period + k;
    const ck = `${lec.classId}|${s}`; if (seen.cls.has(ck)) { violations++; console.log("class clash"); } seen.cls.add(ck);
    const tk = `${lec.teacherId}|${s}`; if (seen.tch.has(tk)) { violations++; console.log("teacher clash"); } seen.tch.add(tk);
    if (lec.roomId) { const rk = `${lec.roomId}|${s}`; if (seen.room.has(rk)) { violations++; console.log("room clash"); } seen.room.add(rk); }
    const ti = data.teachers.find((t) => t.id === lec.teacherId)!;
    if (ti.unavailable.includes(`${u.day}:${u.period + k}`)) { violations++; console.log("unavailable"); }
  }
}
console.log("배치 시수:", placedHours, "/", lectures.reduce((a, l) => a + l.hours, 0), "위반:", violations);
if (!r.ok)
  for (const sf of r.shortfalls) {
    const lec = lectures[sf.lectureIndex];
    const cls = data.classes.find((c) => c.id === lec.classId)!.name;
    const t = data.teachers.find((x) => x.id === lec.teacherId)!.name;
    console.log(`미배치: ${cls} ${lec.subject}(${t}) ${sf.missingHours}시간`, sf.reasons);
  }
