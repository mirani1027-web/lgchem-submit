const { GoogleGenerativeAI } = require("@google/generative-ai"); // 👈 1. 올바른 클래스명으로 수정

const fs = require("fs");

 

// 2. 생성자 호출 방식 수정: 객체 { apiKey: ... } 가 아닌 API Key 문자열을 직접 전달합니다.

const apiKey = process.env.GEMINI_API_KEY;

const ai = apiKey ? new GoogleGenerativeAI(apiKey) : null;

 

// PDF를 Gemini 전송용 Base64로 변환하는 함수

function fileToGenerativePart(path, mimeType) {

  if (!fs.existsSync(path)) {

    console.log(`[AI 검증] 물리 파일 없음: ${path}`);

    return null;

  }

  return {

    inlineData: {

      data: Buffer.from(fs.readFileSync(path)).toString("base64"),

      mimeType

    },

  };

}

 

async function runDocVerification(files) {

  console.log("=== AI 서류 검증 시작 ===");

 

  // API Key 누락 시 안전장치

  if (!ai) {

    console.error("❌ 에러: GEMINI_API_KEY 환경변수가 존재하지 않습니다.");

    return {

      status: "ERROR",

      message: "서버에 AI API Key가 설정되지 않아 자동 검증을 진행할 수 없습니다."

    };

  }

 

  try {

    const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });

 

    // 분석할 PDF 파일들을 안전하게 변환

    const personnelPdf = fileToGenerativePart(files.personnelList, "application/pdf"); // 수급인인력명세서

    const certsPdf = fileToGenerativePart(files.safetyCerts, "application/pdf");      // 교육이수증

    const gearPdf = fileToGenerativePart(files.protectiveGear, "application/pdf");    // 보호구명세서

 

    // 필수 서류가 누락된 경우 즉시 예외 처리하여 서버 다운(254) 방지

    if (!personnelPdf || !certsPdf) {

      return {

        status: "ERROR",

        message: "필수 서류(인력명세서 또는 교육이수증) 파일이 생성되지 않았습니다."

      };

    }

 

    // Gemini 교차 검증용 프롬프트

    const prompt = `

      너는 도급신고 서류를 검증하는 전문 AI야.

      제공된 [수급인인력명세서], [교육이수증], [보호구명세서] PDF 파일들을 분석해서 교차 검증에 필요한 아래 데이터들을 정확히 추출해줘.

    

      반드시 아래 JSON 형식으로만 답변해야 해. 다른 설명이나 텍스트(예: \`\`\`json)는 일절 포함하지 마.

    

      {

        "personnelList": [

          { "name": "이름", "birth": "생년월일(YYMMDD)", "certNo": "이수번호" }

        ],

        "safetyCertificates": [

          { "name": "이름", "birth": "생년월일(YYMMDD)", "certNo": "이수번호", "completeYear": "교육이수연도(YYYY)" }

        ],

        "protectiveGearCount": {

          "helmets": "안전모수량(숫자만)",

          "boots": "안전화수량(숫자만)"

        }

      }

    `;

 

    // API 호출 전송

    const result = await model.generateContent([prompt, personnelPdf, certsPdf, gearPdf].filter(Boolean));

    const responseText = result.response.text();

    

    // JSON 데이터 정제 및 파싱

    const cleanJsonText = responseText.replace(/```json|```/g, "").trim();

    const data = JSON.parse(cleanJsonText);

 

    // 5대 룰 엔진 실행 후 리포트 반환

    return executeValidationRules(data);

 

  } catch (error) {

    console.error("Gemini 검증 중 치명적 에러 발생:", error);

    return {

      status: "ERROR",

      message: `AI 분석 연산 오류: ${error.message}`

    };

  }

}

 

// 5대 룰 검증 알고리즘

function executeValidationRules(data) {

  let report = {

    status: "PASS",

    summary: "모든 서류가 정상 검증되었습니다.",

    details: []

  };

 

  const pList = data.personnelList || [];

  const cList = data.safetyCertificates || [];

  const gear = data.protectiveGearCount || { helmets: 0, boots: 0 };

  const currentYear = new Date().getFullYear();

 

  // 규칙 1: 명세서 인원과 이수증 개수 일치 여부

  if (pList.length !== cList.length) {

    report.status = "FAIL";

    report.details.push(`❌ [규칙 1] 명세서 인원(${pList.length}명)과 제출된 이수증 개수(${cList.length}개)가 불일치합니다.`);

  } else {

    report.details.push(`✅ [규칙 1] 인원 및 이수증 수량 일치 확인 (${pList.length}명)`);

  }

 

  // 규칙 2: 인적사항 1:1 교차 매칭 (이름, 생년월일, 이수번호)

  pList.forEach(p => {

    const match = cList.find(c => c.name === p.name && c.birth === p.birth);

    if (!match) {

      report.status = "FAIL";

      report.details.push(`❌ [규칙 2] 명세서의 '${p.name}(${p.birth})'와 일치하는 교육이수증이 없습니다.`);

    } else if (match.certNo !== p.certNo) {

      report.status = "FAIL";

      report.details.push(`❌ [규칙 2] '${p.name}'의 이수번호가 다릅니다. (명세서: ${p.certNo} vs 이수증: ${match.certNo})`);

    } else {

      report.details.push(`✅ [규칙 2] '${p.name}' 인적사항 및 이수번호 교차 검증 완료`);

    }

  });

 

  // 규칙 3: 교육이수연도 3개년 검증

  cList.forEach(c => {

    const year = parseInt(c.completeYear);

    if (isNaN(year) || year < currentYear - 2 || year > currentYear) {

      report.status = "FAIL";

      report.details.push(`❌ [규칙 3] '${c.name}'의 교육이수일(${c.completeYear}년)은 유효 기간(최근 3개년)을 초과했습니다.`);

    } else {

      report.details.push(`✅ [규칙 3] '${c.name}' 교육이수일 유효성 통과 (${c.completeYear}년)`);

    }

  });

 

  // 규칙 4: 보호구 수량 검증 (안전모 수량 >= 인원수)

  const helmetCount = parseInt(gear.helmets) || 0;

  if (helmetCount < pList.length) {

    report.status = "FAIL";

    report.details.push(`❌ [규칙 4] 보호구(안전모) 수량이 인원보다 부족합니다. (인원: ${pList.length}명, 안전모: ${helmetCount}개)`);

  } else {

    report.details.push(`✅ [규칙 4] 보호구 수량 적정성 통과 (안전모: ${helmetCount}개)`);

  }

 

  if (report.status === "FAIL") {

    report.summary = "일부 서류에 누락 또는 검증 실패 항목이 존재합니다. 보완이 필요합니다.";

  }

 

  return report;

}

 

module.exports = { runDocVerification };
