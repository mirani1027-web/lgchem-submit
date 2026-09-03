
const express = require("express");

const cors = require("cors");

const multer = require("multer");

const { Resend } = require("resend");

const sanitize = require("sanitize-filename");

const PDFDocument = require("pdfkit");

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

  businessLicense:      { label: "사업자등록증",        required: true,  maxMB: 1,  ext: ["jpg","jpeg","png"] },

  vatCertificate:       { label: "부가가치세표준증명원", required: true,  maxMB: 1,  ext: ["jpg","jpeg","png"] },

  contract:             { label: "계약서",               required: true,  maxMB: 5,  ext: ["pdf"] },

  pledge:               { label: "확약서",               required: false, maxMB: 1,  ext: ["pdf"] },

  manpowerList:         { label: "수급인인력명세서",     required: true,  maxMB: 1,  ext: ["pdf"] },

  trainingCertificate:  { label: "교육이수증",           required: true,  maxMB: 20, ext: ["pdf","zip"] },

  employmentCertificate:{ label: "재직증명서",           required: true,  maxMB: 1,  ext: ["pdf"] },

  ppeList:              { label: "보호구명세서",         required: true,  maxMB: 1,  ext: ["pdf"] },

  ppeCertificate:       { label: "보호구인증서",         required: true,  maxMB: 5,  ext: ["pdf","zip"] }

};

 

/* ===================== Multer ===================== */

const upload = multer({

  storage: multer.memoryStorage(),

  limits: {

    fileSize: 20 * 1024 * 1024,

    files: 9,

    fields: 120,

    parts: 140

  }

});

 

/* ===================== 유틸 ===================== */

function pad(n) { return String(n).padStart(2, "0"); }

 

function yyyymmdd(date = new Date()) {

  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;

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

    if (rule.required && !file) {

      errors.push(`${rule.label} 파일이 없습니다.`);

      continue;

    }

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

    receiptId,

    keyValue,

    submitDate: yyyymmdd(),

    submitDateTime: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),

    companyName:     body.companyName     || "",

    ceoName:         body.ceoName         || "",

    mainPhone:       body.mainPhoneFormatted       || body.mainPhone       || "",

    businessRegNo:   body.businessRegNoFormatted   || body.businessRegNo   || "",

    businessType:    body.businessType    || "",

    mainProduct:     body.mainProduct     || "",

    salesAmount:     body.salesAmountFormatted

                       ? body.salesAmountFormatted

                       : formatCurrency(body.salesAmount),

    establishYear:   body.establishYear   || "",

    businessAddress: body.businessAddress || "",

    businessField:   body.businessField   || "",

    contractTitle:     body.contractTitle     || "",

    contractStart:     body.contractStart     || "",

    workerCount:       body.workerCount       || "",

    handlingMaterials: body.handlingMaterials || "",

    handlingProcess:   body.handlingProcess   || "",

    submitterName:  body.submitterName  || "",

    submitterPhone: body.submitterPhoneFormatted || body.submitterPhone || "",

    submitterEmail: body.submitterEmail || "",

    safetyManagerName:     body.safetyManagerName     || "",

    safetyManagerPosition: body.safetyManagerPosition || "",

    safetyManagerPhone:    body.safetyManagerPhoneFormatted || body.safetyManagerPhone || "",

    workSteps

  };

}

 

/* ===================== 파일명 규칙 ===================== */

const FILE_LABEL_MAP = {

  contract:             "계약서",

  pledge:               "확약서",

  manpowerList:         "수급인인력명세서",

  trainingCertificate:  "교육이수증",

  employmentCertificate:"재직증명서",

  ppeList:              "보호구명세서",

  ppeCertificate:       "보호구인증서"

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

 

/* ===================== PDF 유틸 ===================== */

function streamToBuffer(stream) {

  return new Promise((resolve, reject) => {

    const chunks = [];

    stream.on("data", chunk => chunks.push(chunk));

    stream.on("end", () => resolve(Buffer.concat(chunks)));

    stream.on("error", reject);

  });

}

 

function newDoc() {

  const doc = new PDFDocument({ size: "A4", margin: 50 });

  doc.registerFont("Korean", "./fonts/malgun.ttf");

  doc.font("Korean");

  return doc;

}

 

/* ===================== PDF 공통: 표 행 그리기 ===================== */

function drawTableRow(doc, y, col1W, col2W, label, value, rowH = 26) {

  // 라벨 셀

  doc.rect(50, y, col1W, rowH).stroke();

  doc.fontSize(9).fillColor("#475569")

     .text(label, 54, y + 8, { width: col1W - 8, lineBreak: false });

 

  // 값 셀

  doc.rect(50 + col1W, y, col2W, rowH).stroke();

  doc.fontSize(9).fillColor("#0f172a")

     .text(String(value || "-"), 54 + col1W, y + 8, { width: col2W - 8, lineBreak: false });

 

  return y + rowH;

}

 

/* ===================== PDF 공통: 섹션 헤더 ===================== */

function drawSectionHeader(doc, y, width, title) {

  doc.rect(50, y, width, 22).fill("#1e3a8a");

  doc.fontSize(10).fillColor("#ffffff")

     .text(title, 54, y + 6, { width: width - 8, lineBreak: false });

  doc.fillColor("#0f172a");

  return y + 22;

}

 

/* ===================== PDF 1: 수급인 정보 ===================== */

async function createPdf1(s, fileMap) {

  const doc = newDoc();

  const buf = streamToBuffer(doc);

 

  const pageW = doc.page.width - 100; // 양쪽 마진 50씩

  const col1  = 130;

  const col2  = pageW - col1;

 

  // 제목

  doc.fontSize(14).fillColor("#0f172a")

     .text("3. 수급인", 50, 50);

 

  let y = 80;

 

  // 섹션: 업체 정보

  y = drawSectionHeader(doc, y, pageW, "업체 기본정보");

  y = drawTableRow(doc, y, col1, col2, "업체명",         s.companyName);

  y = drawTableRow(doc, y, col1, col2, "대표자",         s.ceoName);

  y = drawTableRow(doc, y, col1, col2, "설립연도",       s.establishYear + "년");

  y = drawTableRow(doc, y, col1, col2, "업종",           s.businessType);

  y = drawTableRow(doc, y, col1, col2, "사업장 주소",    s.businessAddress);

  y = drawTableRow(doc, y, col1, col2, "사업분야",       s.businessField);

  y = drawTableRow(doc, y, col1, col2, "매출액",         s.salesAmount);

  y = drawTableRow(doc, y, col1, col2, "주요 생산품",    s.mainProduct);

  y = drawTableRow(doc, y, col1, col2, "작업인원",       s.workerCount + "명");

 

  // 안전관리자 행 (3분할)

  y = drawSectionHeader(doc, y + 8, pageW, "안전관리 담당자");

  const third = pageW / 3;

 

  doc.rect(50,           y, third, 26).stroke();

  doc.rect(50 + third,   y, third, 26).stroke();

  doc.rect(50 + third*2, y, third, 26).stroke();

 

  doc.fontSize(9).fillColor("#475569")

     .text("성명", 54, y + 8, { width: 40, lineBreak: false });

  doc.fillColor("#0f172a")

     .text(s.safetyManagerName || "-", 54 + 30, y + 8, { width: third - 38, lineBreak: false });

 

  doc.fillColor("#475569")

     .text("직급", 54 + third, y + 8, { width: 40, lineBreak: false });

  doc.fillColor("#0f172a")

     .text(s.safetyManagerPosition || "-", 54 + third + 30, y + 8, { width: third - 38, lineBreak: false });

 

  doc.fillColor("#475569")

     .text("연락처", 54 + third*2, y + 8, { width: 40, lineBreak: false });

  doc.fillColor("#0f172a")

     .text(s.safetyManagerPhone || "-", 54 + third*2 + 40, y + 8, { width: third - 48, lineBreak: false });

 

  y += 34;

 

  // 이미지 2칸 영역

  const imgAreaH = 280;

  const halfW    = pageW / 2;

 

  doc.rect(50,          y, halfW, imgAreaH).stroke();

  doc.rect(50 + halfW,  y, halfW, imgAreaH).stroke();

 

  // 이미지 제목

  doc.fontSize(10).fillColor("#1e3a8a")

     .text("사업자등록증",         50,          y + 8, { width: halfW, align: "center" })

     .text("부가가치세표준증명원", 50 + halfW,  y + 8, { width: halfW, align: "center" });

 

  // 실제 이미지 삽입

  const pad2 = 20;

  const imgW  = halfW - pad2 * 2;

  const imgH  = imgAreaH - 30;

 

  if (fileMap["businessLicense"]) {

    try {

      doc.image(fileMap["businessLicense"].buffer,

        50 + pad2, y + 24,

        { width: imgW, height: imgH, fit: [imgW, imgH] }

      );

    } catch(_) {}

  }

  if (fileMap["vatCertificate"]) {

    try {

      doc.image(fileMap["vatCertificate"].buffer,

        50 + halfW + pad2, y + 24,

        { width: imgW, height: imgH, fit: [imgW, imgH] }

      );

    } catch(_) {}

  }

 

  doc.end();

  return buf;

}

 

/* ===================== PDF 2: 도급계획서 ===================== */

async function createPdf2(s) {

  const doc = newDoc();

  const buf = streamToBuffer(doc);

 

  const pageW = doc.page.width - 100;

  const col1  = 160;

  const col2  = pageW - col1;

 

  // 제목

  doc.fontSize(13).fillColor("#0f172a")

     .text("[붙임3] 도급계획서", 50, 50, { width: pageW, align: "center" });

 

  let y = 90;

 

  // 작업절차 텍스트 변환

  const processText = (s.workSteps || [])

    .map(step => `${step.step}. ${step.title}\n   ${step.detail}`)

    .join("\n");

 

  // 일반 행 (높이 자동 계산)

  function drawAutoRow(label, value) {

    const textH = doc.heightOfString(String(value || "-"), { width: col2 - 16 });

    const rowH  = Math.max(32, textH + 16);

 

    doc.rect(50,          y, col1,  rowH).stroke();

    doc.rect(50 + col1,   y, col2,  rowH).stroke();

 

    doc.fontSize(9).fillColor("#475569")

       .text(label, 54, y + (rowH / 2) - 6, { width: col1 - 8, lineBreak: false });

 

    doc.fontSize(9).fillColor("#0f172a")

       .text(String(value || "-"), 54 + col1, y + 8, { width: col2 - 16 });

 

    y += rowH;

  }

 

  drawAutoRow("수급업체명",                s.companyName);

  drawAutoRow("도급대상 단위공장명 및 장소", s.handlingProcess);

  drawAutoRow("도급대상 시설·설비·장치 종류", s.handlingProcess);

  drawAutoRow("도급내용",                  s.contractTitle);

  drawAutoRow("대상시설별 작업 프로세스",  processText);

  drawAutoRow("도급 사유",                 "전문성을 가진 업체에 도급하여 안전성을 확보하고자 함.");

 

  doc.end();

  return buf;

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

 

/* ===================== 1/2 메일 HTML 본문 ===================== */

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

      ${row("업체명",         s.companyName)}

      ${row("대표자",         s.ceoName)}

      ${row("사업자등록번호", s.businessRegNo)}

      ${row("대표번호",       s.mainPhone)}

      ${row("설립연도",       s.establishYear)}

      ${row("사업장 주소",    s.businessAddress)}

      ${row("사업분야",       s.businessField)}

      ${row("업종",           s.businessType)}

      ${row("주요 생산품",    s.mainProduct)}

      ${row("매출액",         s.salesAmount)}

 

      ${sec("⚙️ 도급 작업 정보")}

      ${row("도급내용(계약서명)", s.contractTitle)}

      ${row("공사시작 예정일",   dotDate(s.contractStart))}

      ${row("작업인원",          s.workerCount + "명")}

      ${row("취급물질",          s.handlingMaterials)}

      ${row("취급공정/시설",     s.handlingProcess)}

 

      ${sec("👤 제출자 정보")}

      ${row("이름",     s.submitterName)}

      ${row("전화번호", s.submitterPhone)}

      ${row("이메일",   s.submitterEmail)}

 

      ${sec("🦺 안전관리자")}

      ${row("이름",     s.safetyManagerName)}

      ${row("직책",     s.safetyManagerPosition)}

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

 

/* ===================== 2/2 메일 HTML 본문 ===================== */

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

    /* 토큰 검증 */

    if (process.env.SUBMIT_TOKEN && req.body.token !== process.env.SUBMIT_TOKEN)

      return res.status(403).json({ ok: false, message: "제출 토큰이 올바르지 않습니다." });

 

    /* 파일 유효성 */

    const fileMap = filesByField(req.files);

    const fileErrors = validateFiles(fileMap);

    if (fileErrors.length)

      return res.status(400).json({ ok: false, message: fileErrors.join(" / ") });

 

    /* 접수번호 생성 */

    const receiptId = (req.body.keyValue || req.body.serialNumber || `TEMP-${yyyymmdd()}`)

                    + `-${String(Date.now()).slice(-6)}`;

 

    /* submission 객체 */

    const submission = buildSubmission(req.body, receiptId);

    const kv = submission.keyValue;

 

    /* 환경변수 체크 */

    if (!process.env.MAIL_TO || !process.env.MAIL_FROM)

      throw new Error("MAIL_TO 또는 MAIL_FROM 환경변수가 없습니다.");

    if (!process.env.RESEND_API_KEY)

      throw new Error("RESEND_API_KEY 환경변수가 없습니다.");

 

    const resend = new Resend(process.env.RESEND_API_KEY);

    const to   = process.env.MAIL_TO;

    const from = process.env.MAIL_FROM;

 

    /* PDF 생성 */

    const pdf1Buffer = await createPdf1(submission, fileMap);

    const pdf2Buffer = await createPdf2(submission);

 

    /* 첨부파일 분류 */

    const baseFileKeys = [

      "contract", "pledge", "manpowerList",

      "employmentCertificate", "ppeList", "ppeCertificate"

    ];

    const baseAttachments = [

      ...baseFileKeys

        .filter(k => fileMap[k])

        .map(k => makeAttachment(fileMap[k], kv)),

      {

        filename:    `${kv}_수급인정보.pdf`,

        content:     pdf1Buffer.toString("base64"),

        contentType: "application/pdf"

      },

      {

        filename:    `${kv}_도급계획서.pdf`,

        content:     pdf2Buffer.toString("base64"),

        contentType: "application/pdf"

      }

    ];

 

    /* 교육이수증 분리 */

    const trainingAttachments = fileMap.trainingCertificate

      ? [makeAttachment(fileMap.trainingCertificate, kv)]

      : [];

 

    /* 1/2 메일 발송 */

    await resend.emails.send({

      from,

      to,

      subject: `[${kv}] 도급신고 서류 제출 (1/2)`,

      html: buildHtml1(submission, fileMap),

      attachments: baseAttachments

    });

 

    /* 2/2 메일 발송 */

    if (trainingAttachments.length > 0) {

      await resend.emails.send({

        from,

        to,

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

 
