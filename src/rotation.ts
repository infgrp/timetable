/**
 * 강사 로테이션.
 *
 * 학기 내내 시간표(무엇을 언제 어디서 하는지)는 그대로 두고, 회차마다 담당 강사만 한 칸씩 민다.
 *   9월(0회차)  A→A표, B→B표, C→C표
 *   10월(1회차) A→B표, B→C표, C→A표
 *
 * 기준안(AppData.timetable)은 건드리지 않고, 회차를 고를 때마다 강사만 갈아끼운 사본을 만든다.
 * 그래서 회차를 아무리 돌려 봐도 원본이 상하지 않는다.
 */
import type { Assignment, RotationGroup, RotationRound } from "./types";
import { uid } from "./store";

export function newGroup(name: string, teacherIds: string[] = []): RotationGroup {
  return { id: uid("g"), name, teacherIds };
}

export function newRound(name: string, step: number): RotationRound {
  return { id: uid("r"), name, step };
}

/** 회차 목록이 비어 있을 때 쓰는 기본 회차(=기준안 그대로) */
export const BASE_ROUND: RotationRound = { id: "base", name: "기준안", step: 0 };

/**
 * step 회차에서 "i번 강사가 (i+step)번 강사의 기준 시간표를 맡는다".
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

/** 기준안에 로테이션을 입힌 사본 */
export function rotateAssignments(
  list: Assignment[],
  groups: RotationGroup[],
  step: number,
): Assignment[] {
  const map = rotationMap(groups, step);
  if (map.size === 0) return list;
  return list.map((a) => (a.teacherId && map.has(a.teacherId) ? { ...a, teacherId: map.get(a.teacherId)! } : a));
}

/** "이 회차에 누가 누구 시간표를 맡는가" — 미리보기 표에 쓴다. */
export function rotationPlan(group: RotationGroup, step: number): { teacherId: string; sourceId: string }[] {
  const ids = group.teacherIds.filter(Boolean);
  const n = ids.length;
  if (n === 0) return [];
  const shift = ((step % n) + n) % n;
  return ids.map((teacherId, i) => ({ teacherId, sourceId: ids[(i + shift) % n] }));
}

/** 로테이션 그룹에 한 번이라도 들어간 강사인지 */
export function rotatedTeacherIds(groups: RotationGroup[]): Set<string> {
  const set = new Set<string>();
  for (const g of groups) for (const id of g.teacherIds) if (id) set.add(id);
  return set;
}

/** 회차 이름 자동 생성 — 시작 월부터 그룹 크기만큼 */
export function monthRounds(startMonth: number, count: number): RotationRound[] {
  return Array.from({ length: count }, (_, i) => newRound(`${((startMonth - 1 + i) % 12) + 1}월`, i));
}
