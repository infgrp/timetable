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
import type { AppData, Assignment, RotationConfig, RotationGroup, RotationTurn } from "./types";
import { uid } from "./store";
import { conflictsOf } from "./assignments";

export function rotationIssues(groups: RotationGroup[], teacherIds?: string[]): string[] {
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const g of groups) for (const id of g.teacherIds) {
    if (!id || (teacherIds && !teacherIds.includes(id))) errors.push("로테이션 조에 삭제되었거나 지정되지 않은 강사가 있습니다.");
    if (seen.has(id)) errors.push("한 강사는 하나의 로테이션 조에 한 번만 들어갈 수 있습니다.");
    seen.add(id);
  }
  return [...new Set(errors)];
}

export function newGroup(name: string, teacherIds: string[] = []): RotationGroup {
  return { id: uid("g"), name, teacherIds };
}

/**
 * step 칸 돌린 상태에서 "i번 강사가 (i+step)번 강사의 원래 시간표를 맡는다".
 * 배치를 갈아끼우려면 반대 방향이 필요하다 — j번 강사의 칸은 (j-step)번 강사에게 간다.
 */
export function rotationMap(groups: RotationGroup[], step: number): Map<string, string> {
  const errors = rotationIssues(groups);
  if (errors.length) throw new Error(errors.join("\n"));
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
  return rotationIssues(config.groups).length === 0 && config.groups.some((g) => g.teacherIds.filter(Boolean).length >= 2);
}

export function previewRotation(data: AppData, step = 1): { timetable: Assignment[]; errors: string[] } {
  const errors = rotationIssues(data.rotation.groups, data.teachers.map((t) => t.id));
  if (errors.length) return { timetable: data.timetable, errors };
  const timetable = rotateAssignments(data.timetable, data.rotation.groups, step);
  return { timetable, errors: conflictsOf(data, timetable).map((c) => c.text) };
}

export function applyRotation(data: AppData, note: string): AppData {
  if (!canRotate(data.rotation) || !data.timetable.length) throw new Error("시간표와 2명 이상의 로테이션 조가 필요합니다.");
  const preview = previewRotation(data);
  if (preview.errors.length) throw new Error(preview.errors.join("\n"));
  const changes = data.timetable.flatMap((a, i) => a.teacherId === preview.timetable[i].teacherId ? [] : [
    { assignmentId: a.id, before: a.teacherId, after: preview.timetable[i].teacherId },
  ]);
  if (!changes.length) throw new Error("이 조에 해당하는 수업이 없어 변경할 담당자가 없습니다.");
  const turns = data.rotation.turns + 1;
  return { ...data, timetable: preview.timetable, rotation: {
    ...data.rotation, turns, log: [{ ...newTurn(turns, note), changes }, ...data.rotation.log].slice(0, 60),
  } };
}

export function previewUndo(data: AppData): { timetable: Assignment[]; errors: string[] } {
  const changes = data.rotation.log[0]?.changes;
  if (!changes?.length) return { timetable: data.timetable, errors: ["되돌릴 담당자 기록이 없습니다. 이전 버전의 기록은 되돌릴 수 없습니다."] };
  const byId = new Map(data.timetable.map((a) => [a.id, a]));
  if (changes.some((c) => !byId.has(c.assignmentId) || byId.get(c.assignmentId)!.teacherId !== c.after))
    return { timetable: data.timetable, errors: ["마지막 로테이션 이후 해당 수업이 삭제·재생성되었거나 담당자가 수정되어 되돌릴 수 없습니다."] };
  const before = new Map(changes.map((c) => [c.assignmentId, c.before]));
  const timetable = data.timetable.map((a) => before.has(a.id) ? { ...a, teacherId: before.get(a.id)! } : a);
  const errors = conflictsOf(data, timetable).map((c) => c.text);
  if (changes.some((c) => c.before && !data.teachers.some((t) => t.id === c.before))) errors.push("복구할 강사가 삭제되었습니다.");
  return { timetable, errors };
}

export function undoRotation(data: AppData): AppData {
  const preview = previewUndo(data);
  if (preview.errors.length) throw new Error(preview.errors.join("\n"));
  return { ...data, timetable: preview.timetable, rotation: { ...data.rotation, turns: Math.max(0, data.rotation.turns - 1), log: data.rotation.log.slice(1) } };
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
