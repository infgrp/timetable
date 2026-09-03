/** 만들어진 xlsx 가 실제로 열리는 파일인지 확인하려고 한 장 뽑아 둔다. */
import { writeFileSync } from "node:fs";
import { buildXlsx } from "../src/xlsx";
import { toSheet } from "../src/timetableSheet";
import { generateSlots } from "../src/store";
import type { Grid } from "../src/components/Timetable";

const days = ["월", "화", "수", "목", "금"];
const slots = generateSlots({
  firstStart: "09:00",
  periodMinutes: 40,
  breakMinutes: 10,
  periodCount: 6,
  lunchAfter: 4,
  lunchMinutes: 60,
});

const grid: Grid = Array.from({ length: 6 }, () => new Array(5).fill(null));
grid[0][0] = { top: "Airport & Immigration", bottom: "Emma Clark · 공항·출입국존", span: 2, hue: 40 };
grid[1][0] = "cont";
grid[2][1] = { top: "Project Time", bottom: "한도윤", span: 2, hue: 200 };
grid[3][1] = "cont";
grid[4][2] = { top: "Homeroom English", bottom: "김지영", span: 1, hue: 310 };
grid[5][4] = { top: 'Song & "Chant" <A&B>', bottom: "정하늘", span: 1, hue: 90 };

const sheet = toSheet({
  sheetName: "A반",
  title: "○○영어체험센터 A반 시간표",
  days,
  slots,
  grid,
});

const blob = buildXlsx([sheet, { ...sheet, name: "A반 (2)" }]);
const buf = Buffer.from(await blob.arrayBuffer());
writeFileSync("xlsx_check.xlsx", buf);
console.log(`xlsx_check.xlsx ${buf.length} bytes · 시트 2장`);
