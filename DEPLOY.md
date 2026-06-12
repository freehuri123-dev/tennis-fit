# ServeFit Vercel 배포 준비

## 필요한 Vercel 리소스

1. Neon Postgres
   - Vercel Marketplace에서 Neon을 추가합니다.
   - `DATABASE_URL` 환경변수가 프로젝트에 연결되어야 합니다.
   - 앱이 처음 저장 API를 호출할 때 `serve_reports` 테이블을 자동 생성합니다.

2. Vercel Blob
   - Vercel Storage에서 Blob Store를 추가합니다.
   - `BLOB_READ_WRITE_TOKEN` 환경변수가 프로젝트에 연결되어야 합니다.
   - 캡쳐 이미지는 Blob에 public URL로 저장되고, DB에는 리포트 JSON과 이미지 URL만 저장됩니다.

3. Gemini API
   - `GEMINI_API_KEY`를 Vercel 환경변수에 추가합니다.
   - 기본 모델은 `gemini-2.5-flash-lite`입니다. 바꾸려면 `GEMINI_MODEL`을 설정합니다.

4. 관리자 비밀번호
   - `ADMIN_PASSWORD`를 설정합니다.
   - 설정하지 않으면 기본값은 `2488`입니다.

## 환경변수

`.env.example`을 참고해 Vercel Project Settings > Environment Variables에 추가합니다.

```txt
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash-lite
ADMIN_PASSWORD=2488
DATABASE_URL=
BLOB_READ_WRITE_TOKEN=
```

## 동작 방식

- 관리자는 로그인 후 영상을 분석합니다.
- `공유하기`를 누르면 캡쳐 이미지는 Vercel Blob에 저장됩니다.
- 리포트 텍스트, 서브 종류, 캡쳐 URL은 Neon Postgres에 저장됩니다.
- 공유 URL은 `/reports/1001` 같은 숫자 ID 형태입니다.
- `/reports/:id` 페이지는 로그인 없이 볼 수 있습니다.
- `/history`와 저장 API는 관리자 로그인 후에만 사용할 수 있습니다.
