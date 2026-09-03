/** 하루의 한 칸. 수업 교시(period)와 점심·쉬는시간(break)이 한 줄에 섞여 있다. */
export type DaySlot = {
  id: string;
  kind: "period" | "break";
  label: string;
  /** "HH:MM" */
  start: string;
  end: string;
};

export type Klass = {
  id: string;
  name: string;
};

export type Room = {
  id: string;
  name: string;
};

export type Teacher = {
  id: string;
  name: string;
  /**
   * 회피(배정 불가) 시간. `${dayIndex}:${periodIndex}` 형식의 키 집합.
   * periodIndex 는 break 를 제외한 수업 교시만 센 순번이다.
   */
  unavailable: string[];
};

/**
 * 한 교사가 여러 학급에 같은 과목을 가르치는 단위.
 * 내부적으로는 학급마다 하나의 "강의"로 펼쳐진다.
 */
export type Course = {
  id: string;
  teacherId: string;
  subject: string;
  classIds: string[];
  /** 학급당 주당 시수 */
  hours: number;
  /** 학급당 연속 2교시(블록) 횟수. blocks * 2 <= hours */
  blocks: number;
  /** 전용 특별실 (없으면 null) */
  roomId: string | null;
};

export type AppData = {
  version: 1;
  schoolName: string;
  days: string[];
  slots: DaySlot[];
  classes: Klass[];
  rooms: Room[];
  teachers: Teacher[];
  courses: Course[];
};

/** ── 솔버 입출력 ─────────────────────────────────────────── */

export type Lecture = {
  /** 원본 Course id */
  courseId: string;
  teacherId: string;
  classId: string;
  subject: string;
  roomId: string | null;
  hours: number;
  blocks: number;
};

export type SolveRequest = {
  dayCount: number;
  periodCount: number;
  /** blockable[p] === true 이면 p 교시와 p+1 교시가 붙어 있다(사이에 점심·쉬는시간 없음). */
  blockable: boolean[];
  lectures: Lecture[];
  teacherIds: string[];
  classIds: string[];
  roomIds: string[];
  /** teacherBlocked[teacherIdx][day * periodCount + period] */
  teacherBlocked: boolean[][];
  timeLimitMs: number;
  seed: number;
};

export type PlacedUnit = {
  lectureIndex: number;
  day: number;
  /** 시작 교시 index */
  period: number;
  /** 1 또는 2 */
  length: number;
};

export type Shortfall = {
  lectureIndex: number;
  /** 배치하지 못한 시수 */
  missingHours: number;
  /** 배치 실패 사유별 슬롯 수 */
  reasons: { label: string; count: number }[];
};

export type SolveResult = {
  ok: boolean;
  placed: PlacedUnit[];
  shortfalls: Shortfall[];
  elapsedMs: number;
  restarts: number;
  message: string;
};

export type SolveProgress = {
  type: "progress";
  restarts: number;
  /** 아직 남은 충돌 수 (0이면 완성) */
  bestConflicts: number;
  totalUnits: number;
  elapsedMs: number;
};

export type WorkerOut = SolveProgress | ({ type: "done" } & SolveResult);
