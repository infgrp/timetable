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
  /**
   * 소속 운영 구간. null·undefined 면 모든 운영 요일에 올 수 있다.
   * 월·화에 오는 학년과 수·목·금에 오는 학년이 다를 때 나눈다.
   */
  segmentId?: string | null;
};

/**
 * 운영 구간 — 요일 묶음 하나.
 * "월·화 (3학년)", "수·목·금 (4학년)" 처럼 서로 다른 팀이 다른 요일에 오는 운영을 담는다.
 * 배치는 한 번에 풀되 각 체험반은 자기 구간의 요일에만 들어간다.
 */
export type Segment = {
  id: string;
  name: string;
  /** days 의 index 목록 */
  days: number[];
};

/**
 * 요일별 고정 활동 — 월·수 1교시 Orientation, 화·금 6교시 Closing 처럼
 * 수업이 아니지만 자리를 차지하는 칸.
 *
 * 점심시간은 하루 구성 전체에 걸치는 시간 띠(DaySlot.kind === "break")로 다루고,
 * 이쪽은 "특정 요일의 특정 교시"만 막는다.
 */
export type FixedActivity = {
  id: string;
  name: string;
  /** `${dayIndex}:${periodIndex}` 키 목록. 강사 회피 시간과 같은 형식이다. */
  cells: string[];
  /**
   * 이 활동이 쓰는 체험존 (없으면 null).
   * Orientation·Closing 을 특정 존에서 한다면 지정한다 — 그 존의 시간표에도 나타난다.
   */
  roomId?: string | null;
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
  /**
   * 강사 개인 시간표에만 쓰는 다른 표시명 (비우면 subject 를 그대로 쓴다).
   * 체험반·체험존 표에는 Adventure 로, 강사 표에는 "Adventure ①" 처럼
   * 로테이션 순번을 붙여 본인 차례를 알아보게 할 때 쓴다.
   */
  teacherSubject?: string;
  classIds: string[];
  /** 학급당 주당 시수 */
  hours: number;
  /** 학급당 연속 2교시(블록) 횟수. blocks * 2 <= hours */
  blocks: number;
  /** 전용 특별실 (없으면 null) */
  roomId: string | null;
  /**
   * 체험반·체험존 시간표에 강사 이름을 적지 않는다.
   * 담당이 매주 바뀌는 수업(어드벤처 등)에 쓴다 — 강사 개인 시간표에는 그대로 나온다.
   */
  hideTeacher?: boolean;
  /**
   * 같은 반에서 이 프로그램이 운영 구간 안에 여러 번 나와도 된다 (매일 하는 홈룸 영어 등).
   * 기본(false)은 "구간당 1회" — 월·화반이면 월 또는 화 중 하루에 한 번만 배치된다.
   * 구간이 없는 반은 언제나 "하루 1회"로만 본다.
   */
  repeatInSegment?: boolean;
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
  /** 강사 개인 시간표용 표시명 (Course.teacherSubject 를 물려받는다). 비면 subject 사용. */
  teacherSubject?: string;
  /** days 의 index */
  day: number;
  /** break 를 제외한 수업 교시만 센 시작 index */
  period: number;
  length: 1 | 2;
  /** 체험반·체험존 시간표에서 강사 이름을 감춘다 (Course.hideTeacher 를 물려받는다) */
  hideTeacher?: boolean;
  /** 구간 안 반복 허용 (Course.repeatInSegment 를 물려받는다). 없으면 구간당 1회로 본다. */
  repeatInSegment?: boolean;
};

/** 로테이션 한 바퀴를 도는 강사 묶음. 목록의 순서가 곧 도는 순서다. */
export type RotationGroup = {
  id: string;
  name: string;
  teacherIds: string[];
};

/** 로테이션을 실제로 한 번 돌린 기록 */
export type RotationTurn = {
  id: string;
  /** ISO 날짜시각 */
  at: string;
  /** 돌린 뒤의 누적 칸 수 */
  turns: number;
  /** "10월부터" 같은 메모 */
  note: string;
  /** 실제 변경된 담당자. 규칙을 수정해도 이 기록으로 되돌린다. */
  changes?: { assignmentId: string; before: string | null; after: string | null }[];
};

/**
 * 로테이션은 규칙만 정해 두고, 돌리는 시기는 사람이 정한다.
 * [다음으로 돌리기]를 누른 그 순간 timetable 의 강사가 실제로 바뀌고 기록이 남는다.
 */
export type RotationConfig = {
  groups: RotationGroup[];
  /** 지금까지 몇 칸 돌렸는지 */
  turns: number;
  log: RotationTurn[];
};

export type AppData = {
  version: 3;
  schoolName: string;
  days: string[];
  slots: DaySlot[];
  /** 요일별 하루 구성. 생략한 요일은 공통 slots를 사용한다. */
  daySlots?: Record<string, DaySlot[]>;
  /** 요일별 고정 활동 (Orientation·Closing 등) */
  fixedActivities: FixedActivity[];
  /** 운영 구간 (월·화 / 수·목·금). 비어 있으면 모든 반이 모든 요일에 온다. */
  segments: Segment[];
  classes: Klass[];
  rooms: Room[];
  teachers: Teacher[];
  courses: Course[];
  /** 현재 구성된 시간표. 로테이션을 돌리면 여기의 강사가 바뀐다. */
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
  teacherSubject?: string;
  roomId: string | null;
  hours: number;
  blocks: number;
  hideTeacher?: boolean;
  repeatInSegment?: boolean;
};

export type SolveRequest = {
  dayCount: number;
  periodCount: number;
  /**
   * dayGroup[day] — 같은 값이면 같은 운영 구간. "같은 프로그램 구간당 1회" 판정에 쓴다.
   * 생략하면 요일마다 다른 구간(= 하루 1회)으로 본다.
   */
  dayGroup?: number[];
  /** blockable[p] === true 이면 p 교시와 p+1 교시가 붙어 있다(사이에 점심·쉬는시간 없음). */
  blockable: boolean[];
  blockableByDay?: boolean[][];
  /** 다른 구간의 확정 시간표가 이미 사용하는 칸. */
  reservedTeacherCells?: boolean[][];
  reservedRoomCells?: boolean[][];
  lectures: Lecture[];
  teacherIds: string[];
  classIds: string[];
  roomIds: string[];
  /** teacherBlocked[teacherIdx][day * periodCount + period] */
  teacherBlocked: boolean[][];
  /** 고정 활동이 차지해 아무 수업도 넣을 수 없는 칸. [day * periodCount + period] */
  blockedCells: boolean[];
  /** classAllowedDays[classIdx][day] — 운영 구간 밖의 요일은 false */
  classAllowedDays: boolean[][];
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
