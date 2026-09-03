import type { AppData } from "./types";
import { DEFAULT_GEN, generateSlots, uid } from "./store";

/** 처음 열었을 때 동작을 확인해 볼 수 있는 예시(고1 4개 학급). */
export function sampleData(): AppData {
  const classes = [1, 2, 3, 4].map((n) => ({ id: uid("k"), name: `1-${n}` }));
  const classIds = classes.map((c) => c.id);

  const rooms = ["과학실", "음악실", "미술실", "컴퓨터실"].map((name) => ({ id: uid("r"), name }));
  const room = (name: string) => rooms.find((r) => r.name === name)!.id;

  const spec: [string, string, number, number, string | null][] = [
    // [교사명, 과목, 주당 시수, 블록 수, 특별실]
    ["김국어", "국어", 4, 0, null],
    ["이수학", "수학", 4, 0, null],
    ["박영어", "영어", 4, 0, null],
    ["최사회", "한국사", 3, 0, null],
    ["최사회", "통합사회", 3, 0, null],
    ["정과학", "통합과학", 3, 0, room("과학실")],
    ["정과학", "과학탐구실험", 2, 1, room("과학실")],
    ["강체육", "체육", 3, 0, null],
    ["윤음악", "음악", 2, 0, room("음악실")],
    ["한미술", "미술", 2, 1, room("미술실")],
    ["오정보", "정보", 2, 1, room("컴퓨터실")],
    ["서진로", "창의적체험활동", 3, 0, null],
  ];

  const teacherByName = new Map<string, string>();
  for (const [name] of spec) if (!teacherByName.has(name)) teacherByName.set(name, uid("t"));

  const teachers = [...teacherByName.entries()].map(([name, id]) => ({
    id,
    name,
    unavailable: [] as string[],
  }));
  // 예시: 강체육 선생님은 금요일 6·7교시에 수업을 넣지 않는다.
  const pe = teachers.find((t) => t.name === "강체육");
  if (pe) pe.unavailable = ["4:5", "4:6"];

  return {
    version: 1,
    schoolName: "예시고등학교",
    days: ["월", "화", "수", "목", "금"],
    slots: generateSlots(DEFAULT_GEN),
    classes,
    rooms,
    teachers,
    courses: spec.map(([name, subject, hours, blocks, roomId]) => ({
      id: uid("c"),
      teacherId: teacherByName.get(name)!,
      subject,
      classIds: [...classIds],
      hours,
      blocks,
      roomId,
    })),
  };
}
