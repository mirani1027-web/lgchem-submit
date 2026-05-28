# LG화학 여수공장 도급신고 제출 시스템 - GitHub Pages + Render API

이 패키지는 다음 2개로 구성됩니다.

- `frontend/index.html`: GitHub Pages에 올릴 협력업체 작성 화면
- `backend/server.js`: Render Web Service에 올릴 제출 수신 API

## 동작 흐름

```text
협력업체 → GitHub Pages HTML 작성/첨부 → Render API 제출 → 담당자 이메일 2개로 분할 발송
```

Render API는 제출 시 자동으로 `제출정보.xlsx`를 생성합니다.

`제출정보.xlsx` 시트 구성:

```text
Sheet1 = 요약(엑셀)
Sheet2 = 요약(한글)
Sheet3 = 화학사고예방관리계획서
Sheet4 = 작업절차
Sheet5 = 첨부파일목록
```

## 1. GitHub 업로드

GitHub 저장소 구조 예시:

```text
repo/
  frontend/
    index.html
  backend/
    server.js
    package.json
    .env.example
```

GitHub Pages는 `frontend/index.html`을 배포 대상으로 사용하세요.

가장 단순한 방법은 `frontend/index.html`을 저장소 root의 `index.html`로 복사해서 GitHub Pages를 켜는 것입니다.

## 2. Render 배포

Render에서 Web Service를 생성합니다.

- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`
- Environment: Node

Render 환경변수는 `.env.example` 내용을 기준으로 입력합니다.

필수 환경변수:

```text
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASS
MAIL_FROM
MAIL_TO
SUBMIT_TOKEN
APPLICANT_NAME
ALLOWED_ORIGINS
```

## 3. HTML의 API 주소 변경

`frontend/index.html` 상단의 Render API URL 입력칸에 실제 Render 주소를 입력해서 테스트합니다.

운영용으로는 아래 값을 코드에 고정하고 입력칸을 숨기는 방식으로 바꿀 수 있습니다.

```text
https://your-service.onrender.com/submit
```

## 4. 메일 분할 기준

Render API는 메일을 2개로 보냅니다.

```text
[1/2 기본서류]
- 제출정보.xlsx
- 제출정보.json
- 사업자등록증
- 부가가치세표준증명원
- 계약서
- 확약서
- 수급인인력명세서
- 재직증명서
- 보호구명세서
- 보호구인증서

[2/2 교육이수증]
- 교육이수증
```

## 5. 파일 제한

HTML과 Render API 양쪽에 같은 제한을 적용했습니다.

```text
사업자등록증: 1MB, jpg/jpeg/png
부가가치세표준증명원: 1MB, jpg/jpeg/png
계약서: 5MB, pdf
확약서: 1MB, pdf
수급인인력명세서: 1MB, pdf
교육이수증: 20MB, pdf/zip
재직증명서: 1MB, pdf
보호구명세서: 1MB, pdf
보호구인증서: 5MB, pdf/zip
```

## 6. 주의사항

- Render 무료 Web Service는 15분 동안 요청이 없으면 sleep 상태가 될 수 있습니다.
- Render 무료 Web Service의 로컬 파일시스템은 영구 저장소가 아닙니다.
- 이 API는 파일을 로컬에 저장하지 않고, 메모리에서 이메일 첨부로 바로 전송합니다.
- 운영 전 SMTP 발송 용량 제한과 회사 보안정책을 확인하세요.
