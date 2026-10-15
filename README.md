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
- `app.js`: 한·영 전환, 사진 슬라이드, 카카오톡 ID 복사
- `announcements/*.md`: 공지사항 원문
- `announcements.css`: 최신 공지·전체 목록·상세 페이지 스타일
- `scripts/build.mjs`: Markdown 검증, 목록 정렬, 정적 HTML 생성
- `scripts/serve.mjs`: 빌드 결과 미리보기 서버
- `tests/`: 빌드·콘텐츠 검증 및 보안 회귀 검사
- `assets/`: 로고, 태극기 및 협회 사진
- `SOURCES.md`: 출처 및 사진 저작자 안내
- `dist/`: 생성된 배포 결과. Git에 저장하지 않습니다.

홈페이지의 `<!-- latest-announcements:start -->`와 `<!-- latest-announcements:end -->` 사이에는 빌드할 때 최신 글 목록이 삽입됩니다. 헤더·푸터 변경은 전체 공지와 상세 페이지에 함께 반영되고, 상대 링크를 다시 계산하므로 프로젝트 경로를 사용하는 GitHub Pages에서도 동작합니다. 본문과 목록은 JavaScript 없이도 읽을 수 있습니다.

## 배포

`.github/workflows/pages.yml`은 `main` 변경 또는 수동 실행 시 `npm ci`, `npm test`, `npm run build`를 실행하고 `dist/`만 GitHub Pages에 배포합니다. 저장소 Pages 설정의 배포 원본은 **GitHub Actions**여야 합니다. 기존 `CNAME`이 있으면 빌드 결과에도 복사합니다.

프로필 사진과 경기 사진의 출처는 `SOURCES.md` 및 사이트 하단에 기록합니다. 공지사항에 일정·가격·자격 조건을 추가할 때는 협회의 확인된 정보를 사용하세요.
