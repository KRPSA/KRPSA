# KRPSA — Korea Practical Shooting Association

대한민국 실용사격 협회 KRPSA의 한국어·영어 홈페이지입니다. 협회 소개, IPSC 종목, Action Air 입문과 MISIA 핸드건 교육 과정, 공지사항, 교육·입회 문의를 제공합니다.

## 개발 및 미리보기

Node.js **22 이상**이 필요합니다. GitHub Pages는 Node.js 24를 사용합니다.

```sh
npm ci
npm test
npm start
```

`npm start`는 정적 사이트를 빌드한 뒤 개발 서버의 `8080` 포트에서 제공합니다. 다른 포트는 `PORT=8081 npm start`로 지정할 수 있습니다. 파일을 수정한 뒤에는 `npm run build`를 실행하고 브라우저를 새로고침하세요. 개발 서버를 실행 중이라면 별도 터미널에서 빌드하면 됩니다.

`index.html`을 직접 열거나 저장소 루트를 서버로 제공하면 생성된 공지사항이 반영되지 않습니다. 항상 **`dist/`를 미리보기·배포**하세요. 서버 실행 없이 빌드만 하려면 `npm run build`를 사용합니다.

## 첫 방문 언어와 favicon

홈페이지와 공지사항은 다음 순서로 언어를 선택합니다.

1. 사용자가 KO/EN 버튼으로 선택한 언어를 `localStorage`의 `krpsa-language`에 저장하고 우선 적용합니다. 기존 버전에서 저장한 유효한 `ko`/`en` 값도 유지합니다.
2. 저장된 선택이 없으면 [GeoJS의 국가 코드 API](https://www.geojs.io/docs/v1/endpoints/country/)로 접속 국가를 확인해 한국(`KR`)은 한국어, 다른 나라는 영어로 표시합니다. 국가 코드는 같은 탭에서 페이지를 이동할 때 재사용합니다.
3. 국가 확인 전이나 실패 시에는 브라우저의 첫 번째 선호 언어를 사용합니다. 한국어(`ko`)이면 한국어, 나머지는 영어입니다. 국가 확인은 최대 1.2초를 기다리며 페이지 표시를 막지 않습니다.

국가 조회에는 `https://get.geojs.io/v1/ip/country`를 사용합니다. 이 외부 서비스는 요청의 IP 주소로 국가를 판별하지만, 사이트는 국가 코드만 받아 사용하며 IP 주소나 정확한 위치를 저장하지 않습니다. 요청에 쿠키나 페이지 주소를 보내지 않고, 위치 권한도 요청하지 않습니다. 자동 판별 결과는 사용자의 영구 언어 선택으로 저장하지 않으며, 조회 중 KO/EN 버튼을 눌러도 늦게 도착한 응답이 선택을 바꾸지 않습니다. VPN·프록시를 사용하면 해당 연결의 국가로 판별될 수 있습니다.

JavaScript를 사용할 수 없는 경우 기본 한국어 콘텐츠를 표시합니다. 브라우저 저장소를 사용할 수 없어도 해당 페이지의 언어 전환은 동작합니다. 홈페이지·공지 목록·상세 페이지의 favicon은 모두 기존 투명 방패 로고인 `assets/krpsa-logo.png`입니다.

## 공지사항 작성

**`announcements/` 폴더에 Markdown 파일 하나를 추가하면 됩니다.** 별도의 글 목록이나 JavaScript 파일을 수정할 필요가 없습니다.

1. `announcements/_template.md`를 `announcements/2026-10-15-your-announcement.md`처럼 복사합니다.
2. 맨 위 YAML 메타데이터와 아래 한국어 본문을 작성합니다. 본문 뒤에 `<!-- lang:en -->`을 한 줄 넣고 영어 번역을 이어서 작성합니다.
3. 게시하려면 `draft: false`로 변경하거나 `draft` 항목을 삭제합니다.
4. `npm test && npm run build`로 확인합니다. `main`에 반영되면 GitHub Actions가 자동으로 빌드·배포합니다.

```markdown
---
title: "공지사항 제목"
titleEn: "Announcement title"
date: "2026-10-15"
summary: "메인 화면과 전체 목록에 표시할 짧은 요약입니다."
summaryEn: "A short summary for the homepage and announcement list."
category: "교육 안내"
categoryEn: "Training"
slug: "your-announcement"
draft: false
---

첫 문단에 핵심 내용을 작성합니다.

## 자세한 안내

- 안내 사항
- [관련 링크](https://www.misia.world/)

<!-- lang:en -->

Write the main message in the first paragraph.

## Further information

- Announcement details
- [Related website](https://www.misia.world/)
```

| 항목 | 설명 |
| --- | --- |
| `title` | 필수. 공지 제목, 최대 180자 |
| `date` | 필수. 게시 날짜, `"YYYY-MM-DD"` 형식의 실제 날짜 |
| `summary` | 필수. 메인·목록에 표시할 요약, 최대 300자 |
| `category` | 선택. 기본값 `안내` |
| `slug` | 선택. 글 주소에 사용할 소문자 영문·숫자·하이픈. 생략하면 파일명에서 날짜 접두사를 제외한 이름을 사용 |
| `draft` | 선택. `true`이면 메인·목록·상세 페이지에서 모두 제외. 기본값 `false` |
| `titleEn`, `summaryEn`, `categoryEn` | 선택. 영어 모드의 제목·요약·분류. 생략하면 한국어를 그대로 표시 |

날짜가 같으면 `slug` 오름차순으로 정렬합니다. 메인에는 **최신 3개**, `/announcements/`에는 **전체 공지**, `/announcements/글주소/`에는 본문이 표시됩니다. 미래 날짜는 예약 게시 기능이 아니므로, 아직 공개하지 않을 글에는 반드시 `draft: true`를 지정하세요. 처음 제공되는 두 공지의 날짜는 웹사이트 공지 게시 날짜이며 교육 일정이 아닙니다.

`README.md`, `template.md`, `_`로 시작하는 파일과 하위 폴더는 글로 처리하지 않습니다. 잘못된 날짜, 중복 주소, 누락·오타 메타데이터, YAML 중복 키는 빌드를 실패시켜 잘못된 게시를 방지합니다. `draft` 글도 메타데이터를 검증합니다.

### 한국어·영어 본문

한 파일에서 **한국어 본문 → `<!-- lang:en -->` → 영어 본문** 순서로 작성합니다. 구분자는 다른 내용 없이 독립된 한 줄에 한 번만 넣으세요. 두 본문 모두 Markdown을 지원하며, 사이트의 KO/EN 버튼을 누르면 제목·요약과 함께 본문 전체가 전환됩니다. 번역을 별도 공지로 등록하지 않으므로 목록과 주소는 하나씩 유지됩니다.

영어 본문은 작성자가 직접 번역합니다. 구분자를 넣었다면 한국어·영어 본문이 모두 있어야 하며, 빈 번역이나 중복 구분자는 빌드를 실패시킵니다. 코드 블록 안에 예시로 적은 구분자는 실제 언어 전환으로 처리하지 않습니다.

기존 한국어 전용 글도 계속 사용할 수 있습니다. 영어 본문이 없는 글은 EN 모드에서 영어 번역이 아직 없다는 안내와 한국어 원문을 표시합니다. `titleEn`, `summaryEn`, `categoryEn`을 생략하면 해당 항목은 원문을 유지합니다. **완전한 영어 공지를 제공하려면 세 메타데이터와 본문을 모두 번역하세요.** JavaScript를 사용할 수 없는 경우에는 기본 한국어 본문을 표시합니다.

제목은 메타데이터에서 생성하므로 본문의 소제목은 `##`부터 작성하는 것을 권장합니다. 표, 목록, 인용, 코드, 링크와 이미지를 사용할 수 있습니다. 이미지는 `assets/`에 추가하고 `![설명](../../assets/사진.jpg)`로 참조하세요. 영어 본문에서는 이미지 설명도 번역하세요. 홈페이지 섹션 링크는 `[교육 안내](../../#training)`처럼 작성합니다. 원시 HTML은 실행되지 않고 텍스트로 표시되며, `javascript:`, `data:`, `file:` 등 안전하지 않은 링크는 허용하지 않습니다.

## 파일 구조

- `index.html`: 홈페이지와 모든 페이지가 공유하는 헤더·푸터
- `style.css`: 홈페이지와 공통 반응형 스타일
- `app.js`: 한·영 전환, 대문 슬라이드(영상 + 사진), 카카오톡 ID 복사
- `reel.js`: 대문 첫 슬라이드의 IPSC 설명 영상(캔버스 렌더러와 재생기)
- `scripts/reel-render.mjs`, `scripts/reel-audio.mjs`: 영상 MP4 내보내기와 효과음·음악 합성
- `announcements/*.md`: 공지사항 원문
- `announcements.css`: 최신 공지·전체 목록·상세 페이지 스타일
- `scripts/build.mjs`: Markdown 검증, 목록 정렬, 정적 HTML 생성
- `scripts/serve.mjs`: 빌드 결과 미리보기 서버
- `tests/`: 빌드·콘텐츠 검증 및 보안 회귀 검사
- `assets/`: 로고, 태극기 및 협회 사진, `assets/reel/` 영상 사운드트랙
- `SOURCES.md`: 출처 및 사진 저작자 안내
- `dist/`: 생성된 배포 결과. Git에 저장하지 않습니다.

홈페이지의 `<!-- latest-announcements:start -->`와 `<!-- latest-announcements:end -->` 사이에는 빌드할 때 최신 글 목록이 삽입됩니다. 헤더·푸터 변경은 전체 공지와 상세 페이지에 함께 반영되고, 상대 링크를 다시 계산하므로 프로젝트 경로를 사용하는 GitHub Pages에서도 동작합니다. 본문과 목록은 JavaScript 없이도 읽을 수 있습니다.

## IPSC in Motion 영상

대문 슬라이드의 첫 장면은 `reel.js`가 그리는 37초 분량의 IPSC 설명 영상입니다. 영상 파일이 아니라 코드로 매 프레임을 그리므로 한·영 전환에 맞춰 자막이 바뀌고, 챕터를 눌러 원하는 장면으로 이동할 수 있습니다. 영상이 끝나면 사진 슬라이드와 대문 문구로 넘어갑니다. 움직임 줄이기를 설정한 방문자에게는 사진이 먼저 표시되고 자동 재생하지 않습니다. 사운드 버튼을 누르면 `assets/reel/ipsc-in-motion.mp3`가 영상과 같은 시간축으로 재생됩니다.

영상은 8개 챕터로 이어집니다. DVC → 레인지 커맨드 → 시작 신호 → 조준기(아이언 사이트와 옵틱) → 표적과 채점 → 스테이지 → 히트 팩터 → 레인지 클리어 순서이며, 마지막은 협회 엔드 카드입니다.

16초부터 약 28초까지의 스테이지 장면은 프로덕션 디비전 선수가 사격 구역 세 곳을 옮겨 다니며 27발을 쏘는 롱 코스입니다. 점수는 Minor 기준(A 5점, C 3점, D 1점, 철판 5점)이고 만점은 135점입니다.

- 구역 A: 노슛과 겹쳐 놓은 종이 표적, 포퍼 P1. P1을 넘기면 배리어 뒤의 스윙 타겟이 움직이기 시작합니다.
- 구역 B: 벽의 포트로 쏘는 6장짜리 플레이트 랙과 종이 표적. 15발째에 슬라이드가 후퇴 고정되고, 구역 C로 이동하면서 재장전합니다.
- 구역 C: 자유 회전 허브에 철판 5장을 단 텍사스 스타, 드롭 터너를 작동시키는 포퍼 P2, 종이 표적 두 장.
- 이동하는 동안 총구가 넘으면 안 되는 180° 범위를 바닥에 표시합니다. 스윙 타겟과 텍사스 스타는 슬로 모션으로, 구역 사이 이동은 빨리 감기로 보여 주며, 샷 타이머 아래 배지에 재생 속도가 표시됩니다. 타이머와 사격 기록은 항상 실제 스테이지 시간입니다.
- 결과는 127점 ÷ 14.54초 = 히트 팩터 8.7345입니다. 이어서 언로드·쇼 클리어(탄창 분리, 슬라이드 후퇴 고정, 빈 약실 확인), 해머 다운, 홀스터, 레인지 클리어로 마무리합니다.

스테이지 구성과 사격 기록, 점수는 설명을 위한 예시이며 실제 경기 기록이 아닙니다. 화면의 규정·장비 수치와 출처, IPSC 표적 배열 기준과 다른 점은 `SOURCES.md`에 정리되어 있습니다.

장면 시간, 스테이지(`AREAS`, `TARGETS`, `SHOTS`, `EVENTS`, `RAMPS`), 챕터, 자막과 효과음 큐는 모두 `reel.js` 상단의 상수에서 관리합니다. 점수, 히트 팩터와 영상 길이는 `SHOTS`에서 계산되므로 사격 기록을 바꾸면 스테이지 뒤 장면이 0.5초 단위로 함께 밀립니다.

### 사운드트랙과 MP4 다시 만들기

`reel.js`를 수정한 뒤에는 사운드트랙과 MP4를 다시 만듭니다. 다음 도구가 필요합니다.

- **Playwright와 Chromium**: 저장소 의존성이 아니므로 `npm i --no-save playwright`로 설치합니다. 패키지에는 브라우저가 들어 있지 않으므로 이어서 `npx playwright install chromium`을 실행하세요. 이 단계를 빠뜨리면 `browserType.launch: Executable doesn't exist` 오류가 납니다. 전역 설치(`npm i -g playwright` 후 `playwright install chromium`)도 인식합니다. 새 Linux 환경이라면 `npx playwright install --with-deps chromium`으로 시스템 라이브러리도 함께 설치합니다. `npm ci`를 다시 실행하면 `--no-save`로 설치한 Playwright는 지워집니다.
- **ffmpeg**: MP3 변환과 MP4 인코딩(H.264, AAC)에 사용합니다.
- **curl**: 렌더러가 Google Fonts의 Inter와 Noto Sans KR 글꼴을 내려받을 때 사용합니다.

```sh
npm i --no-save playwright
npx playwright install chromium
node scripts/reel-audio.mjs reel.wav
ffmpeg -i reel.wav -c:a libmp3lame -b:a 128k assets/reel/ipsc-in-motion.mp3
node scripts/reel-render.mjs --out reel.mp4 --audio reel.wav --lang both --blur 4
node scripts/reel-render.mjs --stills 6.1,9.5,18.6,24.6,30.5 --dir stills
```

- `scripts/reel-audio.mjs`는 `reel.js`의 효과음 큐(`CUES`)로 효과음과 음악을 합성해 48 kHz 스테레오 WAV를 만듭니다. 샘플 음원은 쓰지 않습니다.
- `scripts/reel-render.mjs`는 헤드리스 Chromium에서 1920×1080 프레임을 하나씩 그려 ffmpeg로 인코딩합니다.
  - `--lang`: `ko`, `en`, `both`(한국어 자막 + 영어 보조 자막, 기본값) 중에서 고릅니다.
  - `--blur`: 프레임당 모션 블러 샘플 수입니다. 기본값은 1입니다.
  - `--fps`: 프레임 속도입니다. 기본값은 60입니다.
  - `--from`, `--to`: 일부 구간(초)만 렌더링합니다.
  - `--credit`: 엔드 카드에 제작 크레디트를 넣습니다.
  - `--stills`: 쉼표로 구분한 시점(초)의 PNG를 `--dir` 폴더에 `frame-06.10.png` 형식으로 저장합니다.

## 배포

`.github/workflows/pages.yml`은 `main` 변경 또는 수동 실행 시 `npm ci`, `npm test`, `npm run build`를 실행하고 `dist/`만 GitHub Pages에 배포합니다. 저장소 Pages 설정의 배포 원본은 **GitHub Actions**여야 합니다. 기존 `CNAME`이 있으면 빌드 결과에도 복사합니다.

프로필 사진과 경기 사진의 출처는 `SOURCES.md` 및 사이트 하단에 기록합니다. 공지사항에 일정·가격·자격 조건을 추가할 때는 협회의 확인된 정보를 사용하세요.
