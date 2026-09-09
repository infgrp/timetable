/**
 * 강사 로테이션.
 *
 * 규칙만 정해 두고, 돌리는 시기는 사람이 정한다.
 *   조 = [A, B, C]  (넣은 순서가 곧 도는 순서)
 *   한 번 돌리면 A가 B의 시간표를, B가 C의 시간표를, C가 A의 시간표를 맡는다.
 *
 * [다음으로 돌리기]를 누른 그 순간 timetable 의 강사가 실제로 바뀌고 기록이 남는다.
 * 그래서 화면·엑셀·인쇄는 언제나 "지금 유효한 시간표" 하나만 보면 된다.
 */
import type { Assignment, RotationConfig, RotationGroup, RotationTurn } from "./types";
import { uid } from "./store";

export function newGroup(name: string, teacherIds: string[] = []): RotationGroup {
  return { id: uid("g"), name, teacherIds };
}

/**
 * step 칸 돌린 상태에서 "i번 강사가 (i+step)번 강사의 원래 시간표를 맡는다".
 * 배치를 갈아끼우려면 반대 방향이 필요하다 — j번 강사의 칸은 (j-step)번 강사에게 간다.
 */
export function rotationMap(groups: RotationGroup[], step: number): Map<string, string> {
  const map = new Map<string, string>();
  for (const g of groups) {
    const ids = g.teacherIds.filter(Boolean);
    const n = ids.length;
    if (n < 2) continue;
    const shift = ((step % n) + n) % n;
    if (shift === 0) continue;
    for (let j = 0; j < n; j++) map.set(ids[j], ids[(j - shift + n) % n]);
  }
  return map;
}

/** 지금 시간표에 로테이션을 step 칸 입힌 사본 */
export function rotateAssignments(
  list: Assignment[],
  groups: RotationGroup[],
  step: number,
): Assignment[] {
  const map = rotationMap(groups, step);
  if (map.size === 0) return list;
  return list.map((a) => (a.teacherId && map.has(a.teacherId) ? { ...a, teacherId: map.get(a.teacherId)! } : a));
}

/** "지금 이 강사가 원래 누구 자리를 맡고 있는가" — 미리보기 표에 쓴다. */
export function rotationPlan(group: RotationGroup, step: number): { teacherId: string; sourceId: string }[] {
  const ids = group.teacherIds.filter(Boolean);
  const n = ids.length;
  if (n === 0) return [];
  const shift = ((step % n) + n) % n;
  return ids.map((teacherId, i) => ({ teacherId, sourceId: ids[(i + shift) % n] }));
}

/** 조 하나라도 2명 이상이어야 돌릴 의미가 있다. */
export function canRotate(config: RotationConfig): boolean {
  return config.groups.some((g) => g.teacherIds.filter(Boolean).length >= 2);
}

/** 한 바퀴가 몇 칸인지 (조마다 인원이 다르면 최소공배수) */
export function cycleLength(groups: RotationGroup[]): number {
  const sizes = groups.map((g) => g.teacherIds.filter(Boolean).length).filter((n) => n >= 2);
  if (sizes.length === 0) return 0;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  return sizes.reduce((acc, n) => (acc * n) / gcd(acc, n), 1);
}

export function newTurn(turns: number, note: string): RotationTurn {
  return { id: uid("rt"), at: new Date().toISOString(), turns, note };
}

/** 기록에 남길 날짜 표기 */
export function formatTurnDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(
    d.getHours(),
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 로테이션 그룹에 한 번이라도 들어간 강사인지 */
export function rotatedTeacherIds(groups: RotationGroup[]): Set<string> {
  const set = new Set<string>();
  for (const g of groups) for (const id of g.teacherIds) if (id) set.add(id);
  return set;
}
