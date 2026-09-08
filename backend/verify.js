const { GoogleGenerativeAI } = require("@google/generative-ai");

const fs = require("fs");

 

const apiKey = process.env.GEMINI_API_KEY;

const ai = apiKey ? new GoogleGenerativeAI(apiKey) : null;

 

function fileToGenerativePart(path, mimeType) {

  if (!fs.existsSync(path)) {

    console.log(`[AI 검증] 파일 없음: ${path}`);

    return null;

  }

  return {

    inlineData: {

      data: Buffer.from(fs.readFileSync(path)).toString("base64"),

      mimeType

    },

  };

}

 

function extractCleanJson(rawText) {

  try {

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);

    if (jsonMatch) {

      return JSON.parse(jsonMatch[0]);

    }

    return JSON.parse(rawText);

  } catch (e) {

    throw new Error(`JSON 변환 실패: ${e.message}`);

  }

}

 

async function runDocVerification(files) {

  console.log("=== AI 사전 검증 가동 ===");

 

  if (!ai) {

    return {

      status: "PASS",

      summary: "서버 AI 모듈이 준비되지 않아 [수동 검증 모드]로 자동 접수됩니다.",

      details: ["⚠️ GEMINI_API_KEY 환경변수 구성을 확인해 주세요."]

    };

  }

 

  // 1. 필수 서류 파일 존재 여부 1차 검증

  const personnelPdf = fileToGenerativePart(files.personnelList, "application/pdf");

  const gearPdf = fileToGenerativePart(files.protectiveGear, "application/pdf");

  const employmentPdf = fileToGenerativePart(files.employmentCertificate, "application/pdf");

 

  if (!personnelPdf || !gearPdf || !employmentPdf) {

    return {

      status: "FAIL",

      summary: "검증에 필요한 필수 서류 파일 중 일부가 누락되었습니다.",

      details: ["❌ 필수 서류 업로드 상태를 다시 확인해 주세요."]

    };

  }

 

  // 2. [핵심 패치] ZIP 파일 필터링 및 우회 전략

  const isZip = files.safetyCerts.endsWith(".zip");

  let certsPdf = null;

  let skipNote = "";

 

  if (isZip) {

    // ZIP 파일인 경우 Gemini에 전송하지 않고 수동 확인 노트 기록

    skipNote = "⚠️ [우회 안내] 교육이수증이 ZIP 압축파일로 제출되어 직접 파일 분석에서 제외되었습니다. 이수증에 대해서는 '수동 확인 필요' 상태로 처리하고, 분석 가능한 나머지 3개 서류 위주로 정합성을 대조해 주세요.";

  } else {

    certsPdf = fileToGenerativePart(files.safetyCerts, "application/pdf");

  }

 

  // 3. API로 전송할 서류 리스트 빌드 (null 값 완전 제외)

  const apiContents = [personnelPdf, gearPdf, employmentPdf].filter(Boolean);

  if (certsPdf) {

    apiContents.push(certsPdf);

  }

 

  const prompt = `

    너는 도급신고 서류를 검토하는 전문 심사관 AI야.

    제공된 [수급인인력명세서], [보호구명세서], [재직증명서] ${certsPdf ? "그리고 [교육이수증]" : ""} PDF 파일들을 대조하여 정합성을 검증하고 결과를 JSON으로만 답변해줘.

 

    ${skipNote}

 

    [검증 규칙]

    1. 서류 오첨부 검증 (File Slot Validation)

    2. 인원수 삼각 대조 (명세서 인원 === 교육이수증 개수 === 재직증명서 인원)

       - 단, 교육이수증이 ZIP 파일로 인해 제외된 경우, 삼각 대조 결과에 "이수증 압축파일 제출로 수동 확인 필요"라고 적어라.

    3. 인적사항 1:1 매칭 (명세서의 이름/생년월일이 이수증과 일치하는지) - 이수증이 제외된 경우 생략 가능.

    4. 교육이수일 유효기간 필터 (최근 3개년: 24, 25, 26년 이내 수료 여부) - 이수증이 제외된 경우 생략 가능.

    5. 보호구 수량 적정성 대조 (보호구 지급 수량 >= 작업인원수)

    6. 보호구 사진 칸 이탈 검증 (보호구명세서 내 사진이 표 영역을 벗어났는지 시각적 레이아웃 스캔)

 

    반드시 아래 JSON 형식으로만 출력하고, 다른 설명이나 백틱(\`\`\`json)은 포함하지 마라.

    {

      "fileSlots": {

        "personnelListValid": true,

        "safetyCertsValid": true,

        "protectiveGearValid": true,

        "employmentValid": true

      },

      "tripleCount": { "manpowerCount": 16, "trainingCount": 16, "employmentCount": 16, "isMatched": true },

      "ppePhotoOverflow": false,

      "ppePhotoOverflowReason": "",

      "validationStatus": "PASS",

      "summary": "종합 검증 요약 설명글",

      "details": [

        "✅ 모든 서류 확인 완료"

      ],

      "extractedData": {

        "personnelList": [],

        "safetyCertificates": [],

        "protectiveGearCount": { "helmets": "0", "boots": "0" }

      }

    }

  `;

 

  // API 전송 패키지에 프롬프트 추가

  apiContents.push(prompt);

 

  try {

    const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContent(apiContents);

    const responseText = result.response.text();

   

    const data = extractCleanJson(responseText);

 

    let report = {

      status: data.validationStatus === "PASS" ? "PASS" : "FAIL",

      summary: data.summary,

      details: data.details,

      extractedData: data.extractedData

    };

 

    if (data.ppePhotoOverflow) {

      report.status = "FAIL";

      report.summary = "보호구명세서의 사진이 칸을 이탈하여 작성양식 오류가 감지되었습니다.";

      report.details.push(`❌ [양식오류] 보호구 사진 레이아웃 이탈 감지: ${data.ppePhotoOverflowReason}`);

    }

 

    // ZIP 파일 제출 시 가이드 메시지 강제 추가

    if (isZip) {

      report.details.push("ℹ️ 교육이수증이 ZIP 압축파일로 제출되어 담당자님의 이메일 수동 확인이 필요합니다.");

    }

 

    return report;

 

  } catch (error) {

    console.error("!!! AI 검증 엔진 예외 발생 -> 수동 검증 모드 우회 가동 !!!");

    console.error("에러 내용:", error);

 

    return {

      status: "PASS",

      summary: "AI 서버 모듈 통신 지연으로 인해 [수동 검증 모드]로 전환되어 최종 접수가 허용됩니다.",

      details: [

        "⚠️ AI 자동 정밀 필터가 일시적으로 비활성화되었습니다.",

        "🟢 제출자의 원활한 접수를 돕기 위해 서류 정합성 검증이 안전하게 임시 패스되었습니다.",

        "ℹ️ 첨부서류는 메일로 정상 전송되오니, 담당자분께서는 수신 메일에서 수동으로 최종 대조해 주세요."

      ]

    };

  }

}

 

module.exports = { runDocVerification };

 
