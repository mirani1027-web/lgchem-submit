const express = require("express");
const cors = require("cors");
const multer = require("multer");
const nodemailer = require("nodemailer");
const ExcelJS = require("exceljs");
const sanitize = require("sanitize-filename");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

/* ✅ CORS 설정 (중요) */
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

/* ✅ 이 줄 추가 (핵심 ⭐⭐⭐) */
app.options("*", cors());

const FIELD_RULES = {
  businessLicense: { label: "사업자등록증", required: true, maxMB: 1, ext: ["jpg", "jpeg", "png"] },
  vatCertificate: { label: "부가가치세표준증명원", required: true, maxMB: 1, ext: ["jpg", "jpeg", "png"] },
  contract: { label: "계약서", required: true, maxMB: 5, ext: ["pdf"] },
  pledge: { label: "확약서", required: false, maxMB: 1, ext: ["pdf"] },
  manpowerList: { label: "수급인인력명세서", required: true, maxMB: 1, ext: ["pdf"] },
  trainingCertificate: { label: "교육이수증", required: true, maxMB: 20, ext: ["pdf", "zip"] },
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
  for (const f of reqFiles || []) out[f.fieldname] = f;
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
    if (!rule.ext.includes(ext)) errors.push(`${rule.label} 확장자 오류: ${ext}`);
    if (file.size > rule.maxMB * 1024 * 1024) errors.push(`${rule.label} 용량 초과`);
  }
  return errors;
}

function buildSubmission(body, receiptId) {
  let workSteps = [];
  try { workSteps = JSON.parse(body.workStepsJson || "[]"); } catch (_) {}

  return {
    receiptId,
    groupId: body.groupId || "G01",
    submitDate: yyyymmdd(),
    applicant: process.env.APPLICANT_NAME || body.applicant,
    companyName: body.companyName || "",
    contractTitle: body.contractTitle || "",
    contractStart: body.contractStart || "",
    contractEnd: body.contractEnd || "",
    workerCount: body.workerCount || "",
    safetyManagerName: body.safetyManagerName || "",
    safetyManagerPhone: body.safetyManagerPhone || "",
    workSteps
  };
}

async function createSubmissionWorkbook(submission) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("요약");

  ws.addRow(["업체명", "도급내용", "기간"]);
  ws.addRow([
    submission.companyName,
    submission.contractTitle,
    `${submission.contractStart}~${submission.contractEnd}`
  ]);

  return wb.xlsx.writeBuffer();
}

