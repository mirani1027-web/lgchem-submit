const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { Resend } = require("resend");
const sanitize = require("sanitize-filename");
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
 
/* ===================== 첨부파일 규칙 ===================== */
const FIELD_RULES = {
  businessLicense:      { label: "사업자등록증",        required: true,  maxMB: 1,  ext: ["jpg","jpeg","png"] },
  vatCertificate:       { label: "부가가치세표준증명원", required: true,  maxMB: 1,  ext: ["jpg","jpeg","png"] },
  contract:             { label: "계약서",               required: true,  maxMB: 5,  ext: ["pdf"] },
  pledge:               { label: "확약서",               required: false, maxMB: 1,  ext: ["pdf"] },
  manpowerList:         { label: "수급인인력명세서",     required: true,  maxMB: 1,  ext: ["pdf"] },
  trainingCertificate:  { label: "교육이수증",           required: true,  maxMB: 20, ext: ["pdf","zip"] },
  employmentCertificate:{ label: "재직증명서",           required: true,  maxMB: 1,  ext: ["pdf"] },
  ppeList:              { label: "보호구명세서",         required: true,  maxMB: 1,  ext: ["pdf"] },
  ppeCertificate:       { label: "보호구인증서",         required: true,  maxMB: 5,  ext: ["pdf","zip"] }
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
 
/* ===================== 유틸 ===================== */
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
 
/* ===================== 파일 유효성 검사 ===================== */
function validateFiles(fileMap) {
  const errors = [];
  for (const [key, rule] of Object.entries(FIELD_RULES)) {
    const file = fileMap[key];
    if (rule.required && !file) {
      errors.push(`${rule.label} 파일이 없습니다.`);
      continue;
    }
    if (!file) continue;
    const ext = getExt(file.originalname);
    if (!rule.ext.includes(ext))
      errors.push(`${rule.label} 확장자 오류: ${ext}. 허용: ${rule.ext.join(", ")}`);
    if (file.size > rule.maxMB * 1024 * 1024)
      errors.push(`${rule.label} 용량 초과: 최대 ${rule.maxMB}MB`);
  }
  return errors;
}
 
/* ===================== submission 객체 빌드 ===================== */
function buildSubmission(body, receiptId) {
  let workSteps = [];
  try { workSteps = JSON.parse(body.workStepsJson || "[]"); } catch (_) {}
 
  const keyValue = body.keyValue || body.serialNumber || receiptId;
 
  return {
    receiptId,
    keyValue,
    submitDate: yyyymmdd(),
    submitDateTime: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
    // 업체 정보
    companyName:     body.companyName     || "",
    ceoName:         body.ceoName         || "",
    mainPhone:       body.mainPhoneFormatted       || body.mainPhone       || "",
    businessRegNo:   body.businessRegNoFormatted   || body.businessRegNo   || "",
    businessType:    body.businessType    || "",
    mainProduct:     body.mainProduct     || "",
    salesAmount:     body.salesAmountFormatted
                       ? body.salesAmountFormatted
                       : formatCurrency(body.salesAmount),
    establishYear:   body.establishYear   || "",
    businessAddress: body.businessAddress || "",
    businessField:   body.businessField   || "",
    // 도급 정보
    contractTitle:     body.contractTitle     || "",
    contractStart:     body.contractStart     || "",
    workerCount:       body.workerCount       || "",
    handlingMaterials: body.handlingMaterials || "",
    handlingProcess:   body.handlingProcess   || "",
    // 제출자
    submitterName:  body.submitterName  || "",
    submitterPhone: body.submitterPhoneFormatted || body.submitterPhone || "",
    submitterEmail: body.submitterEmail || "",
    // 안전관리자
    safetyManagerName:     body.safetyManagerName     || "",
    safetyManagerPosition: body.safetyManagerPosition || "",
    safetyManagerPhone:    body.safetyManagerPhoneFormatted || body.safetyManagerPhone || "",
    // 작업절차
    workSteps
  };
}
 
/* ===================== 파일명 규칙 적용 ===================== */
const FILE_LABEL_MAP = {
  contract:             "계약서",
  pledge:               "확약서",
  manpowerList:         "수급인인력명세서",
  trainingCertificate:  "교육이수증",
  employmentCertificate:"재직증명서",
  ppeList:              "보호구명세서",
  ppeCertificate:       "보호구인증서"
};
 
function makeAttachment(file, keyValue) {
  const ext   = getExt(file.originalname);
  const label = FILE_LABEL_MAP[file.fieldname] || file.fieldname;
  return {
    filename:    `${keyValue}_${label}.${ext}`,
    content:     file.buffer.toString("base64"),
    contentType: file.mimetype
  };
}
 
/* ===================== 첨부파일 제출 현황 행 ===================== */
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
 
/* ===================== 1/2 메일 HTML 본문 ===================== */
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
      <div style="font-size:11px;color:#93c5fd;font-weight:700;margin-bottom:4px;">도급신고 서류 접수 (1/2 기본서류)</div>
      <div style="font-size:20px;font-weight:900;color:#fff;">[${s.keyValue}] ${s.companyName}</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px;">접수일시: ${s.submitDateTime}</div>
    </div>
 
    <table style="width:100%;border-collapse:collapse;margin-top:0;">
      ${sec("🏢 업체 정보")}
      ${row("업체명",         s.companyName)}
      ${row("대표자",         s.ceoName)}
      ${row("사업자등록번호", s.businessRegNo)}
      ${row("대표번호",       s.mainPhone)}
      ${row("설립연도",       s.establishYear)}
      ${row("사업장 주소",    s.businessAddress)}
      ${row("사업분야",       s.businessField)}
      ${row("업종",           s.businessType)}
      ${row("주요 생산품",    s.mainProduct)}
      ${row("매출액",         s.salesAmount)}
 
      ${sec("⚙️ 도급 작업 정보")}
      ${row("도급내용(계약서명)", s.contractTitle)}
      ${row("공사시작 예정일",   dotDate(s.contractStart))}
      ${row("작업인원",          s.workerCount + "명")}
      ${row("취급물질",          s.handlingMaterials)}
      ${row("취급공정/시설",     s.handlingProcess)}
 
      ${sec("👤 제출자 정보")}
      ${row("이름",     s.submitterName)}
      ${row("전화번호", s.submitterPhone)}
      ${row("이메일",   s.submitterEmail)}
 
      ${sec("🦺 안전관리자")}
      ${row("이름",     s.safetyManagerName)}
      ${row("직책",     s.safetyManagerPosition)}
      ${row("전화번호", s.safetyManagerPhone)}
 
      ${sec("📎 첨부파일 제출 현황")}
      ${fileStatusRows(fileMap, s.keyValue)}
    </table>
 
    ${s.workSteps && s.workSteps.length > 0 ? `
    <div style="margin-top:16px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <div style="background:#0f172a;padding:8px 14px;font-size:12px;font-weight:900;color:#fff;">📋 작업절차</div>
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
      본 메일은 LG화학 여수공장 도급신고 자동접수 시스템에 의해 발송되었습니다.
    </div>
  </div>`;
}
 
/* ===================== 2/2 메일 HTML 본문 ===================== */
function buildHtml2(s) {
  return `
  <div style="font-family:'Malgun Gothic',Arial,sans-serif;max-width:680px;margin:0 auto;background:#fff;">
    <div style="background:#0d9488;border-radius:12px 12px 0 0;padding:18px 22px;">
      <div style="font-size:11px;color:#ccfbf1;font-weight:700;margin-bottom:4px;">도급신고 서류 접수 (2/2 교육이수증)</div>
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
      본 메일은 LG화학 여수공장 도급신고 자동접수 시스템에 의해 발송되었습니다.
    </div>
  </div>`;
}
 
/* ===================== 헬스체크 ===================== */
app.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
 
/* ===================== 테스트 메일 ===================== */
app.get("/test-mail", async (req, res) => {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: process.env.MAIL_FROM,
      to:   process.env.MAIL_TO,
      subject: "Resend 테스트",
      text: "메일 발송 테스트입니다."
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
 
/* ===================== 제출 엔드포인트 ===================== */
app.post("/submit", upload.any(), async (req, res) => {
  try {
    /* 토큰 검증 */
    if (process.env.SUBMIT_TOKEN && req.body.token !== process.env.SUBMIT_TOKEN)
      return res.status(403).json({ ok: false, message: "제출 토큰이 올바르지 않습니다." });
 
    /* 파일 유효성 */
    const fileMap = filesByField(req.files);
    const fileErrors = validateFiles(fileMap);
    if (fileErrors.length)
      return res.status(400).json({ ok: false, message: fileErrors.join(" / ") });
 
    /* 접수번호 생성 */
    const receiptId = (req.body.keyValue || req.body.serialNumber || `TEMP-${yyyymmdd()}`)
                    + `-${String(Date.now()).slice(-6)}`;
 
    /* submission 객체 */
    const submission = buildSubmission(req.body, receiptId);
    const kv = submission.keyValue;
 
    /* 환경변수 체크 */
    if (!process.env.MAIL_TO || !process.env.MAIL_FROM)
      throw new Error("MAIL_TO 또는 MAIL_FROM 환경변수가 없습니다.");
    if (!process.env.RESEND_API_KEY)
      throw new Error("RESEND_API_KEY 환경변수가 없습니다.");
 
    const resend = new Resend(process.env.RESEND_API_KEY);
    const to   = process.env.MAIL_TO;
    const from = process.env.MAIL_FROM;
 
    /* 첨부파일 분류 */
    const baseFileKeys = [
      "contract", "pledge", "manpowerList",
      "employmentCertificate", "ppeList", "ppeCertificate"
    ];
    const baseAttachments = baseFileKeys
      .filter(k => fileMap[k])
      .map(k => makeAttachment(fileMap[k], kv));
 
    /* 교육이수증 분리 */
    const trainingAttachments = fileMap.trainingCertificate
      ? [makeAttachment(fileMap.trainingCertificate, kv)]
      : [];
 
    /* 1/2 메일 발송 */
    await resend.emails.send({
      from,
      to,
      subject: `[${kv}] 도급신고 서류 제출 (1/2)`,
      html: buildHtml1(submission, fileMap),
      attachments: baseAttachments
    });
 
    /* 2/2 메일 발송 */
    if (trainingAttachments.length > 0) {
      await resend.emails.send({
        from,
        to,
        subject: `[${kv}] 도급신고 서류 제출 (2/2)`,
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
 
/* ===================== 전역 에러 핸들러 ===================== */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ ok: false, message: err.message || "요청 처리 오류" });
});
 
app.listen(PORT, () => console.log(`Submit API listening on ${PORT}`));
