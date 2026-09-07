/**
 * 영어체험센터 시간표 모델.
 *
 * 화면 용어와 타입 이름의 대응 (타입 이름은 일반 시간표 문제의 관례를 따른다)
 *   Klass   = 체험반   시간표 한 장이 만들어지는 단위. 캠프반이거나 방문 학급.
 *   Room    = 체험존   같은 교시에 한 팀만 들어갈 수 있는 공간. 보통 여기가 병목.
 *   Teacher = 강사     원어민·한국인 강사.
 *   Course  = 프로그램 배정. 한 강사가 한 프로그램을 여러 체험반에 맡는 단위.
 */

/** 하루의 한 칸. 프로그램 교시(period)와 점심·쉬는시간(break)이 한 줄에 섞여 있다. */
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

/**
 * 배치된 한 칸. 연속 2교시면 length 2.
 *
 * 자동 배치 결과·엑셀로 올린 기존 시간표·손으로 고친 내용이 전부 같은 모양이라,
 * 화면·엑셀·로테이션이 모두 이 목록 하나만 본다.
 */
export type Assignment = {
  id: string;
  classId: string;
  teacherId: string | null;
  roomId: string | null;
  subject: string;
  /** days 의 index */
  day: number;
  /** break 를 제외한 수업 교시만 센 시작 index */
  period: number;
  length: 1 | 2;
};

/** 로테이션 한 바퀴를 도는 강사 묶음. 목록의 순서가 곧 도는 순서다. */
export type RotationGroup = {
  id: string;
  name: string;
  teacherIds: string[];
};

/** 회차 하나(9월·10월…). step 만큼 밀어서 담당을 바꾼다. */
export type RotationRound = {
  id: string;
  name: string;
  step: number;
};

export type RotationConfig = {
  groups: RotationGroup[];
  rounds: RotationRound[];
};

export type AppData = {
  version: 2;
  schoolName: string;
  days: string[];
  slots: DaySlot[];
  classes: Klass[];
  rooms: Room[];
  teachers: Teacher[];
  courses: Course[];
  /** 현재 구성된 시간표(기준안). 로테이션은 여기에 강사만 갈아끼워 파생시킨다. */
  timetable: Assignment[];
  rotation: RotationConfig;
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
