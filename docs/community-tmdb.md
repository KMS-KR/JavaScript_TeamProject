# 작품 정보·커뮤니티 TMDB 연동

## 구조

- server.js: 첨부된 기존 Express 4 서버에 TMDB API를 등록. public 정적 제공과 홈페이지 fallback 유지.
- tmdb-api.js: Node 기본 https로 TMDB v3 호출. 추가 npm 패키지 없음.
- public/community.html: 상단 사이트 메뉴 + 커뮤니티 진입점. 기존 public/index.html 교체 금지.
- public/css/community.css: 전용 스타일.
- public/js/community.js: 실행용 빌드 번들. React를 팀 package.json에 추가하지 않아도 동작.
- 편집용 원본은 전달 ZIP의 OPTIONAL_SOURCE에 별도 보관. Vite로 재빌드한 release/public 세 파일만 팀 레포에 반영.

## 인증

server.js 옆의 .env에 TMDB_READ_ACCESS_TOKEN 또는 TMDB_API_KEY 중 하나를 설정하고 서버를 재시작합니다. 둘 다 있으면 읽기 토큰이 우선입니다. 값이 비어 있는 .env.example만 커밋합니다. 실제 .env/토큰을 public, HTML, 클라이언트 JS, README에 넣지 않습니다.

## 서버 API

| 경로 | 용도 |
|---|---|
| GET /api/tmdb/status | 인증 값 설정 여부만 반환. 토큰 유효성 검사가 아님 |
| GET /api/tmdb/search?query=기생충&page=1 | 영화 제목 검색. 한국어, 성인 검색 결과 제외 |
| GET /api/tmdb/movies/496243 | 한국어 작품 상세 + credits를 변환하여 반환 |
| GET /api/tmdb/movies/496243/reviews?language=ko-KR&page=1 | TMDB 외부 리뷰 |

리뷰 언어는 ko-KR/en-US, 페이지는 1~500, 작품 ID는 양의 int32입니다. 캐시는 서버 프로세스 내 5분/최대 200건, 동시 원격 요청은 12개로 제한합니다. IP당 1분 120회 조회 제한이 있습니다. 프록시 서버 뒤 배포 시 IP 식별 정책은 팀 배포 환경에 맞춰 별도로 검토해야 합니다. 이 구성만으로 공개 서비스의 전체 보안/비용 통제가 완성되지는 않습니다.

API는 express.static과 app.get('*')보다 먼저 등록합니다. 존재하지 않는 TMDB API 경로는 홈페이지 HTML 대신 JSON 404를 반환합니다. 조회 외 요청은 허용하지 않습니다.

## 다른 팀 페이지에서 작품 상세 열기

공통 movie ID는 TMDB 숫자 ID를 사용합니다. 문자열로 변환해 비교합니다. 영화/TV ID를 혼용하지 않습니다.

```javascript
// 검색 결과의 movie.id가 TMDB 영화 ID일 때
const detailHref = `/community.html?movie=${encodeURIComponent(String(movie.id))}`;
```

예: /community.html?movie=496243

콘텐츠 톡을 먼저 여는 주소: /community.html?tab=talk

기존 시연의 parasite, interstellar, lalaland, about-time, spirited-away, dune 주소도 알려진 TMDB ID로 변환됩니다. 그 외 임의 문자열은 지원하지 않습니다.

## 상단 메뉴

홈 /#home, 통합 검색 /#search, 마이페이지 /#mypage, 커뮤니티 /community.html?tab=talk.

커뮤니티에서 #home만 사용하면 같은 HTML 안의 해시만 바뀌므로 반드시 홈페이지 경로 /를 포함합니다. 상단 검색 입력은 TMDB 작품 검색 다이얼로그를 열며, 메뉴의 통합 검색은 팀 홈페이지의 검색 화면으로 이동합니다.

메뉴는 본문 렌더링 루트 밖의 HTML로 존재하므로 본문 오류와 독립적입니다. 공통 main.css를 재사용하되 팀 CSS 전체가 제공되지 않았으므로 최종 외관은 팀 레포에서 확인합니다. 향후 공통 메뉴가 바뀌면 community.html의 메뉴도 반영해야 합니다.

## 리뷰/별점 의미

- TMDB 평균 평점: vote_average / vote_count, 영화 전체의 외부 통계.
- TMDB 외부 리뷰: 작성자·본문·작성일·작성자가 남긴 선택적 별점. 읽기 전용.
- 우리 한줄평: 현재 브라우저의 직접 작성 리뷰. 1~10점/최대 80자. TMDB 평균에 합산하지 않음.
- TMDB 리뷰가 한 줄이라고 가정하거나 영어를 자동 번역한 것으로 표시하지 않음.
- 외부 리뷰 스포일러 여부를 알 수 없어 모두 처음에는 본문을 DOM에 표시하지 않음. 사용자가 열면 React 텍스트 노드로만 출력하고 HTML/Markdown은 실행하지 않음.
- 외부 리뷰 원문은 themoviedb.org로만 연결. 작품별/언어별 리뷰가 0개인 것은 정상일 수 있음.
- 리뷰/댓글/글 쓰기, 공감, 내 글 소유 표시는 로컬 시연 기능. 서버 인증이나 실제 권한 검증이 아님.

## 저장

새 키: ottpia:community:tmdb:v1:movies / reviews / posts / watchlist.
기존 nickname과 saved-posts 키를 계속 사용합니다. 최초 전환 시 기존 v2의 mine=true인 직접 작성 리뷰만 이관합니다. 예시 한줄평을 실제 리뷰로 취급하지 않습니다. 기존 v2 키는 삭제하지 않습니다. 같은 브라우저라도 localhost/127.0.0.1/포트가 다르면 저장 공간이 다릅니다.

## 검증과 한계

실제 토큰은 전달하지 않으며 자체 검사는 모의 응답 기반입니다. 토큰 입력 후 상세 API가 실제 영화 데이터를 반환하는지 확인해야 합니다. configured:true는 값이 설정되었다는 의미일 뿐입니다. TMDB 원격 서비스 가용성/토큰 권한/이미지 주소의 실제 로딩/팀 라우터 동작은 별도 확인 사항입니다.

로그인, 다중 사용자 DB, TV 작품, OTT 제공 플랫폼, TMDB에 글쓰기/별점 등록은 포함하지 않습니다. 글 공유는 동일 브라우저의 로컬 데이터에 한정됩니다.

공식 참고:
- https://developer.themoviedb.org/docs/authentication-application
- https://developer.themoviedb.org/reference/movie-reviews
- https://developer.themoviedb.org/docs/faq
