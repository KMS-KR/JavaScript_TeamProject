// 승우: AI 추천 탭 서버 API (Google Gemini API 사용)
//
//  1) 오늘의 AI 픽     GET  /api/seungwoo/today?date=2026-11-14
//     → 요일별 테마에 맞는 영화 한 편 + 상세 추천 이유 (하루에 한 번만 AI 호출, 나머지는 저장된 값)
//  2) 상황별 큐레이션  POST /api/seungwoo/curate  { weather, day, mood, hour, catalog }
//     → 날씨·요일·기분을 분석해서 메인 추천 1편 + 대안 2편
//
// API 키는 브라우저 코드에 넣으면 누구나 볼 수 있어서, .env 에만 두고 서버에서 호출합니다.
//   .env 예시 (server.js 와 같은 폴더)
//     GEMINI_API_KEY=발급받은키
//     GEMINI_MODEL=gemini-3.5-flash-lite      ← 생략하면 이 모델
// 키가 없거나 Gemini 호출이 실패하면 아래 BASIC_MOVIES 로 규칙 기반 추천을 대신 보여줍니다.

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const apiKey = () => (process.env.GEMINI_API_KEY || '').trim();
const model = () => (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
const baseUrl = () => (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

// ── 선택지 (화면의 버튼과 같은 값). AI에게는 설명(hint)까지 같이 보냄
const WEATHERS = {
    맑음: '햇살 좋은 맑은 날', 흐림: '구름 낀 흐린 날', 비: '비 오는 날', 눈: '눈 오는 날',
    추움: '몸이 움츠러드는 추운 날', 더움: '땀나는 더운 날',
};
const MOODS = {
    지침: { hint: '지치고 피곤해서 쉬고 싶음', tags: ['힐링', '위로'] },
    신남: { hint: '기분이 좋아서 더 신나고 싶음', tags: ['통쾌', '웃음', '설렘'] },
    울적: { hint: '울적하고 마음이 가라앉음', tags: ['위로', '감동'] },
    설렘: { hint: '설레고 연애 감성이 필요함', tags: ['설렘', '감성'] },
    심심: { hint: '심심해서 확 빠져들 게 필요함', tags: ['몰입', '긴장'] },
    스트레스: { hint: '스트레스가 쌓여서 시원하게 풀고 싶음', tags: ['통쾌', '웃음'] },
    생각: { hint: '혼자 곱씹을 만한 깊은 이야기가 보고 싶음', tags: ['생각', '감동'] },
};

// ── 요일별 테마 (요일 × 2개, 주마다 번갈아 나옴 → 매일 다른 테마)
const THEMES = {
    0: [{ name: '일요일 오후의 힐링', desc: '느긋하게 마음을 쉬게 해 주는 영화', tags: ['힐링', '감성'] },
        { name: '월요일 앞두고 마음 다독이기', desc: '내일을 버틸 힘을 주는 따뜻한 영화', tags: ['위로', '감동'] }],
    1: [{ name: '월요병 퇴치 처방전', desc: '처진 기운을 끌어올려 주는 영화', tags: ['동기부여', '통쾌'] },
        { name: '새로운 한 주를 여는 희망', desc: '다시 해 볼 용기를 주는 영화', tags: ['위로', '동기부여'] }],
    2: [{ name: '화요일의 작은 일탈', desc: '평범한 하루에 웃음과 설렘을 더하는 영화', tags: ['웃음', '설렘'] },
        { name: '머리를 깨우는 반전 명작', desc: '끝까지 집중하게 만드는 영화', tags: ['몰입', '생각'] }],
    3: [{ name: '한 주의 반환점, 쉬어가기', desc: '지친 수요일을 달래 주는 영화', tags: ['힐링', '위로'] },
        { name: '수요일 밤 몰입 시네마', desc: '시간 가는 줄 모르는 영화', tags: ['몰입', '긴장'] }],
    4: [{ name: '목요일의 설렘 충전', desc: '마음이 몽글몽글해지는 영화', tags: ['설렘', '감성'] },
        { name: '명대사가 오래 남는 영화', desc: '보고 나서도 계속 생각나는 영화', tags: ['감동', '생각'] }],
    5: [{ name: '불금엔 스트레스 날리기', desc: '한 주의 피로를 시원하게 날리는 영화', tags: ['통쾌', '웃음'] },
        { name: '금요일 밤 서늘한 스릴러', desc: '불 끄고 보기 좋은 긴장감 있는 영화', tags: ['긴장', '몰입'] }],
    6: [{ name: '주말에 만나는 인생 영화', desc: '두고두고 이야기하게 될 명작', tags: ['감동', '몰입'] },
        { name: '친구랑 보면 웃음 보장', desc: '같이 보면 두 배로 재밌는 영화', tags: ['웃음', '통쾌'] }],
};

// ── 기본 모드(AI 없이)용 영화 목록
const BASIC_MOVIES = [
    ['기생충', 'Parasite', 2019, '봉준호', ['스릴러', '드라마'], ['긴장', '생각', '비']],
    ['라라랜드', 'La La Land', 2016, '데이미언 셔젤', ['뮤지컬', '로맨스'], ['설렘', '감성', '맑음']],
    ['어바웃 타임', 'About Time', 2013, '리처드 커티스', ['로맨스', '드라마'], ['위로', '감동', '설렘', '비']],
    ['인터스텔라', 'Interstellar', 2014, '크리스토퍼 놀란', ['SF', '드라마'], ['몰입', '감동', '생각']],
    ['극한직업', 'Extreme Job', 2019, '이병헌', ['코미디', '액션'], ['웃음', '통쾌']],
    ['범죄도시', 'The Outlaws', 2017, '강윤성', ['액션', '범죄'], ['통쾌', '긴장']],
    ['리틀 포레스트', 'Little Forest', 2018, '임순례', ['드라마'], ['힐링', '위로', '추움', '눈']],
    ['이터널 선샤인', 'Eternal Sunshine of the Spotless Mind', 2004, '미셸 공드리', ['로맨스', 'SF'], ['감성', '생각', '눈', '흐림']],
    ['인사이드 아웃', 'Inside Out', 2015, '피트 닥터', ['애니메이션', '가족'], ['위로', '감동', '웃음']],
    ['월-E', 'WALL-E', 2008, '앤드루 스탠턴', ['애니메이션', 'SF'], ['힐링', '감동']],
    ['비긴 어게인', 'Begin Again', 2013, '존 카니', ['음악', '드라마'], ['설렘', '힐링', '맑음']],
    ['미드나잇 인 파리', 'Midnight in Paris', 2011, '우디 앨런', ['로맨스', '판타지'], ['감성', '설렘', '비']],
    ['위플래쉬', 'Whiplash', 2014, '데이미언 셔젤', ['드라마', '음악'], ['동기부여', '몰입', '긴장']],
    ['쇼생크 탈출', 'The Shawshank Redemption', 1994, '프랭크 다라본트', ['드라마'], ['위로', '감동', '동기부여']],
    ['나 홀로 집에', 'Home Alone', 1990, '크리스 콜럼버스', ['코미디', '가족'], ['웃음', '눈', '추움']],
    ['러브 액츄얼리', 'Love Actually', 2003, '리처드 커티스', ['로맨스', '코미디'], ['설렘', '감성', '눈', '추움']],
    ['매드맥스: 분노의 도로', 'Mad Max: Fury Road', 2015, '조지 밀러', ['액션'], ['통쾌', '몰입', '더움']],
    ['탑건: 매버릭', 'Top Gun: Maverick', 2022, '조셉 코신스키', ['액션'], ['통쾌', '동기부여', '맑음', '더움']],
    ['올드보이', 'Oldboy', 2003, '박찬욱', ['스릴러', '미스터리'], ['긴장', '몰입', '생각']],
    ['살인의 추억', 'Memories of Murder', 2003, '봉준호', ['범죄', '스릴러'], ['긴장', '생각', '비', '흐림']],
    ['곡성', 'The Wailing', 2016, '나홍진', ['미스터리', '공포'], ['긴장', '몰입', '비']],
    ['써니', 'Sunny', 2011, '강형철', ['코미디', '드라마'], ['웃음', '감동']],
    ['수상한 그녀', 'Miss Granny', 2014, '황동혁', ['코미디', '판타지'], ['웃음', '위로']],
    ['센과 치히로의 행방불명', 'Spirited Away', 2001, '미야자키 하야오', ['애니메이션', '판타지'], ['힐링', '몰입']],
    ['이웃집 토토로', 'My Neighbor Totoro', 1988, '미야자키 하야오', ['애니메이션', '가족'], ['힐링', '비', '더움']],
    ['트루먼 쇼', 'The Truman Show', 1998, '피터 위어', ['드라마'], ['생각', '감동']],
    ['인셉션', 'Inception', 2010, '크리스토퍼 놀란', ['SF', '액션'], ['몰입', '생각', '긴장']],
    ['헤어질 결심', 'Decision to Leave', 2022, '박찬욱', ['로맨스', '미스터리'], ['감성', '생각', '흐림']],
    ['노트북', 'The Notebook', 2004, '닉 카사베츠', ['로맨스', '드라마'], ['설렘', '감동', '비']],
    ['코코', 'Coco', 2017, '리 언크리치', ['애니메이션', '음악'], ['감동', '위로']],
    ['월터의 상상은 현실이 된다', 'The Secret Life of Walter Mitty', 2013, '벤 스틸러', ['모험', '드라마'], ['동기부여', '힐링', '맑음', '추움']],
    ['서울의 봄', '12.12: The Day', 2023, '김성수', ['드라마', '역사'], ['긴장', '몰입']],
].map(([title, originalTitle, year, director, genres, tags]) => ({ title, originalTitle, year, director, genres, tags }));

// ─────────────────────────── 공통 도구

// 같은 글자 → 항상 같은 0~1 숫자 (날짜별로 고정된 랜덤)
function seeded(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10000) / 10000;
}

function parseDate(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
    return isNaN(d) ? new Date() : d;
}

function seasonOf(month) {   // month: 1~12
    if (month === 12 || month <= 2) return '겨울';
    if (month <= 5) return '봄';
    if (month <= 8) return '여름';
    if (month === 11) return '늦가을에서 초겨울로 넘어가는 때';
    return '가을';
}

function themeOf(date) {
    const week = Math.floor(date.getTime() / (7 * 86400000));
    return THEMES[date.getDay()][week % 2];
}

const text = (v, max = 300) => String(v ?? '').slice(0, max);

// ─────────────────────────── Gemini 호출

let legacyFormat = false;   // 예전 JSON 지정 방식이 필요한 모델이면 한 번 알아낸 뒤 계속 사용

async function callGemini(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40000);
    try {
        const res = await fetch(`${baseUrl()}/models/${encodeURIComponent(model())}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw Object.assign(new Error(data.error?.message || `Gemini 오류 (${res.status})`),
                { status: res.status, detail: JSON.stringify(data.error || {}) });
        }
        return data;
    } finally {
        clearTimeout(timer);
    }
}

// 프롬프트를 보내고, 정해진 JSON 모양(schema)으로 답을 받아 객체로 돌려줌
async function askGemini(system, prompt, schema) {
    const base = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
    };
    const modern = { responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema } } };
    const legacy = { responseMimeType: 'application/json', responseJsonSchema: schema };

    let data;
    try {
        data = await callGemini({ ...base, generationConfig: legacyFormat ? legacy : modern });
    } catch (e) {
        if (legacyFormat || e.status !== 400 || !/responseFormat/i.test(e.message + e.detail)) throw e;
        legacyFormat = true;
        data = await callGemini({ ...base, generationConfig: legacy });
    }
    const parts = data.candidates?.[0]?.content?.parts || [];
    const out = parts.filter(p => p.text && !p.thought).map(p => p.text).join('');
    if (!out) throw new Error('Gemini 응답이 비어 있어요.');
    return JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, ''));
}

function errorMessage(e) {
    if (/api[_ ]?key/i.test(e.message + (e.detail || '')) || e.status === 401 || e.status === 403) return 'Gemini API 키를 확인해 주세요.';
    if (e.status === 429) return 'Gemini 무료 사용량을 다 썼거나 요청이 너무 빨라요.';
    if (e.status === 404) return `모델 이름(${model()})을 찾을 수 없어요.`;
    if (e.name === 'AbortError') return 'Gemini 응답이 너무 오래 걸렸어요.';
    return 'Gemini에서 답을 받지 못했어요.';
}

const SYSTEM = `너는 OTT 추천 사이트 "All-in-OTT"의 영화 큐레이터야.
사용자는 볼 영화를 못 고르는 선택장애 20대야. 망설이지 않게 확신 있는 말투로, 친구처럼 다정한 존댓말로 추천해.
규칙:
- 실제로 개봉한, 널리 알려진 영화만 추천해. 존재하지 않는 영화나 확실하지 않은 정보는 절대 지어내지 마.
- title 은 한국에서 개봉한 한국어 제목, originalTitle 은 원제, year 는 개봉 연도야.
- 스포일러(결말, 반전 내용)는 절대 쓰지 마.
- 마크다운, 이모지 목록 형식은 쓰지 말고 자연스러운 문장으로 써.`;

const MOVIE_FIELDS = {
    title: { type: 'string', description: '한국 개봉 제목' },
    originalTitle: { type: 'string', description: '원제' },
    year: { type: 'integer', description: '개봉 연도' },
    director: { type: 'string', description: '감독 이름 (한국어)' },
    genres: { type: 'array', items: { type: 'string' }, description: '장르 1~3개' },
};

// ─────────────────────────── 1) 오늘의 AI 픽

const TODAY_SCHEMA = {
    type: 'object',
    properties: {
        ...MOVIE_FIELDS,
        hook: { type: 'string', description: '이 영화를 한 문장으로 소개 (스포일러 없이)' },
        whyToday: { type: 'string', description: '오늘 테마·요일·계절에 이 영화가 어울리는 이유 2~3문장' },
        watchPoint: { type: 'string', description: '보면서 주목할 관전 포인트 2~3문장' },
        forWhom: { type: 'string', description: '이런 사람에게 특히 추천 1~2문장' },
    },
    required: ['title', 'originalTitle', 'year', 'director', 'genres', 'hook', 'whyToday', 'watchPoint', 'forWhom'],
};

const todayCache = new Map();   // 날짜 → 결과 (하루에 AI는 한 번만 호출)
const recentPicks = [];         // 최근 추천한 제목 (겹치지 않게)

function basicToday(date, theme) {
    const recent = new Set(recentPicks);
    const scored = BASIC_MOVIES
        .filter(m => !recent.has(m.title))
        .map(m => ({ m, s: m.tags.filter(t => theme.tags.includes(t)).length * 10 + seeded(date.toDateString() + m.title) * 9 }))
        .sort((a, b) => b.s - a.s);
    const m = (scored[0] || { m: BASIC_MOVIES[0] }).m;
    return {
        ...m,
        hook: `${m.director} 감독의 ${m.genres.join('·')} 영화예요.`,
        whyToday: `오늘의 테마는 '${theme.name}'이에요. ${theme.desc}를 찾다 보니 이 작품이 가장 잘 맞았어요. (${m.tags.filter(t => theme.tags.includes(t)).map(t => '#' + t).join(' ') || '#' + theme.tags[0]})`,
        watchPoint: `${m.year}년 작품이에요. ${m.genres.join(', ')} 장르를 좋아한다면 끝까지 만족하실 거예요.`,
        forWhom: '오늘 뭘 볼지 고민하느라 시간만 보내고 있다면, 고민하지 말고 이걸로 시작해 보세요.',
    };
}

async function getToday(dateStr) {
    const date = parseDate(dateStr);
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    if (todayCache.has(key)) return todayCache.get(key);

    const theme = themeOf(date);
    const label = `${date.getMonth() + 1}월 ${date.getDate()}일 ${DAYS[date.getDay()]}요일`;
    let movie, source = 'basic', notice = '';

    if (apiKey()) {
        try {
            movie = await askGemini(SYSTEM, `오늘은 ${label}이고, 계절로는 ${seasonOf(date.getMonth() + 1)}야.
오늘의 테마는 "${theme.name}" (${theme.desc})야.
이 테마에 딱 맞는 영화 한 편을 골라서 상세한 추천 이유를 써 줘.
${recentPicks.length ? `최근에 이미 추천한 영화는 빼 줘: ${recentPicks.join(', ')}` : ''}`, TODAY_SCHEMA);
            source = 'gemini';
        } catch (e) {
            console.error('[승우 AI] 오늘의 픽 실패:', e.status || '', e.message);
            notice = errorMessage(e);
        }
    }
    if (!movie) movie = basicToday(date, theme);

    const result = {
        date: key, label, theme, source, notice,
        movie: {
            title: text(movie.title, 80), originalTitle: text(movie.originalTitle, 120),
            year: Number(movie.year) || null, director: text(movie.director, 60),
            genres: (Array.isArray(movie.genres) ? movie.genres : []).slice(0, 3).map(g => text(g, 20)),
            hook: text(movie.hook), whyToday: text(movie.whyToday, 500),
            watchPoint: text(movie.watchPoint, 500), forWhom: text(movie.forWhom, 300),
        },
    };
    // AI가 성공했을 때만 하루 동안 저장 (실패했으면 다음 접속 때 다시 시도)
    if (source === 'gemini') {
        todayCache.set(key, result);
        recentPicks.push(result.movie.title);
        if (recentPicks.length > 14) recentPicks.shift();
    }
    return result;
}

// ─────────────────────────── 2) 상황별 맞춤 큐레이션

const CURATE_SCHEMA = {
    type: 'object',
    properties: {
        analysis: { type: 'string', description: '사용자의 상황(날씨·요일·기분·시간대)을 어떻게 해석했는지 1~2문장' },
        main: {
            type: 'object',
            properties: {
                ...MOVIE_FIELDS,
                hook: { type: 'string', description: '한 문장 소개 (스포일러 없이)' },
                reasons: { type: 'array', items: { type: 'string' }, description: '지금 상황에 찰떡인 이유 3개, 각각 1문장', minItems: 3, maxItems: 3 },
            },
            required: ['title', 'originalTitle', 'year', 'director', 'genres', 'hook', 'reasons'],
        },
        alternatives: {
            type: 'array', minItems: 2, maxItems: 2,
            items: {
                type: 'object',
                properties: {
                    title: { type: 'string' }, originalTitle: { type: 'string' }, year: { type: 'integer' },
                    reason: { type: 'string', description: '이 영화도 좋은 이유 1문장' },
                },
                required: ['title', 'originalTitle', 'year', 'reason'],
            },
        },
    },
    required: ['analysis', 'main', 'alternatives'],
};

function slotOf(hour) {
    if (hour >= 22 || hour < 5) return '늦은 밤';
    if (hour >= 18) return '저녁';
    if (hour >= 12) return '오후';
    return '오전';
}

function basicCurate({ weather, day, mood }, avoid) {
    const want = [...MOODS[mood].tags, weather];
    const ranked = BASIC_MOVIES
        .filter(m => !avoid.has(m.title))
        .map(m => ({ m, hit: m.tags.filter(t => want.includes(t)), r: Math.random() }))
        .sort((a, b) => b.hit.length - a.hit.length || a.r - b.r);
    const [a, b, c] = ranked;
    const tagText = x => x.hit.filter(t => !WEATHERS[t]).map(t => '#' + t).join(' ') || '#' + MOODS[mood].tags[0];
    return {
        analysis: `${WEATHERS[weather]}, ${day}요일, '${MOODS[mood].hint}' 상태라서 ${MOODS[mood].tags.map(t => '#' + t).join(' ')} 느낌의 영화를 찾았어요.`,
        main: {
            ...a.m,
            hook: `${a.m.director} 감독의 ${a.m.genres.join('·')} 영화예요.`,
            reasons: [
                `지금 기분에 필요한 분위기(${tagText(a)})를 가진 작품이에요.`,
                a.m.tags.includes(weather) ? `${WEATHERS[weather]}과 특히 잘 어울리는 작품이에요.` : `${day}요일에 부담 없이 보기 좋아요.`,
                '고민은 여기까지! 이 영화로 시작하면 후회 없을 거예요.',
            ],
        },
        alternatives: [b, c].filter(Boolean).map(x => ({ ...x.m, reason: `비슷한 분위기(${tagText(x)})로 골랐어요.` })),
    };
}

async function curate(input) {
    const { weather, day, mood, hour } = input;
    const avoid = new Set(input.avoid);
    if (apiKey()) {
        try {
            const r = await askGemini(SYSTEM, `지금 상황을 분석해서 딱 맞는 영화를 추천해 줘.
- 날씨: ${WEATHERS[weather]}
- 요일: ${day}요일
- 시간대: ${slotOf(hour)}
- 기분: ${MOODS[mood].hint}
메인 추천 1편과, 메인이 마음에 안 들 때를 위한 대안 2편을 골라 줘. 세 편은 서로 달라야 해.
${avoid.size ? `방금 추천한 영화는 빼 줘: ${[...avoid].join(', ')}` : ''}
${input.catalog.length ? `우리 사이트에서 바로 볼 수 있는 영화 목록이야. 상황에 잘 맞는다면 이 중에서 우선 골라 줘: ${input.catalog.join(', ')}` : ''}`, CURATE_SCHEMA);
            return { source: 'gemini', ...r };
        } catch (e) {
            console.error('[승우 AI] 큐레이션 실패:', e.status || '', e.message);
            return { source: 'basic', notice: errorMessage(e), ...basicCurate(input, avoid) };
        }
    }
    return { source: 'basic', ...basicCurate(input, avoid) };
}

// 화면에 보내기 전에 값 정리 (이상한 값·너무 긴 글 막기)
function cleanCurate(r) {
    const movie = m => ({
        title: text(m?.title, 80), originalTitle: text(m?.originalTitle, 120), year: Number(m?.year) || null,
        director: text(m?.director, 60), genres: (Array.isArray(m?.genres) ? m.genres : []).slice(0, 3).map(g => text(g, 20)),
    });
    return {
        source: r.source, notice: r.notice || '', analysis: text(r.analysis, 400),
        main: { ...movie(r.main), hook: text(r.main?.hook), reasons: (r.main?.reasons || []).slice(0, 3).map(x => text(x)) },
        alternatives: (r.alternatives || []).slice(0, 2).map(a => ({ ...movie(a), reason: text(a.reason) })),
    };
}

// ─────────────────────────── 라우트 등록

module.exports = function registerSeungwooApi(app) {
    app.get('/api/seungwoo/status', (req, res) => {
        res.json({ ai: Boolean(apiKey()), model: apiKey() ? model() : null });
    });

    app.get('/api/seungwoo/today', async (req, res) => {
        res.json(await getToday(req.query.date));
    });

    app.post('/api/seungwoo/curate', async (req, res) => {
        const b = req.body || {};
        if (!WEATHERS[b.weather] || !MOODS[b.mood] || !DAYS.includes(b.day)) {
            return res.status(400).json({ message: '날씨, 요일, 기분을 모두 골라 주세요.' });
        }
        const input = {
            weather: b.weather, mood: b.mood, day: b.day,
            hour: Number.isInteger(b.hour) && b.hour >= 0 && b.hour < 24 ? b.hour : new Date().getHours(),
            avoid: (Array.isArray(b.avoid) ? b.avoid : []).slice(0, 12).map(t => text(t, 80)),
            catalog: (Array.isArray(b.catalog) ? b.catalog : []).slice(0, 80).map(t => text(t, 80)),
        };
        res.json(cleanCurate(await curate(input)));
    });

    console.log(apiKey()
        ? `🤖 AI 추천(승우): Gemini 연결 준비 완료 (모델: ${model()})`
        : 'ℹ️  GEMINI_API_KEY가 없어서 AI 추천은 기본 모드로 동작합니다. (.env 파일 확인)');
};
