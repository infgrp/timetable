import { solve } from "../src/solver";
import { sampleData, } from "../src/sample";
import { buildSolveRequest, periodsOf } from "../src/store";
import type { SolveRequest } from "../src/types";

const makeReq = (data: ReturnType<typeof sampleData>, seed: number, ms: number): SolveRequest =>
  buildSolveRequest(data, { timeLimitMs: ms, seed });

const data = sampleData();
const req = makeReq(data, 1, 15000);
console.log("lectures:", req.lectures.length, "capacity:", req.dayCount * req.periodCount);
const r = solve(req);
console.log("ok:", r.ok, "ms:", r.elapsedMs, "restarts:", r.restarts, "placed units:", r.placed.length);

// 하드 제약 검증
const P = req.periodCount;
const classSlot = new Map<string, string>();
const teacherSlot = new Map<string, string>();
const roomSlot = new Map<string, string>();
const dayOnce = new Set<string>();
const flags = req.blockable;
let hours = 0;
let violations = 0;
for (const u of r.placed) {
  const lec = req.lectures[u.lectureIndex];
  hours += u.length;
  if (u.length === 2 && !flags[u.period]) { console.log("VIOLATION block not adjacent"); violations++; }
  const dk = `${lec.classId}|${lec.subject}|${lec.teacherId}|${u.day}`;
  if (dayOnce.has(dk)) { console.log("VIOLATION same subject twice a day", dk); violations++; }
  dayOnce.add(dk);
  for (let k = 0; k < u.length; k++) {
    const s = u.day * P + u.period + k;
    const ck = `${lec.classId}|${s}`;
    if (classSlot.has(ck)) { console.log("VIOLATION class clash", ck); violations++; }
    classSlot.set(ck, lec.subject);
    const tk = `${lec.teacherId}|${s}`;
    if (teacherSlot.has(tk)) { console.log("VIOLATION teacher clash", tk); violations++; }
    teacherSlot.set(tk, lec.subject);
    if (lec.roomId) {
      const rk = `${lec.roomId}|${s}`;
      if (roomSlot.has(rk)) { console.log("VIOLATION room clash", rk); violations++; }
      roomSlot.set(rk, lec.subject);
    }
    const ti = data.teachers.find((t) => t.id === lec.teacherId)!;
    if (ti.unavailable.includes(`${u.day}:${u.period + k}`)) { console.log("VIOLATION teacher unavailable"); violations++; }
  }
}
const need = req.lectures.reduce((a, l) => a + l.hours, 0);
console.log("hours placed:", hours, "/ needed:", need, "violations:", violations);
if (!r.ok) console.log(JSON.stringify(r.shortfalls, null, 1));
