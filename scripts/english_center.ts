/**
 * 앱에 들어 있는 영어체험센터 예시(src/sample.ts)를 헤드리스로 풀어 보고,
 * 하드 제약이 실제로 지켜졌는지 직접 세어 확인한다.
 * 배치 엔진이나 예시를 손본 뒤에는 이걸 돌려 보면 된다.
 */
import { writeFileSync } from "node:fs";
import { solve } from "../src/solver";
import { sampleData } from "../src/sample";
import { blockableFlags, buildLectures, periodsOf, roomLoads, validate } from "../src/store";
import type { SolveRequest } from "../src/types";

const data = sampleData();
const periods = periodsOf(data.slots);
const P = periods.length;
const capacity = P * data.days.length;

const out = "영어체험센터_예시.json";
writeFileSync(out, JSON.stringify(data, null, 2), "utf8");

console.log(
  `체험반 ${data.classes.length} · 강사 ${data.teachers.length} · 체험존 ${data.rooms.length} · 주당 칸 ${capacity}`,
);
for (const i of validate(data)) console.log(`  [${i.level}] ${i.text}`);

const lectures = buildLectures(data);
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
      if (d < data.days.length && p < P) arr[d * P + p] = true;
    }
    return arr;
  }),
  timeLimitMs: Number(process.argv[2] ?? 10000),
  seed: 20260903,
};

const r = solve(req);
console.log(`\n배치: ok=${r.ok} ${r.elapsedMs}ms 다시 시도 ${r.restarts}회`);

// ── 하드 제약 직접 검증 ──
const seen = { cls: new Set<string>(), tch: new Set<string>(), zone: new Set<string>() };
const dayOnce = new Set<string>();
let violations = 0;
let placedHours = 0;
const fail = (msg: string) => {
  violations++;
  console.log("  위반:", msg);
};

for (const u of r.placed) {
  const lec = lectures[u.lectureIndex];
  placedHours += u.length;
  if (u.length === 2 && !req.blockable[u.period]) fail("연속 2교시가 붙어 있지 않음");
  const dk = `${lec.classId}|${lec.courseId}|${u.day}`;
  if (dayOnce.has(dk)) fail(`같은 요일에 같은 프로그램 두 번 (${lec.subject})`);
  dayOnce.add(dk);
  for (let k = 0; k < u.length; k++) {
    const s = u.day * P + u.period + k;
    if (!seen.cls.add(`${lec.classId}|${s}`)) fail("체험반 중복");
    if (!seen.tch.add(`${lec.teacherId}|${s}`)) fail("강사 중복");
    if (lec.roomId && !seen.zone.add(`${lec.roomId}|${s}`)) fail("체험존 중복");
    const t = data.teachers.find((x) => x.id === lec.teacherId)!;
    if (t.unavailable.includes(`${u.day}:${u.period + k}`)) fail(`회피 시간 침범 (${t.name})`);
  }
}
const need = lectures.reduce((a, l) => a + l.hours, 0);
console.log(`시수 ${placedHours}/${need} · 하드 제약 위반 ${violations}건`);

// ── 표 출력 ──
const trim = (s: string) => (s.length > 13 ? s.slice(0, 13) : s);
const printGrid = (title: string, pick: (lec: (typeof lectures)[number]) => boolean, label: (lec: (typeof lectures)[number]) => string) => {
  const grid: string[][] = Array.from({ length: P }, () => new Array(data.days.length).fill(""));
  for (const u of r.placed) {
    const lec = lectures[u.lectureIndex];
    if (!pick(lec)) continue;
    for (let k = 0; k < u.length; k++) grid[u.period + k][u.day] = trim(label(lec));
  }
  console.log(`\n【${title}】`);
  console.log("       " + data.days.map((d) => d.padEnd(14)).join(""));
  periods.forEach((p, pi) => {
    console.log(`${p.label.padEnd(4)}${p.start} ` + grid[pi].map((v) => (v || "·").padEnd(14)).join(""));
  });
};

const className = new Map(data.classes.map((c) => [c.id, c.name]));
printGrid(`${data.classes[0].name} 시간표`, (l) => l.classId === data.classes[0].id, (l) => l.subject);
printGrid(
  `${data.rooms[0].name} 사용 현황`,
  (l) => l.roomId === data.rooms[0].id,
  (l) => className.get(l.classId) ?? "",
);

console.log("\n【체험존 사용률】");
const loads = roomLoads(data);
for (const rm of data.rooms) {
  const load = loads.get(rm.id) ?? 0;
  console.log(`  ${rm.name.padEnd(16)} ${String(load).padStart(2)}/${capacity}칸`);
}
console.log(`\n저장: ${out}`);
