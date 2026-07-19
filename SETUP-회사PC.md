# 새 PC(회사)에서 이 프로젝트 시작하기

> 순서대로 하면 됩니다. `.env.local`과 `.chrome-profile`은 **git에 없으니** 반드시 따로 옮겨야 합니다.

## 1. 클론
```bash
git clone https://github.com/lixcksunho-dotcom/AI-taobao
cd AI-taobao
npm install
```

## 2. `.env.local` 옮기기 ← **git에 없음. 이게 없으면 아무것도 안 돌아감**
집 PC의 `C:\Users\선호\AI-taobao\.env.local`을 그대로 복사해 온다.
- 이메일/메신저로 보내지 말 것 (Supabase service key + Anthropic API key가 들어있음)
- USB, 또는 회사에서 Supabase 대시보드·Anthropic 콘솔에서 값을 직접 다시 복사하는 쪽이 안전
- 필요한 키 목록은 `CLAUDE.md`의 "환경변수" 절 참조

## 3. Claude Code 설치 + 로그인
```bash
npm install -g @anthropic-ai/claude-code
cd AI-taobao
claude
```
- `/login` 으로 계정 로그인 (sunho980101@gmail.com)
- 실행하면 `CLAUDE.md` + `.claude/settings.json`을 자동으로 읽어서 프로젝트 맥락·함정·허용 명령을 바로 파악함 → 별도 설명 불필요
- 회사 네트워크가 프록시를 쓰면: `HTTPS_PROXY` 환경변수 설정 필요

## 4. 웹앱 확인
```bash
npm run build   # 통과해야 정상
npm run dev     # localhost:3000
```
`/dashboard`, `/products`가 데이터 나오면 Supabase 연결 OK.

## 5. 스크래퍼를 쓸 거면 (안 쓰면 생략)
`.chrome-profile` 세션은 PC마다 따로다. **회사 PC에서 1회 로그인 다시 해야 함**:
```bash
node scripts/session-login.mjs 1688
node scripts/session-login.mjs taobao
```
헤드 브라우저가 뜨면 직접 로그인 → 세션 저장됨(수 주 유지). 이걸 건너뛰면 캡차로 전부 막힌다.

이미지 가공(`translate_image.py`)까지 쓸 거면 Python 쪽도 필요:
```bash
pip install rapidocr-onnxruntime opencv-python pillow onnxruntime
```
(한글 렌더에 `C:\Windows\Fonts\malgun.ttf` 사용 — Windows면 기본 존재)

## 6. 두 PC 오가며 작업할 때
- 작업 끝나면 항상 `git push` (`npm run push`)
- 다음 PC에서 시작 전 `git pull`
- `.env.local` / `.chrome-profile` / `_processed` 등은 동기화되지 않음(의도된 것)

## 지금 이어서 할 일 (2026-07-20 기준)
- 타오바오 48개 상세 보강 완주 (`enrich-taobao.mjs --all --slow`, 봇 차단 쿨다운 주의)
- `description_kr` 컬럼 ALTER 후 `category`에 들어있는 설명 데이터 이전
- (선택) 타오바오 `&page` 페이징 중복 개선
