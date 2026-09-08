const express = require("express");

const { runDocVerification } = require('./verify.js');

const cors = require("cors");

const multer = require("multer");

const { Resend } = require("resend");

const sanitize = require("sanitize-filename");

const PDFDocument = require("pdfkit");

const path = require("path");

require("dotenv").config();

 

const app = express();

const PORT = process.env.PORT || 3000;

 

/* ===================== CORS ===================== */

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*")

  .split(",").map(s => s.trim()).filter(Boolean);

 

app.use(cors({

  origin: (origin, cb) => {

    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin))

      return cb(null, true);

    return cb(new Error("CORS blocked"));

  }

}));

 

/* ===================== 첨부파일 규칙 ===================== */

const FIELD_RULES = {

  businessLicense:       { label: "사업자등록증",        required: true,  maxMB: 1,  ext: ["jpg","jpeg","png"] },

  vatCertificate:        { label: "부가가치세표준증명원", required: true,  maxMB: 1,  ext: ["jpg","jpeg","png"] },

  contract:              { label: "계약서",               required: true,  maxMB: 5,  ext: ["pdf"] },

  pledge:                { label: "확약서",               required: false, maxMB: 1,  ext: ["pdf"] },

  manpowerList:          { label: "수급인인력명세서",     required: true,  maxMB: 1,  ext: ["pdf"] },

  trainingCertificate:   { label: "교육이수증",           required: true,  maxMB: 20, ext: ["pdf","zip"] },

  employmentCertificate: { label: "재직증명서",           required: true,  maxMB: 1,  ext: ["pdf"] },

  ppeList:               { label: "보호구명세서",         required: true,  maxMB: 1,  ext: ["pdf"] },

  ppeCertificate:        { label: "보호구인증서",         required: true,  maxMB: 5,  ext: ["pdf","zip"] }

};

 

/* ===================== Multer ===================== */

const upload = multer({

  storage: multer.memoryStorage(),

  limits: { fileSize: 20 * 1024 * 1024, files: 9, fields: 120, parts: 140 }

});

 

/* ===================== 유틸 ===================== */

function pad(n) { return String(n).padStart(2, "0"); }

function yyyymmdd(date = new Date()) {

  return `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}`;

}

function dotDate(iso) {

  if (!iso) return "-";

  return String(iso).replaceAll("-", ".");

}

function safeName(value) {

  return sanitize(String(value || "").replace(/\s+/g, "_")).slice(0, 80) || "미입력";

}

function getExt(filename) {

  const parts = String(filename || "").split(".");

  return parts.length > 1 ? parts.pop().toLowerCase() : "";

}

function filesByField(reqFiles) {

  const out = {};

  for (const f of reqFiles || []) out[f.fieldname] = f;

  return out;

}

function formatCurrency(val) {

  const n = Number(String(val || "").replace(/\D/g, ""));

  if (!n && n !== 0) return "-";

  return n.toLocaleString("ko-KR") + "원";

}

 

/* ===================== 파일 유효성 검사 ===================== */

function validateFiles(fileMap) {

  const errors = [];

  for (const [key, rule] of Object.entries(FIELD_RULES)) {

    const file = fileMap[key];

    if (rule.required && !file) { errors.push(`${rule.label} 파일이 없습니다.`); continue; }

    if (!file) continue;

    const ext = getExt(file.originalname);

    if (!rule.ext.includes(ext))

      errors.push(`${rule.label} 확장자 오류: ${ext}. 허용: ${rule.ext.join(", ")}`);

    if (file.size > rule.maxMB * 1024 * 1024)

      errors.push(`${rule.label} 용량 초과: 최대 ${rule.maxMB}MB`);

  }

  return errors;

}

 

/* ===================== submission 객체 빌드 ===================== */

function buildSubmission(body, receiptId) {

  let workSteps = [];

  try { workSteps = JSON.parse(body.workStepsJson || "[]"); } catch (_) {}

  const keyValue = body.keyValue || body.serialNumber || receiptId;

  return {

    receiptId, keyValue,

    submitDate: yyyymmdd(),

    submitDateTime: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),

    companyName:     body.companyName     || "",

    ceoName:         body.ceoName         || "",

    mainPhone:       body.mainPhoneFormatted       || body.mainPhone       || "",

    businessRegNo:   body.businessRegNoFormatted   || body.businessRegNo   || "",

    businessType:    body.businessType    || "",

    mainProduct:     body.mainProduct     || "",

    salesAmount:     body.salesAmountFormatted ? body.salesAmountFormatted : formatCurrency(body.salesAmount),

    establishYear:   body.establishYear   || "",

    businessAddress: body.businessAddress || "",

    businessField:   body.businessField   || "",

    contractTitle:   body.contractTitle   || "",

    contractStart:   body.contractStart   || "",

    workerCount:     body.workerCount     || "",

    handlingMaterials: body.handlingMaterials || "",

    handlingProcess:   body.handlingProcess   || "",

    submitterName:   body.submitterName   || "",

    submitterPhone:  body.submitterPhoneFormatted || body.submitterPhone || "",

    submitterEmail:  body.submitterEmail  || "",

    safetyManagerName:     body.safetyManagerName     || "",

    safetyManagerPosition: body.safetyManagerPosition || "",

    safetyManagerPhone:    body.safetyManagerPhoneFormatted || body.safetyManagerPhone || "",

    workSteps

  };

}

 

/* ===================== 파일명 규칙 ===================== */

const FILE_LABEL_MAP = {

  contract: "계약서", pledge: "확약서", manpowerList: "수급인인력명세서",

  trainingCertificate: "교육이수증", employmentCertificate: "재직증명서",

  ppeList: "보호구명세서", ppeCertificate: "보호구인증서"

};

function makeAttachment(file, keyValue) {

  const ext   = getExt(file.originalname);

  const label = FILE_LABEL_MAP[file.fieldname] || file.fieldname;

  return {

    filename:    `${keyValue}_${label}.${ext}`,

    content:     file.buffer.toString("base64"),

    contentType: file.mimetype

  };

}

 

/* ===================== PDF 공통 ===================== */

function newDoc() {

  const doc = new PDFDocument({ size: "A4", margin: 50 });

  doc.registerFont("Korean", path.join(__dirname, "fonts", "malgun.ttf"));

  doc.font("Korean");

  return doc;

}

 

/* ===================== PDF 1: 수급인 정보 ===================== */

async function createPdf1(s, fileMap) {

  return new Promise((resolve, reject) => {

    const doc = newDoc();

    const chunks = [];

    doc.on("data", c => chunks.push(c));

    doc.on("end",  () => resolve(Buffer.concat(chunks)));

    doc.on("error", reject);

 

    const L     = 50;

    const pageW = 495;

    const ROW_H = 25;

 

    function cell(x, cy, w, h, text, fs = 9) {

      doc.save();

      doc.lineWidth(0.75).rect(x, cy, w, h).stroke("#000");

      doc.restore();

      doc.fontSize(fs);

      const lineH = doc.currentLineHeight(true);

      const textY = cy + (h / 2) - (lineH / 2);

      doc.fillColor("#0f172a")

         .text(String(text || "-"), x + 4, textY,

           { width: w - 8, lineBreak: false, ellipsis: true });

    }

 

    /* 상단 굵은 선 */

    doc.moveTo(L, 60).lineTo(L + pageW, 60).lineWidth(1.25).strokeColor("#000").stroke();

    doc.fontSize(13).fillColor("#0f172a").text("3.  수급인", L, 68);

 

    let y = 100;

    doc.moveTo(L, y).lineTo(L + pageW, y).lineWidth(1.25).stroke();

 

    const c1 = 90, c2 = 130, c3 = 80, c4 = pageW - c1 - c2 - c3;

 

    /* 행1: 업체명 | 값 | 대표자명 | 값 */

    cell(L,          y, c1, ROW_H, "업체명");

    cell(L+c1,       y, c2, ROW_H, s.companyName);

    cell(L+c1+c2,    y, c3, ROW_H, "대표자명");

    cell(L+c1+c2+c3, y, c4, ROW_H, s.ceoName);

    y += ROW_H;

 

    /* 행2: 설립연도 | 값 | 업종 | 값 */

    cell(L,          y, c1, ROW_H, "설립연도");

    cell(L+c1,       y, c2, ROW_H, s.establishYear);

    cell(L+c1+c2,    y, c3, ROW_H, "업종");

    cell(L+c1+c2+c3, y, c4, ROW_H, s.businessType);

    y += ROW_H;

 

    /* 행3: 사업장 주소 */

    cell(L,    y, c1,         ROW_H, "사업장 주소");

    cell(L+c1, y, pageW - c1, ROW_H, s.businessAddress);

    y += ROW_H;

 

    /* 행4: 안전관리 담당자 */

    const sL1=90, sL2=50, sV1=70, sL3=50, sV2=70, sL4=50,

          sV3=pageW-sL1-sL2-sV1-sL3-sV2-sL4;

    cell(L,                          y, sL1, ROW_H, "안전관리 담당자", 9);

    cell(L+sL1,                      y, sL2, ROW_H, "성명",           9);

    cell(L+sL1+sL2,                  y, sV1, ROW_H, s.safetyManagerName, 9);

    cell(L+sL1+sL2+sV1,              y, sL3, ROW_H, "직급",           9);

    cell(L+sL1+sL2+sV1+sL3,         y, sV2, ROW_H, s.safetyManagerPosition, 9);

    cell(L+sL1+sL2+sV1+sL3+sV2,     y, sL4, ROW_H, "연락처",         9);

    cell(L+sL1+sL2+sV1+sL3+sV2+sL4, y, sV3, ROW_H, s.safetyManagerPhone, 9);

    y += ROW_H;

 

    /* 행5~8: 라벨 | 값 */

    const lW = c1, vW = pageW - lW;

    for (const [label, value] of [

      ["임직원수",   s.workerCount + "명"],

      ["사업분야",   s.businessField],

      ["매출액",     s.salesAmount],

      ["주요생산품", s.mainProduct],

    ]) {

      cell(L,      y, lW, ROW_H, label);

      cell(L + lW, y, vW, ROW_H, value);

      y += ROW_H;

    }

 

    /* 주요생산품 아래 굵은 선 */

    doc.moveTo(L, y).lineTo(L + pageW, y).lineWidth(1.25).stroke();

    y += 16;

 

    /* 이미지 제목 행 */

    const halfW = pageW / 2;

    doc.lineWidth(0.75);

    doc.rect(L,         y, halfW, 24).stroke();

    doc.rect(L + halfW, y, halfW, 24).stroke();

    doc.fontSize(10).fillColor("#0f172a")

       .text("사업자등록증",          L,         y + 7, { width: halfW, align: "center" })

       .text("부가가치세과세표준증명", L + halfW, y + 7, { width: halfW, align: "center" });

    y += 24;

 

    /* 이미지 영역 */

    const imgAreaH = doc.page.height - y - 50;

    doc.rect(L,         y, halfW, imgAreaH).stroke();

    doc.rect(L + halfW, y, halfW, imgAreaH).stroke();

 

    if (fileMap["businessLicense"]) {

      try {

        doc.image(fileMap["businessLicense"].buffer,

          L + 5, y + 5, { fit: [halfW - 10, imgAreaH - 10] });

      } catch(_) {}

    }

    if (fileMap["vatCertificate"]) {

      try {

        doc.image(fileMap["vatCertificate"].buffer,

          L + halfW + 5, y + 5, { fit: [halfW - 10, imgAreaH - 10] });

      } catch(_) {}

    }

 

    doc.end();

  });

}

 

/* ===================== PDF 2: 도급계획서 ===================== */

async function createPdf2(s) {

  return new Promise((resolve, reject) => {

    const doc = newDoc();

    const chunks = [];

    doc.on("data", c => chunks.push(c));

    doc.on("end",  () => resolve(Buffer.concat(chunks)));

    doc.on("error", reject);

 

    const L    = 50;

    const pageW = 495;

    const col1  = 160;

    const col2  = pageW - col1;

 

    doc.fontSize(13).fillColor("#0f172a")

       .text("[붙임3]  도급계획서", L, 60);

 

    let y = 100;

 

    /* 상단 굵은 선 */

    doc.moveTo(L, y).lineTo(L + pageW, y).lineWidth(1.25).strokeColor("#000").stroke();

 

    /* 헤더 행 */

    const headerH = 32;

    doc.lineWidth(0.75)

       .moveTo(L + col1, y).lineTo(L + col1, y + headerH).stroke();

    doc.moveTo(L, y + headerH).lineTo(L + pageW, y + headerH).lineWidth(1.25).stroke();

    doc.fontSize(11).fillColor("#0f172a")

       .text("구  분",   L,      y + 10, { width: col1, align: "center" })

       .text("세부내용", L+col1, y + 10, { width: col2, align: "center" });

    y += headerH;

 

    /* 작업절차 텍스트 */

    const processText = (s.workSteps || [])

      .map(st => `${st.step}.  ${st.title}\n    ${st.detail}`)

      .join("\n");

 

    const procBaseH = doc.heightOfString(processText, { width: col2 - 24 });

    const procRowH  = Math.round(Math.max(120, procBaseH + 24) * 1.3);

 

    function autoRow(label, value, minH, centerValue) {

      const th   = doc.heightOfString(String(value || "-"), { width: col2 - 20 });

      const rowH = Math.max(minH, th + 24);

 

      doc.lineWidth(0.75)

         .moveTo(L + col1, y).lineTo(L + col1, y + rowH).stroke();

      doc.moveTo(L, y + rowH).lineTo(L + pageW, y + rowH).stroke();

 

      const labelH = doc.heightOfString(String(label), { width: col1 - 8 });

      doc.fontSize(10).fillColor("#0f172a")

         .text(String(label), L, y + (rowH / 2) - (labelH / 2),

           { width: col1, align: "center" });

 

      if (centerValue) {

        const valH = doc.heightOfString(String(value || "-"), { width: col2 - 20 });

        doc.fontSize(10).fillColor("#0f172a")

           .text(String(value || "-"),

                 L + col1 + 10, y + (rowH / 2) - (valH / 2),

                 { width: col2 - 20, align: "center" });

      } else {

        doc.fontSize(10).fillColor("#0f172a")

           .text(String(value || "-"),

                 L + col1 + 14, y + 14,

                 { width: col2 - 24 });

      }

      y += rowH;

    }

 

    autoRow("수급업체명",                  s.companyName,    40,       true);

    autoRow("도급대상 단위공장명 및 장소", s.handlingProcess, 50,       true);

    autoRow("도급대상 시설·설비·장치 종류", s.handlingProcess, 50,      true);

    autoRow("도급내용",                    s.contractTitle,  40,       true);

    autoRow("대상시설별 작업 프로세스",    processText,      procRowH, false);

    autoRow("도급 사유",

      "전문성을 가진 업체에 도급하여 안전성을 확보하고자 함.", 60, true);

 

    /* 하단 굵은 선 */

    doc.moveTo(L, y).lineTo(L + pageW, y).lineWidth(1.25).stroke();

    y += 24;

 

    /* 별첨 */

    doc.fontSize(10).fillColor("#0f172a")

       .text("2.  수급인이 보유한 개인보호장구 명세서 (별첨1)", L, y);

    y += 30;

    doc.text("3.  수급인의 취급시설 및 인력명세서 (별첨2)", L, y);

 

    doc.end();

  });

}

 

/* ===================== 첨부파일 제출 현황 행 ===================== */

function fileStatusRows(fileMap, keyValue) {

  return Object.entries(FIELD_RULES).map(([key, rule]) => {

    const file = fileMap[key];

    const icon = file ? "✅" : (rule.required ? "❌" : "➖");

    const name = file

      ? `${keyValue}_${rule.label}.${getExt(file.originalname)}`

      : (rule.required ? "미제출" : "해당없음");

    return `

      <tr>

        <td style="padding:7px 12px;border:1px solid #e2e8f0;font-size:13px;color:#334155;">${icon} ${rule.label}</td>

        <td style="padding:7px 12px;border:1px solid #e2e8f0;font-size:12px;color:#64748b;">${name}</td>

      </tr>`;

  }).join("");

}

 

/* ===================== 1/2 메일 HTML ===================== */

function buildHtml1(s, fileMap) {

  const row = (label, value) => `

    <tr>

      <td style="padding:7px 12px;border:1px solid #e2e8f0;background:#f8fafc;font-size:12px;font-weight:700;color:#475569;white-space:nowrap;width:140px;">${label}</td>

      <td style="padding:7px 12px;border:1px solid #e2e8f0;font-size:13px;color:#0f172a;">${value || "-"}</td>

    </tr>`;

  const sec = (title) => `

    <tr>

      <td colspan="2" style="padding:8px 12px;background:#1e3a8a;color:#fff;font-size:12px;font-weight:900;border:1px solid #1e3a8a;">${title}</td>

    </tr>`;

  return `

  <div style="font-family:'Malgun Gothic',Arial,sans-serif;max-width:680px;margin:0 auto;background:#fff;">

    <div style="background:#0f172a;border-radius:12px 12px 0 0;padding:18px 22px;">

      <div style="font-size:11px;color:#93c5fd;font-weight:700;margin-bottom:4px;">도급신고 서류 접수 (1/2 기본서류)</div>

      <div style="font-size:20px;font-weight:900;color:#fff;">[${s.keyValue}] ${s.companyName}</div>

      <div style="font-size:12px;color:#94a3b8;margin-top:4px;">접수일시: ${s.submitDateTime}</div>

    </div>

    <table style="width:100%;border-collapse:collapse;margin-top:0;">

      ${sec("🏢 업체 정보")}

      ${row("업체명", s.companyName)}

      ${row("대표자", s.ceoName)}

      ${row("사업자등록번호", s.businessRegNo)}

      ${row("대표번호", s.mainPhone)}

      ${row("설립연도", s.establishYear)}

      ${row("사업장 주소", s.businessAddress)}

      ${row("사업분야", s.businessField)}

      ${row("업종", s.businessType)}

      ${row("주요 생산품", s.mainProduct)}

      ${row("매출액", s.salesAmount)}

      ${sec("⚙️ 도급 작업 정보")}

      ${row("도급내용(계약서명)", s.contractTitle)}

      ${row("공사시작 예정일", dotDate(s.contractStart))}

      ${row("작업인원", s.workerCount + "명")}

      ${row("취급물질", s.handlingMaterials)}

      ${row("취급공정/시설", s.handlingProcess)}

      ${sec("👤 제출자 정보")}

      ${row("이름", s.submitterName)}

      ${row("전화번호", s.submitterPhone)}

      ${row("이메일", s.submitterEmail)}

      ${sec("🦺 안전관리자")}

      ${row("이름", s.safetyManagerName)}

      ${row("직책", s.safetyManagerPosition)}

      ${row("전화번호", s.safetyManagerPhone)}

      ${sec("📎 첨부파일 제출 현황")}

      ${fileStatusRows(fileMap, s.keyValue)}

    </table>

    ${s.workSteps && s.workSteps.length > 0 ? `

    <div style="margin-top:16px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">

      <div style="background:#0f172a;padding:8px 14px;font-size:12px;font-weight:900;color:#fff;">📋 작업절차</div>

      <table style="width:100%;border-collapse:collapse;">

        <tr>

          <th style="padding:7px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-size:11px;color:#475569;width:70px;">단계</th>

          <th style="padding:7px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-size:11px;color:#475569;width:160px;">작업명</th>

          <th style="padding:7px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-size:11px;color:#475569;">세부내용</th>

        </tr>

        ${s.workSteps.map(step => `

        <tr>

          <td style="padding:7px 12px;border:1px solid #e2e8f0;font-size:12px;color:#1d4ed8;font-weight:700;text-align:center;">${step.step}단계</td>

          <td style="padding:7px 12px;border:1px solid #e2e8f0;font-size:12px;color:#334155;font-weight:700;">${step.title || ""}</td>

          <td style="padding:7px 12px;border:1px solid #e2e8f0;font-size:12px;color:#475569;white-space:pre-line;">${step.detail || ""}</td>

        </tr>`).join("")}

      </table>

    </div>` : ""}

    <div style="display:none;font-size:0;color:transparent;height:0;overflow:hidden;">

[METADATA]

KEY_VALUE: ${s.keyValue}

COMPANY: ${s.companyName}

CONTRACT_NAME: ${s.contractTitle}

START_DATE: ${s.contractStart}

WORKER_COUNT: ${s.workerCount}

SUBMITTER_EMAIL: ${s.submitterEmail}

[/METADATA]

    </div>

    <div style="margin-top:16px;padding:12px 16px;background:#f8fafc;border-radius:0 0 12px 12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;">

      본 메일은 LG화학 여수공장 도급신고 자동접수 시스템에 의해 발송되었습니다.

    </div>

  </div>`;

}

 

/* ===================== 2/2 메일 HTML ===================== */

function buildHtml2(s) {

  return `

  <div style="font-family:'Malgun Gothic',Arial,sans-serif;max-width:680px;margin:0 auto;background:#fff;">

    <div style="background:#0d9488;border-radius:12px 12px 0 0;padding:18px 22px;">

      <div style="font-size:11px;color:#ccfbf1;font-weight:700;margin-bottom:4px;">도급신고 서류 접수 (2/2 교육이수증)</div>

      <div style="font-size:20px;font-weight:900;color:#fff;">[${s.keyValue}] ${s.companyName}</div>

      <div style="font-size:12px;color:#99f6e4;margin-top:4px;">접수일시: ${s.submitDateTime}</div>

    </div>

    <table style="width:100%;border-collapse:collapse;margin-top:0;">

      <tr>

        <td style="padding:7px 12px;border:1px solid #e2e8f0;background:#f8fafc;font-size:12px;font-weight:700;color:#475569;width:140px;">키값</td>

        <td style="padding:7px 12px;border:1px solid #e2e8f0;font-size:13px;color:#0f172a;">${s.keyValue}</td>

      </tr>

      <tr>

        <td style="padding:7px 12px;border:1px solid #e2e8f0;background:#f8fafc;font-size:12px;font-weight:700;color:#475569;">업체명</td>

        <td style="padding:7px 12px;border:1px solid #e2e8f0;font-size:13px;color:#0f172a;">${s.companyName}</td>

      </tr>

      <tr>

        <td style="padding:7px 12px;border:1px solid #e2e8f0;background:#f8fafc;font-size:12px;font-weight:700;color:#475569;">도급내용</td>

        <td style="padding:7px 12px;border:1px solid #e2e8f0;font-size:13px;color:#0f172a;">${s.contractTitle}</td>

      </tr>

      <tr>

        <td style="padding:7px 12px;border:1px solid #e2e8f0;background:#f8fafc;font-size:12px;font-weight:700;color:#475569;">첨부파일</td>

        <td style="padding:7px 12px;border:1px solid #e2e8f0;font-size:13px;color:#0d9488;font-weight:700;">${s.keyValue}_교육이수증</td>

      </tr>

    </table>

    <div style="margin-top:16px;padding:12px 16px;background:#f0fdfa;border-radius:0 0 12px 12px;border-top:1px solid #ccfbf1;font-size:11px;color:#94a3b8;">

      본 메일은 LG화학 여수공장 도급신고 자동접수 시스템에 의해 발송되었습니다.

    </div>

  </div>`;

}

 

/* ===================== 헬스체크 ===================== */

app.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

 

/* ===================== 테스트 메일 ===================== */

app.get("/test-mail", async (req, res) => {

  try {

    const resend = new Resend(process.env.RESEND_API_KEY);

    const result = await resend.emails.send({

      from: process.env.MAIL_FROM,

      to:   process.env.MAIL_TO,

      subject: "Resend 테스트",

      text: "메일 발송 테스트입니다."

    });

    res.json(result);

  } catch (err) {

    console.error(err);

    res.status(500).json({ error: err.message });

  }

});

 

/* ===================== 제출 엔드포인트 ===================== */

app.post("/submit", upload.any(), async (req, res) => {

  try {

    if (process.env.SUBMIT_TOKEN && req.body.token !== process.env.SUBMIT_TOKEN)

      return res.status(403).json({ ok: false, message: "제출 토큰이 올바르지 않습니다." });

 

    const fileMap    = filesByField(req.files);

    const fileErrors = validateFiles(fileMap);

    if (fileErrors.length)

      return res.status(400).json({ ok: false, message: fileErrors.join(" / ") });

 

    const receiptId  = (req.body.keyValue || req.body.serialNumber || `TEMP-${yyyymmdd()}`)

                     + `-${String(Date.now()).slice(-6)}`;

    const submission = buildSubmission(req.body, receiptId);
    const compName = submission.company || req.body.comp || "업체명";
    const kv         = '${submission.keyValue}_${compName}';

 

    if (!process.env.MAIL_TO || !process.env.MAIL_FROM)

      throw new Error("MAIL_TO 또는 MAIL_FROM 환경변수가 없습니다.");

    if (!process.env.RESEND_API_KEY)

      throw new Error("RESEND_API_KEY 환경변수가 없습니다.");

 

    const resend = new Resend(process.env.RESEND_API_KEY);

    const to     = process.env.MAIL_TO;

    const from   = process.env.MAIL_FROM;

 

    /* PDF 생성 */

    const pdf1Buffer = await createPdf1(submission, fileMap);

    const pdf2Buffer = await createPdf2(submission);

 

    /* 첨부파일 */

    const baseFileKeys = ["contract","pledge","manpowerList","employmentCertificate","ppeList","ppeCertificate"];

    const baseAttachments = [

      ...baseFileKeys.filter(k => fileMap[k]).map(k => makeAttachment(fileMap[k], kv)),

      { filename: `${kv}_수급인정보.pdf`,  content: pdf1Buffer.toString("base64"), contentType: "application/pdf" },

      { filename: `${kv}_도급계획서.pdf`,  content: pdf2Buffer.toString("base64"), contentType: "application/pdf" }

    ];

 

    const trainingAttachments = fileMap.trainingCertificate

      ? [makeAttachment(fileMap.trainingCertificate, kv)] : [];

 

    /* 메일 발송 */

    await resend.emails.send({

      from, to,

      subject: `[${kv}] 도급신고 서류 제출 (1/2)`,

      html: buildHtml1(submission, fileMap),

      attachments: baseAttachments

    });

 

    if (trainingAttachments.length > 0) {

      await resend.emails.send({

        from, to,

        subject: `[${kv}] 도급신고 서류 제출 (2/2)`,

        html: buildHtml2(submission),

        attachments: trainingAttachments

      });

    }

 

    return res.json({ ok: true, receiptId, keyValue: kv });

 

  } catch (err) {

    console.error(err);

    return res.status(500).json({ ok: false, message: err.message || "서버 오류" });

  }

});

 

/* ===================== 전역 에러 핸들러 ===================== */

app.use((err, req, res, next) => {

  console.error(err);

  res.status(400).json({ ok: false, message: err.message || "요청 처리 오류" });

});

 

app.listen(PORT, () => console.log(`Submit API listening on ${PORT}`));
