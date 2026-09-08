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

 

async function runDocVerification(files) {

  console.log("=== AI 사전 검증 가동 ===");

 

  if (!ai) {

    return {

      status: "ERROR",

      summary: "서버에 GEMINI_API_KEY가 구성되지 않았습니다.",

      details: ["시스템 구성 오류: API Key 누락"]

    };

  }

 

  const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });

 

  const personnelPdf = fileToGenerativePart(files.personnelList, "application/pdf"); // 수급인인력명세서

  const certsPdf = fileToGenerativePart(files.safetyCerts, "application/pdf");      // 교육이수증

  const gearPdf = fileToGenerativePart(files.protectiveGear, "application/pdf");    // 보호구명세서

  const employmentPdf = fileToGenerativePart(files.employmentCertificate, "application/pdf"); // 재직증명서

 

  if (!personnelPdf || !certsPdf || !gearPdf || !employmentPdf) {

    return {

      status: "FAIL",

      summary: "검증에 필요한 필수 서류 파일 중 일부가 누락되었습니다.",

      details: ["❌ 필수 서류 물리 파일 미생성"]

    };

  }

 

  const prompt = `

    너는 도급신고 서류를 현미경처럼 정밀하게 검토하는 전문 심사관 AI야.

    제공된 [수급인인력명세서], [교육이수증], [보호구명세서], [재직증명서] PDF를 시각적, 텍스트적으로 엄격히 대조하여 교차 검증을 수행하고 결과를 JSON으로만 답변해줘.

 

    [검증 규칙 규칙]

    1. 서류 오첨부 검증 (File Slot Validation):

       - 각 파일 슬롯에 진짜 제 서류가 들어왔는지 검사해라. (예: 수급인인력명세서 슬롯에 엉뚱한 계약서가 업로드되었는지 확인)

    2. 인원수 삼각 대조 (Triple-Count Match):

       - [수급인인력명세서의 총 작업인원수]와 [제출된 교육이수증의 개수(혹은 명단 수)], 그리고 [재직증명서상의 총 인원수]가 모두 일치하는지 대조해라.

    3. 인적사항 1:1 매칭 (Identity Cross-Match):

       - [수급인인력명세서]에 기재된 모든 사람의 [이름, 생년월일]이 각각의 [교육이수증]에 적힌 [이름, 생년월일]과 정확히 일치하는지 1:1로 확인해라.

    4. 교육이수일 유효기간 필터 (3-Year Expiration):

       - 교육이수증에 적힌 수료년도가 최근 3개년(2024년, 2025년, 2026년) 이내인지 검증해라. 2023년 이전 이수증은 기간 만료로 처리해라.

    5. 보호구 수량 적정성 대조 (PPE Count Match):

       - [보호구명세서] 상의 개인보호구(안전모, 안전화 등) 지급 수량이 [수급인인력명세서의 인원수]보다 크거나 같은지 대조해라. 인원수보다 적으면 실패다.

    6. 보호구 사진 칸 이탈 검증 (Layout Overflow Check) [★가장 중요]:

       - [보호구명세서] PDF의 시각적 레이아웃을 정밀 스캔해라.

       - 각 보호구 사진이 표(Table)의 지정된 테두리 칸(Cell) 영역을 벗어나 삐져나와 있거나, 선을 침범하거나, 주변 글자를 가려 조잡하게 배치되어 있다면 반드시 '작성양식 오류'로 감지하고 ppePhotoOverflow를 true로 설정해라.

 

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

      "validationStatus": "PASS", // PASS 또는 FAIL

      "summary": "종합 검증 요약 설명글",

      "details": [

        "✅ [규칙 1] 모든 서류가 제 위치에 올바르게 첨부되었습니다.",

        "✅ [규칙 2] 인원수 삼각 대조 완료 (16명 일치)",

        "❌ [규칙 4] '홍길동'의 교육이수증 수료년도가 2023년으로 유효 기한을 초과하였습니다."

      ],

      "extractedData": {

        "personnelList": [{ "name": "이름", "birth": "생년월일", "certNo": "이수번호" }],

        "safetyCertificates": [{ "name": "이름", "birth": "생년월일", "certNo": "이수번호", "completeYear": "YYYY" }],

        "protectiveGearCount": { "helmets": "수량", "boots": "수량" }

      }

    }

  `;

 

  try {

    const result = await model.generateContent([personnelPdf, certsPdf, gearPdf, employmentPdf, prompt]);

    const responseText = result.response.text();

    const cleanJsonText = responseText.replace(/```json|```/g, "").trim();

    const data = JSON.parse(cleanJsonText);

 

    // AI 자체 판정 및 추가 룰 가공

    let report = {

      status: data.validationStatus === "PASS" ? "PASS" : "FAIL",

      summary: data.summary,

      details: data.details,

      extractedData: data.extractedData

    };

 

    // 보호구 사진 칸 이탈 감지 시 무조건 탈락(FAIL) 처리

    if (data.ppePhotoOverflow) {

      report.status = "FAIL";

      report.summary = "보호구명세서의 사진이 칸을 이탈하여 작성양식 오류가 감지되었습니다.";

      report.details.push(`❌ [양식오류] 보호구 사진 레이아웃 이탈 감지: ${data.ppePhotoOverflowReason}`);

    }

 

    return report;

 

  } catch (error) {

    console.error("Gemini 정밀 사전 검증 중 오류:", error);

    return {

      status: "ERROR",

      message: `AI 분석 연산 오류: ${error.message}`,

      details: ["❌ AI 연산 엔진 충돌"]

    };

  }

}

 

module.exports = { runDocVerification };
