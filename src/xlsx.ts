/**
 * 의존성 없는 최소 xlsx 작성기.
 *
 * xlsx 는 XML 몇 개를 담은 zip 이라, 압축하지 않는 zip(store)으로 묶으면
 * 라이브러리 없이도 엑셀이 그대로 읽는 파일을 만들 수 있다.
 * 시간표에 필요한 것만 지원한다 — 문자열 셀, 셀 병합, 열 너비, 행 높이, 약간의 서식.
 */

export type CellStyle =
  | "title"
  | "header"
  | "timeCol"
  | "lunch"
  | "empty"
  | `subject${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`;

export type XCell = { text: string; style: CellStyle } | null;

export type XSheet = {
  name: string;
  /** 열 너비 (엑셀 문자 단위) */
  colWidths: number[];
  /** rows[r][c] — null 이면 셀을 만들지 않는다(병합에 먹힌 자리) */
  rows: XCell[][];
  rowHeights?: (number | undefined)[];
  merges: { r1: number; c1: number; r2: number; c2: number }[];
};

/** 과목명을 8색 팔레트 중 하나로 */
const SUBJECT_FILLS = [
  "FFDCEAF7",
  "FFDFF3E4",
  "FFFDE8D8",
  "FFF3E0F0",
  "FFE9F2DA",
  "FFFDE2E4",
  "FFDDF1F3",
  "FFF1ECDA",
];

const STYLE_ORDER: CellStyle[] = [
  "title",
  "header",
  "timeCol",
  "lunch",
  "empty",
  "subject0",
  "subject1",
  "subject2",
  "subject3",
  "subject4",
  "subject5",
  "subject6",
  "subject7",
];

/** cellXfs 안에서의 위치 (0번은 기본 서식) */
const styleIndex = (s: CellStyle) => STYLE_ORDER.indexOf(s) + 1;

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function colName(i: number): string {
  let n = i + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - rem) / 26);
  }
  return out;
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function stylesXml(): string {
  const fonts = [
    '<font><sz val="11"/><name val="맑은 고딕"/></font>',
    '<font><b/><sz val="11"/><name val="맑은 고딕"/></font>',
    '<font><b/><sz val="14"/><name val="맑은 고딕"/></font>',
    '<font><sz val="9"/><color rgb="FF6B7A8F"/><name val="맑은 고딕"/></font>',
  ].join("");

  const fillList = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFD6E5F6"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF4F7FB"/><bgColor indexed="64"/></patternFill></fill>',
    ...SUBJECT_FILLS.map(
      (c) =>
        `<fill><patternFill patternType="solid"><fgColor rgb="${c}"/><bgColor indexed="64"/></patternFill></fill>`,
    ),
  ];

  const thin = '<left style="thin"><color rgb="FFB3CFEF"/></left>';
  const borders = [
    "<border><left/><right/><top/><bottom/><diagonal/></border>",
    `<border>${thin}<right style="thin"><color rgb="FFB3CFEF"/></right><top style="thin"><color rgb="FFB3CFEF"/></top><bottom style="thin"><color rgb="FFB3CFEF"/></bottom><diagonal/></border>`,
  ].join("");

  // cellXfs — 0번은 기본, 이후 STYLE_ORDER 순서와 1:1 대응
  const center = 'applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/>';
  const xfs = [
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    // title
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>',
    // header
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" ${center}</xf>`,
    // timeCol
    `<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" ${center}</xf>`,
    // lunch
    `<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" ${center}</xf>`,
    // empty
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" ${center}</xf>`,
    // subject0..7 (fillId 5부터)
    ...SUBJECT_FILLS.map(
      (_, i) =>
        `<xf numFmtId="0" fontId="0" fillId="${5 + i}" borderId="1" xfId="0" applyFill="1" applyBorder="1" ${center}</xf>`,
    ),
  ];

  return `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4">${fonts}</fonts><fills count="${fillList.length}">${fillList.join("")}</fills><borders count="2">${borders}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="표준" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function sheetXml(sheet: XSheet): string {
  const cols = sheet.colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          if (!cell) return "";
          const ref = `${colName(c)}${r + 1}`;
          return `<c r="${ref}" s="${styleIndex(cell.style)}" t="inlineStr"><is><t xml:space="preserve">${esc(cell.text)}</t></is></c>`;
        })
        .join("");
      const h = sheet.rowHeights?.[r];
      const attrs = h ? ` ht="${h}" customHeight="1"` : "";
      return `<row r="${r + 1}"${attrs}>${cells}</row>`;
    })
    .join("");

  const merges = sheet.merges.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges
        .map((m) => `<mergeCell ref="${colName(m.c1)}${m.r1 + 1}:${colName(m.c2)}${m.r2 + 1}"/>`)
        .join("")}</mergeCells>`
    : "";

  return `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="16.5"/><cols>${cols}</cols><sheetData>${rows}</sheetData>${merges}<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>`;
}

/** 엑셀 시트 이름 규칙: 31자 이하, : \ / ? * [ ] 사용 불가 */
export function safeSheetName(name: string, fallback: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, " ").trim();
  return (cleaned || fallback).slice(0, 31);
}

/** ── zip (store, 무압축) ───────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

type Entry = { name: string; data: Uint8Array };

function zip(entries: Entry[]): Blob {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 파일명
    lv.setUint16(8, 0, true); // 무압축
    lv.setUint16(10, 0, true); // time
    lv.setUint16(12, 0x2821, true); // date (2000-01-01)
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    locals.push(local, e.data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x2821, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length + size;
  }

  const centralSize = centrals.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return new Blob([out.buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function buildXlsx(sheets: XSheet[]): Blob {
  const enc = new TextEncoder();
  const n = sheets.length;

  const contentTypes = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("")}</Types>`;

  const rootRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbook = `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
    .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("")}</sheets></workbook>`;

  const workbookRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("")}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const entries: Entry[] = [
    { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
    { name: "_rels/.rels", data: enc.encode(rootRels) },
    { name: "xl/workbook.xml", data: enc.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(workbookRels) },
    { name: "xl/styles.xml", data: enc.encode(stylesXml()) },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: enc.encode(sheetXml(s)),
    })),
  ];

  return zip(entries);
}
