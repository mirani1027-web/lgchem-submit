const express = require("express");
const cors = require("cors");
const multer = require("multer");
const sgMail = require("@sendgrid/mail");
const ExcelJS = require("exceljs");
const sanitize = require("sanitize-filename");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

const CAMPUS_INFO = {
  "화치": {
    handlingMaterials: "화치단지 취급 유해화학물질",
    handlingProcess: "㈜엘지화학_화치단지 유해화학물질 취급 전 공정"
  },
  "용성1": {
    handlingMaterials: "용성1단지 취급 유해화학물질",
    handlingProcess: "㈜엘지화학_용성1단지 유해화학물질 취급 전 공정"
  },
  "용성2": {
    handlingMaterials: "용성2단지 취급 유해화학물질",
    handlingProcess: "㈜엘지화학_용성2단지 유해화학물질 취급 전 공정"
  },
  "용성 공통": {
    handlingMaterials: "용성단지 공통 취급 유해화학물질",
    handlingProcess: "㈜엘지화학_용성단지 유해화학물질 취급 전 공정"
  },
  "적량": {
    handlingMaterials: "적량단지 취급 유해화학물질",
    handlingProcess: "㈜엘지화학_적량단지 유해화학물질 취급 전 공정"
  },
  "여수 공통": {
    handlingMaterials: "여수공장 공통 취급 유해화학물질",
    handlingProcess: "㈜엘지화학_여수공장 유해화학물질 취급 전 공정"
  }
};

const FIELD_RULES = {
  businessLicense: { label: "사업자등록증", required: true, maxMB: 1, ext: ["jpg", "jpeg", "png"] },
  vatCertificate: { label: "부가가치세표준증명원", required: true, maxMB: 1, ext: ["jpg", "jpeg", "png"] },
  contract: { label: "계약서", required: true, maxMB: 5, ext: ["pdf"] },
  pledge: { label: "확약서", required: false, maxMB: 1, ext: ["pdf"] },
  manpowerList: { label: "수급인인력명세서", required: true, maxMB: 1, ext: ["pdf"] },
  trainingCertificate: { label: "교육이수증", required: true, maxMB: 20, ext: ["pdf"] },
  employmentCertificate: { label: "재직증명서", required: true, maxMB: 1, ext: ["pdf"] },
  ppeList: { label: "보호구명세서", required: true, maxMB: 1, ext: ["pdf"] },
  ppeCertificate: { label: "보호구인증서", required: true, maxMB: 5, ext: ["pdf", "zip"] }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 9,
    fields: 100,
    parts: 120
  }
});

function yyyymmdd(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function dotDate(iso) {
  if (!iso) return "";
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
  for (const file of reqFiles || []) out[file.fieldname] = file;
  return out;
}

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
    if (!rule.ext.includes(ext)) errors.push(`${rule.label} 확장자 오류: ${ext}. 허용 확장자: ${rule.ext.join(", ")}`);
    if (file.size > rule.maxMB * 1024 * 1024) errors.push(`${rule.label} 용량 초과: 최대 ${rule.maxMB}MB`);
  }
  return errors;
}

function buildSubmission(body, receiptId) {
  let workSteps = [];
  try { workSteps = JSON.parse(body.workStepsJson || "[]"); } catch (_) { workSteps = []; }

  const campus = body.siteArea || "";
  const campusInfo = CAMPUS_INFO[campus] || { handlingMaterials: "", handlingProcess: "" };

  return {
    receiptId,
    groupId: body.groupId || "G01",
    submitDate: yyyymmdd(),
    applicant: process.env.APPLICANT_NAME || body.applicant || "㈜엘지화학(여수)-신학철",
    siteArea: campus,
    handlingMaterials: campusInfo.handlingMaterials,
    handlingProcess: campusInfo.handlingProcess,
    companyName: body.companyName || "",
    ceoName: body.ceoName || "",
    mainPhone: body.mainPhone || "",
    businessRegNo: body.businessRegNo || "",
    contractTitle: body.contractTitle || "",
    workerCount: body.workerCount || "",
    contractStart: body.contractStart || "",
    contractEnd: body.contractEnd || "",
    writerName: body.writerName || "",
    writerEmail: body.writerEmail || "",
    writerPhone: body.writerPhone || "",
    safetyManagerName: body.safetyManagerName || "",
    safetyManagerPosition: body.safetyManagerPosition || "",
    safetyManagerPhone: body.safetyManagerPhone || "",
    workSteps,
    attachmentChecklist: body.attachmentChecklist || ""
  };
}

function applyHeaderStyle(row) {
  row.font = { bold: true };
  row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
  });
}

function applyBodyStyle(ws) {
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: "middle", wrapText: true };
    row.eachCell((cell) => {
      cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
    });
  });
}

async function createSubmissionWorkbook(submission, fileMap) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LG Chem Submit API";
  wb.created = new Date();

  const s1 = wb.addWorksheet("요약(엑셀)");
  s1.addRow(["신고일자", "신고인", "수급인", "도급 내용", "취급물질", "취급공정", "도급시작", "도급종료"]);
  s1.addRow([submission.submitDate, submission.applicant, submission.companyName, submission.contractTitle, submission.handlingMaterials, submission.handlingProcess, submission.contractStart.replaceAll("-", ""), submission.contractEnd.replaceAll("-", "")]);
  s1.columns = [{ width: 12 }, { width: 34 }, { width: 22 }, { width: 34 }, { width: 30 }, { width: 48 }, { width: 12 }, { width: 12 }];
  applyHeaderStyle(s1.getRow(1));
  applyBodyStyle(s1);

  const s2 = wb.addWorksheet("요약(한글)");
  s2.addRow(["순번", "수급사명", "대표자", "도급내용", "취급시설", "도급기간", "인원"]);
  s2.addRow([1, submission.companyName, submission.ceoName, submission.contractTitle, submission.handlingProcess, `${dotDate(submission.contractStart)}~${dotDate(submission.contractEnd)}`, submission.workerCount]);
  s2.columns = [{ width: 8 }, { width: 22 }, { width: 18 }, { width: 34 }, { width: 48 }, { width: 26 }, { width: 10 }];
  applyHeaderStyle(s2.getRow(1));
  applyBodyStyle(s2);

  const s3 = wb.addWorksheet("화학사고예방관리계획서");
  s3.addRow(["업체명", "안전관리자명", "직책", "전화번호", "대표전화번호", "작성자명", "작성자이메일", "작성자연락처", "단지"]);
  s3.addRow([submission.companyName, submission.safetyManagerName, submission.safetyManagerPosition, submission.safetyManagerPhone, submission.mainPhone, submission.writerName, submission.writerEmail, submission.writerPhone, submission.siteArea]);
  s3.columns = [{ width: 24 }, { width: 18 }, { width: 18 }, { width: 20 }, { width: 20 }, { width: 16 }, { width: 28 }, { width: 20 }, { width: 14 }];
  applyHeaderStyle(s3.getRow(1));
  applyBodyStyle(s3);

  const s4 = wb.addWorksheet("작업절차");
  s4.addRow(["단계", "작업명", "세부내용"]);
  for (const step of submission.workSteps || []) s4.addRow([`${step.step}단계`, step.title || "", step.detail || ""]);
  s4.columns = [{ width: 10 }, { width: 30 }, { width: 90 }];
  applyHeaderStyle(s4.getRow(1));
  applyBodyStyle(s4);

  const s5 = wb.addWorksheet("첨부파일목록");
  s5.addRow(["구분", "필수여부", "제출여부", "파일명", "파일크기(MB)", "허용기준", "비고"]);
  for (const [key, rule] of Object.entries(FIELD_RULES)) {
    const file = fileMap[key];
    s5.addRow([rule.label, rule.required ? "필수" : "선택", file ? "제출" : "미제출", file ? file.originalname : "", file ? (file.size / 1024 / 1024).toFixed(2) : "", `${rule.ext.join(", ")} / ${rule.maxMB}MB 이하`, key === "pledge" ? "자동연장 조항 해당 시" : ""]);
  }
  s5.columns = [{ width: 24 }, { width: 10 }, { width: 10 }, { width: 42 }, { width: 14 }, { width: 28 }, { width: 24 }];
  applyHeaderStyle(s5.getRow(1));
  applyBodyStyle(s5);

  return wb.xlsx.writeBuffer();
}

function makeAttachment(file) {
  return { filename: file.originalname, content: file.buffer, contentType: file.mimetype };
}

function toSendGridAttachment(attachment) {
  return {
    content: Buffer.from(attachment.content).toString("base64"),
    filename: attachment.filename,
    type: attachment.contentType || "application/octet-stream",
    disposition: "attachment"
  };
}

app.get("/", (req, res) => {
  res.send("LG Chem contractor submit API is running. Use /health to check status and POST /submit to submit forms.");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.post("/submit", upload.any(), async (req, res) => {
  try {
    if (process.env.SUBMIT_TOKEN && req.body.token !== process.env.SUBMIT_TOKEN) {
      return res.status(403).json({ ok: false, message: "제출 토큰이 올바르지 않습니다." });
    }

    const fileMap = filesByField(req.files);
    const fileErrors = validateFiles(fileMap);
    if (fileErrors.length) return res.status(400).json({ ok: false, message: fileErrors.join(" / ") });

    const receiptId = `${req.body.groupId || "G01"}-${yyyymmdd()}-${Date.now().toString().slice(-6)}`;
    const submission = buildSubmission(req.body, receiptId);
    const company = safeName(submission.companyName);
    const contract = safeName(submission.contractTitle);
    const baseName = `제출정보_${submission.groupId}_${company}_${contract}_${receiptId}`;
    const xlsxBuffer = await createSubmissionWorkbook(submission, fileMap);

    const commonBody = [
      `접수번호: ${receiptId}`,
      `업체명: ${submission.companyName}`,
      `도급내용: ${submission.contractTitle}`,
      `도급기간: ${submission.contractStart} ~ ${submission.contractEnd}`,
      `작성자명/이메일/전화번호: ${submission.writerName} / ${submission.writerEmail} / ${submission.writerPhone}`
    ].join("\n");

    const baseFileKeys = ["businessLicense", "vatCertificate", "contract", "pledge", "manpowerList", "employmentCertificate", "ppeList", "ppeCertificate"];
    const baseAttachments = [
      { filename: `${baseName}.xlsx`, content: xlsxBuffer, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      ...baseFileKeys.filter((key) => fileMap[key]).map((key) => makeAttachment(fileMap[key]))
    ];
    const trainingAttachments = fileMap.trainingCertificate ? [makeAttachment(fileMap.trainingCertificate)] : [];

    const to = process.env.MAIL_TO;
    const from = process.env.MAIL_FROM;
    const sendgridApiKey = process.env.SENDGRID_API_KEY;
    if (!to || !from) throw new Error("MAIL_TO 또는 MAIL_FROM 환경변수가 없습니다.");
    if (!sendgridApiKey) throw new Error("SENDGRID_API_KEY 환경변수가 없습니다.");

    sgMail.setApiKey(sendgridApiKey);

    const [baseMailResponse] = await sgMail.send({
      from,
      to,
      subject: `[${submission.companyName}] 유해화학물질 도급신고 서류 제출의 건 - (1/2 기본서류)`,
      text: commonBody,
      attachments: baseAttachments.map(toSendGridAttachment)
    });

    const [trainingMailResponse] = await sgMail.send({
      from,
      to,
      subject: `[${submission.companyName}] 유해화학물질 도급신고 서류 제출의 건 - (2/2 교육이수증)`,
      text: commonBody,
      attachments: trainingAttachments.map(toSendGridAttachment)
    });

    console.log("SendGrid mails accepted", {
      receiptId,
      baseStatusCode: baseMailResponse.statusCode,
      baseMessageId: baseMailResponse.headers["x-message-id"],
      trainingStatusCode: trainingMailResponse.statusCode,
      trainingMessageId: trainingMailResponse.headers["x-message-id"]
    });

    return res.json({ ok: true, receiptId });
  } catch (err) {
    console.error(err);
    if (err.response && err.response.body) console.error(err.response.body);
    return res.status(500).json({ ok: false, message: err.message || "서버 오류" });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  return res.status(400).json({ ok: false, message: err.message || "요청 처리 오류" });
});

app.listen(PORT, () => {
  console.log(`Submit API listening on ${PORT}`);
});
