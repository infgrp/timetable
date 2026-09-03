import type { AppData } from "./types";
import { DEFAULT_GEN, generateSlots, uid } from "./store";

/**
 * 상주형 영어체험센터 예시 — 6개 캠프반이 주 5일 동안 체험존을 돌아가며 쓴다.
 * 처음 열었을 때 구조를 눈으로 확인하고, 자기 센터에 맞게 고쳐 쓰라고 넣어 둔 것.
 */
export function sampleData(): AppData {
  const classes = ["A", "B", "C", "D", "E", "F"].map((n) => ({ id: uid("k"), name: `${n}반` }));
  const classIds = classes.map((c) => c.id);
  const firstHalf = classIds.slice(0, 3);
  const secondHalf = classIds.slice(3);

  const rooms = [
    "공항·출입국존",
    "레스토랑존",
    "마트·쇼핑존",
    "병원·클리닉존",
    "미디어 스튜디오",
    "컬처룸",
  ].map((name) => ({ id: uid("r"), name }));
  const zone = (name: string) => rooms.find((r) => r.name === name)!.id;

  // [강사, 프로그램, 담당 체험반, 반당 주당 시수, 연속 2교시 횟수, 체험존]
  const spec: [string, string, string[], number, number, string | null][] = [
    ["Emma Clark", "Airport & Immigration", classIds, 2, 1, zone("공항·출입국존")],
    ["Jack Miller", "Restaurant & Ordering", classIds, 2, 1, zone("레스토랑존")],
    ["Olivia Brown", "Shopping & Money", classIds, 2, 1, zone("마트·쇼핑존")],
    ["Liam Davis", "Clinic & Health", classIds, 2, 1, zone("병원·클리닉존")],
    ["Sophia Wilson", "Media Studio", classIds, 2, 1, zone("미디어 스튜디오")],
    ["박세계", "World Culture", classIds, 2, 1, zone("컬처룸")],
    ["김지영", "Homeroom English", firstHalf, 6, 1, null],
    ["이수민", "Homeroom English", secondHalf, 6, 1, null],
    ["최윤아", "Phonics & Reading", classIds, 4, 0, null],
    ["정하늘", "Song & Chant", classIds, 3, 0, null],
    ["한도윤", "Project Time", classIds, 4, 2, null],
    ["Emma Clark", "Free Talking", classIds, 1, 0, null],
  ];

  const teacherId = new Map<string, string>();
  for (const [name] of spec) if (!teacherId.has(name)) teacherId.set(name, uid("t"));

  // 회피 시간 (요일 0=월, 교시 0=1교시)
  const avoid: Record<string, string[]> = {
    "Sophia Wilson": ["4:4", "4:5"], // 금 5·6교시 장비 정비
    박세계: ["2:0", "2:1", "2:2", "2:3", "2:4", "2:5"], // 수요일 타 기관 출강
    최윤아: ["0:0"], // 월 1교시 운영회의
    정하늘: ["1:5", "3:5"], // 화·목 6교시
  };

  return {
    version: 1,
    schoolName: "○○영어체험센터",
    days: ["월", "화", "수", "목", "금"],
    slots: generateSlots(DEFAULT_GEN),
    classes,
    rooms,
    teachers: [...teacherId.entries()].map(([name, id]) => ({
      id,
      name,
      unavailable: avoid[name] ?? [],
    })),
    courses: spec.map(([name, subject, ids, hours, blocks, roomId]) => ({
      id: uid("c"),
      teacherId: teacherId.get(name)!,
      subject,
      classIds: [...ids],
      hours,
      blocks,
      roomId,
    })),
  };
}
