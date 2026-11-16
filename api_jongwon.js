// 종원 - 검색 페이지용 TMDB 연결 (서버 쪽)
//
// 왜 서버에 두나요?
//   API 키를 브라우저 코드(public 폴더)에 적으면 누구나 볼 수 있어요.
//   그래서 키는 .env 파일에만 두고, 서버가 대신 TMDB에 물어본 뒤
//   결과만 브라우저에 넘겨줍니다. (.env 는 .gitignore 에 있어서 GitHub에 안 올라가요)
//
// 브라우저가 부르는 주소는 두 개입니다.
//   GET /api/jongwon/contents            태그를 안 골랐을 때 보여줄 플랫폼별 인기작 묶음
//   GET /api/jongwon/search?genres=..    고른 태그 조건으로 TMDB에서 직접 찾기
//                                        (모자라면 조건을 하나씩 풀어 "비슷한 작품"으로 채움)

const path = require('path');

// .env 파일 읽기 (파일이 없으면 그냥 넘어감)
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) {}

const TMDB_BASE = process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p/w342';
const PAGES = 3;                         // 플랫폼마다 인기순으로 몇 페이지(1페이지=20개) 가져올지
const PAGES_KR = 2;                      // 그와 별도로 한국 작품만 몇 페이지 더 가져올지
const CACHE_MS = 6 * 60 * 60 * 1000;     // 한 번 받아온 결과는 6시간 동안 재사용
const MAX_PER_PLATFORM = 10;             // 플랫폼마다 최대 몇 개 돌려줄지
const SEARCH_CACHE_MAX = 300;            // 검색 결과를 몇 가지 조건까지 기억해둘지
const MAX_AT_ONCE = 12;                  // TMDB에 동시에 보내는 요청 수 제한 (너무 빨리 많이 보내면 막힘)

function apiKey() {
    const key = (process.env.TMDB_API_KEY || '').trim();
    return key && !key.includes('여기에') ? key : '';
}

// 우리 사이트의 OTT ↔ TMDB의 제공처 이름 (id는 못 찾았을 때 쓰는 기본값)
const PLATFORMS = [
    { id: 'netflix', match: /^netflix$/i,          fallbackId: 8 },
    { id: 'tving',   match: /^tving$/i,            fallbackId: null },
    { id: 'disney',  match: /^disney\s*(plus|\+)$/i, fallbackId: 337 },
    { id: 'wavve',   match: /^wavve$/i,            fallbackId: 356 },
    { id: 'watcha',  match: /^watcha$/i,           fallbackId: 97 },
];

// 화면의 해시태그 목록 (public/components/search_jongwon/data.js 의 TAG_GROUPS 와 같아야 함)
const TAGS = {
    genres:  ['액션', '스릴러', '로맨스', '코미디', '드라마', 'SF·판타지', '공포', '범죄', '예능', '애니'],
    moods:   ['가볍게', '긴장감', '반전', '감동', '설렘', '힐링'],
    country: ['한국', '영미권', '유럽', '일본'],
    era:     ['최신작', '2020~2022', '2019 이전'],
};
const GROUPS = Object.keys(TAGS);

// TMDB 장르 번호 → 우리 해시태그 (받아온 작품에 태그를 붙일 때 사용)
const GENRE_TAG = {
    28: '액션', 12: '액션', 10759: '액션', 10752: '액션',
    53: '스릴러', 9648: '스릴러',
    10749: '로맨스',
    35: '코미디',
    18: '드라마',
    878: 'SF·판타지', 14: 'SF·판타지', 10765: 'SF·판타지',
    27: '공포',
    80: '범죄',
    10764: '예능', 10767: '예능',
    16: '애니',
};

// 우리 해시태그 → TMDB 장르 번호 (TMDB에 조건을 걸어 물어볼 때 사용)
// 영화와 시리즈는 TMDB 장르 번호가 달라서 따로 적음. 빈 배열 = TMDB에 그 장르가 없음
const TAG_IDS = {
    movie: { '액션': [28, 12], '스릴러': [53, 9648], '로맨스': [10749], '코미디': [35], '드라마': [18], 'SF·판타지': [878, 14], '공포': [27], '범죄': [80], '예능': [], '애니': [16] },
    tv:    { '액션': [10759], '스릴러': [9648], '로맨스': [], '코미디': [35], '드라마': [18], 'SF·판타지': [10765], '공포': [], '범죄': [80], '예능': [10764, 10767], '애니': [16] },
};
const MOOD_IDS = {
    movie: { '가볍게': [35, 16], '긴장감': [53, 9648, 27, 80, 28], '반전': [9648, 53], '감동': [18, 10751], '설렘': [10749], '힐링': [10751, 99, 16] },
    tv:    { '가볍게': [35, 10764, 10767, 16], '긴장감': [9648, 80, 10759], '반전': [9648], '감동': [18, 10751], '설렘': [], '힐링': [10751, 99, 16] },
};
// 시리즈에는 로맨스·공포 장르 번호가 없어서, TMDB의 "키워드"로 대신 찾음
const TV_KEYWORD = { '로맨스': 'romance', '공포': 'horror' };

// 결과가 모자랄 때 대신 보여줄 "비슷한 장르"
const RELATED = {
    '액션': ['범죄', 'SF·판타지'], '스릴러': ['범죄', '공포'], '로맨스': ['드라마', '코미디'], '코미디': ['예능', '로맨스'],
    '드라마': ['로맨스'], 'SF·판타지': ['액션'], '공포': ['스릴러'], '범죄': ['스릴러', '액션'], '예능': ['코미디'], '애니': ['SF·판타지', '코미디'],
};

// 장르를 보고 '기분' 태그를 붙이는 규칙 (TMDB에는 기분 정보가 없어서 장르로 추정)
function moodsOf(ids, genres) {
    const has = t => genres.includes(t);
    const moods = [];
    if (has('코미디') || has('예능') || has('애니')) moods.push('가볍게');
    if (has('스릴러') || has('공포') || has('범죄') || has('액션')) moods.push('긴장감');
    if (ids.includes(9648) || has('스릴러')) moods.push('반전');
    if (has('드라마') || ids.includes(10751)) moods.push('감동');
    if (has('로맨스')) moods.push('설렘');
    if (ids.includes(10751) || ids.includes(99) || has('애니')) moods.push('힐링');
    return moods;
}

const ENGLISH = ['US', 'GB', 'CA', 'AU', 'NZ', 'IE'];
const EUROPE = ['ES', 'FR', 'DE', 'IT', 'SE', 'NO', 'DK', 'FI', 'NL', 'BE', 'PL', 'PT', 'AT', 'CH', 'IS', 'CZ', 'TR'];
const LANG_REGION = { ko: '한국', ja: '일본', en: '영미권', es: '유럽', fr: '유럽', de: '유럽', it: '유럽', sv: '유럽', no: '유럽', da: '유럽', nl: '유럽', pl: '유럽', pt: '유럽', tr: '유럽' };

function regionOf(item) {
    const c = (item.origin_country || [])[0];
    if (c === 'KR') return '한국';
    if (c === 'JP') return '일본';
    if (ENGLISH.includes(c)) return '영미권';
    if (EUROPE.includes(c)) return '유럽';
    return LANG_REGION[item.original_language] || '기타';
}

// 국가 태그 → TMDB에 걸 조건 (유럽은 한 번에 못 물어봐서 언어별로 나눠 물어봄)
const COUNTRY_PARAMS = {
    '한국': [{ with_origin_country: 'KR' }],
    '일본': [{ with_origin_country: 'JP' }],
    '영미권': [{ with_original_language: 'en' }],
    '유럽': [{ with_original_language: 'fr' }, { with_original_language: 'es' }, { with_original_language: 'de' }, { with_original_language: 'it' }],
};

function eraOf(year) {
    if (year >= 2023) return '최신작';
    if (year >= 2020) return '2020~2022';
    return '2019 이전';
}
const ERA_RANGE = { '최신작': ['2023-01-01', null], '2020~2022': ['2020-01-01', '2022-12-31'], '2019 이전': [null, '2019-12-31'] };

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 동시에 보내는 요청 수를 MAX_AT_ONCE 개로 제한하는 줄 세우기
let running = 0;
const waiting = [];
async function takeTurn() {
    if (running >= MAX_AT_ONCE) await new Promise(resolve => waiting.push(resolve));
    else running++;
}
function endTurn() {
    const next = waiting.shift();
    if (next) next(); else running--;
}

async function tmdb(pathname, params = {}) {
    await takeTurn();
    try { return await tmdbNow(pathname, params); } finally { endTurn(); }
}

async function tmdbNow(pathname, params) {
    const url = new URL(TMDB_BASE + pathname);
    url.searchParams.set('api_key', apiKey());
    url.searchParams.set('language', 'ko-KR');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(url);
        if (res.ok) return res.json();
        // 429 = 너무 빨리 많이 물어봄 → 잠깐 쉬었다가 다시
        if (res.status === 429 && attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
        const err = new Error(`TMDB 응답 오류 ${res.status}`);
        err.status = res.status;
        throw err;
    }
}

// 한국에서 서비스 중인 OTT의 TMDB 번호 찾기 (한 번 찾으면 기억)
let providerIdsPromise = null;
function getProviderIds() {
    if (!providerIdsPromise) {
        providerIdsPromise = (async () => {
            const [movie, tv] = await Promise.all([
                tmdb('/watch/providers/movie', { watch_region: 'KR' }),
                tmdb('/watch/providers/tv', { watch_region: 'KR' }),
            ]);
            const all = [...(movie.results || []), ...(tv.results || [])];
            const ids = {};
            PLATFORMS.forEach(p => {
                const found = all.find(x => p.match.test((x.provider_name || '').trim()));
                ids[p.id] = found ? found.provider_id : p.fallbackId;
            });
            return ids;
        })().catch(e => { providerIdsPromise = null; throw e; });
    }
    return providerIdsPromise;
}

// TMDB 키워드 이름 → 번호 (예: 'romance'). 못 찾으면 null
const keywordCache = {};
function getKeywordId(name) {
    if (!(name in keywordCache)) {
        keywordCache[name] = tmdb('/search/keyword', { query: name })
            .then(d => ((d.results || []).find(k => (k.name || '').toLowerCase() === name) || {}).id || null)
            .catch(() => null);
    }
    return keywordCache[name];
}

// TMDB에 "이 플랫폼의 작품 목록"을 한 번 물어보기. 실패한 페이지는 빈 목록으로 넘어감
function discover(kind, providerId, extra, page, forcedGenre) {
    return tmdb(`/discover/${kind}`, {
        with_watch_providers: providerId,
        watch_region: 'KR',
        with_watch_monetization_types: 'flatrate',
        sort_by: 'popularity.desc',
        include_adult: 'false',
        ...extra,
        page,
    })
        .then(d => (d.results || []).map(r => ({ ...r, kind, forcedGenre })))
        .catch(e => { if (e.status === 401) throw e; return []; });
}

// 같은 작품이 두 번 들어오면 하나로 합치고, 보여줄 순서를 정함
// 순서 점수 = 인기 순위(0~1) + 한국 작품 가산점 + 최신작 가산점
function dedupeAndRank(rawList) {
    const byKey = new Map();
    rawList.forEach(r => {
        const key = r.kind + r.id;
        const old = byKey.get(key);
        if (!old) byKey.set(key, r);
        else if (r.forcedGenre && !old.forcedGenre) old.forcedGenre = r.forcedGenre;
    });
    const raw = [...byKey.values()];
    raw.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    const yearOf = r => Number((r.release_date || r.first_air_date || '').slice(0, 4)) || 0;
    raw.forEach((r, i) => {
        const year = yearOf(r);
        let s = 1 - i / raw.length;
        if (regionOf(r) === '한국') s += 0.35;
        if (year >= 2023) s += 0.3;
        else if (year >= 2020) s += 0.15;
        else if (year && year < 2010) s -= 0.2;
        r.sortScore = s;
    });
    raw.sort((a, b) => b.sortScore - a.sortScore);
    return raw;
}

// TMDB 원본 한 줄 → 화면에서 쓰는 모양으로 바꾸기
function toItem(r, platformId, rank) {
    const ids = r.genre_ids || [];
    const genres = [...new Set(ids.map(id => GENRE_TAG[id]).filter(Boolean))];
    if (r.forcedGenre && !genres.includes(r.forcedGenre)) genres.push(r.forcedGenre);   // 키워드로 찾은 로맨스·공포 시리즈
    const date = r.release_date || r.first_air_date || '';
    const year = Number(date.slice(0, 4)) || null;
    return {
        tmdbId: r.id,
        title: r.title || r.name || '(제목 없음)',
        year,
        type: r.kind === 'movie' ? '영화' : '시리즈',
        platform: platformId,
        genres,
        moods: moodsOf(ids, genres),
        country: [regionOf(r)],
        era: year ? [eraOf(year)] : [],
        line: r.overview || '',
        poster: r.poster_path ? IMG_BASE + r.poster_path : '',
        rank,   // 추천 순서 (작을수록 위)
    };
}

// ───────────────────────── 1) 태그 없을 때: 플랫폼별 인기작 묶음 ─────────────────────────
// 전 세계 인기순으로만 가져오면 오래된 미국 시리즈가 위를 다 차지해서, 한국 작품을 따로 더 가져옴
async function fetchPlatform(platformId, providerId) {
    if (!providerId) return [];
    const jobs = [];
    for (const kind of ['movie', 'tv']) {
        for (let page = 1; page <= PAGES; page++) jobs.push(discover(kind, providerId, {}, page));
        for (let page = 1; page <= PAGES_KR; page++) jobs.push(discover(kind, providerId, { with_origin_country: 'KR' }, page));
    }
    const raw = dedupeAndRank((await Promise.all(jobs)).flat());
    return raw.map((r, i) => toItem(r, platformId, i));
}

async function loadAll() {
    const providerIds = await getProviderIds();
    // TMDB에 한꺼번에 너무 많이 요청하지 않도록 플랫폼을 하나씩 차례로 받아옴
    const items = [];
    for (const p of PLATFORMS) {
        items.push(...await fetchPlatform(p.id, providerIds[p.id]));
    }
    if (items.length === 0) throw new Error('받아온 작품이 0개');
    return items;
}

// 받아온 결과 기억해두기 (매번 TMDB를 부르지 않도록)
let cache = null;       // { time, items }
let loading = null;     // 지금 받아오는 중이면 그 작업

async function getContents() {
    if (cache && Date.now() - cache.time < CACHE_MS) return cache.items;
    if (!loading) {
        loading = loadAll()
            .then(items => { cache = { time: Date.now(), items }; return items; })
            .finally(() => { loading = null; });
    }
    return loading;
}

// ───────────────────────── 2) 태그 골랐을 때: 조건으로 직접 찾기 ─────────────────────────

// 고른 태그와 작품이 맞는지 (같은 묶음 안에서는 하나만 맞아도 OK, 다른 묶음끼리는 모두 맞아야 함)
function matchesTags(item, tags) {
    return GROUPS.every(g => tags[g].length === 0 || tags[g].some(t => item[g].includes(t)));
}

// 고른 시기 태그 → 날짜 범위 조건
function dateParams(kind, eras) {
    if (eras.length === 0) return {};
    const from = eras.some(e => !ERA_RANGE[e][0]) ? null : eras.map(e => ERA_RANGE[e][0]).sort()[0];
    const to = eras.some(e => !ERA_RANGE[e][1]) ? null : eras.map(e => ERA_RANGE[e][1]).sort().pop();
    const field = kind === 'movie' ? 'primary_release_date' : 'first_air_date';
    const out = {};
    if (from) out[`${field}.gte`] = from;
    if (to) out[`${field}.lte`] = to;
    return out;
}

// 한 플랫폼에서 태그 조건에 맞는 작품 후보를 TMDB에서 받아오기
async function fetchCandidates(providerId, tags) {
    const countryVariants = tags.country.length ? tags.country.flatMap(c => COUNTRY_PARAMS[c]) : [{}];
    const pages = countryVariants.length === 1 ? 2 : 1;
    const jobs = [];

    for (const kind of ['movie', 'tv']) {
        const date = dateParams(kind, tags.era);

        // 장르 조건: 장르 태그가 있으면 그걸로, 없고 기분 태그만 있으면 기분에 해당하는 장르로
        let genreIds = null;   // null = 장르 조건 없음
        if (tags.genres.length) genreIds = [...new Set(tags.genres.flatMap(t => TAG_IDS[kind][t]))];
        else if (tags.moods.length) genreIds = [...new Set(tags.moods.flatMap(t => MOOD_IDS[kind][t]))];

        if (genreIds === null || genreIds.length > 0) {
            const genre = genreIds ? { with_genres: genreIds.join('|') } : {};   // | 는 "또는"
            for (const country of countryVariants) {
                for (let page = 1; page <= pages; page++) jobs.push(discover(kind, providerId, { ...genre, ...country, ...date }, page));
            }
        }

        // 장르와 기분을 같이 골랐는데 그 장르만으로는 기분이 안 맞는 경우 (예: 액션 + 감동)
        // → "액션이면서 드라마"처럼 두 장르를 모두 가진 작품을 따로 더 찾음 (, 는 "그리고")
        const needy = tags.genres.filter(t => !moodsOf([], [t]).some(m => tags.moods.includes(m)));
        const pairs = new Set();
        for (const t of needy) {
            const gid = TAG_IDS[kind][t][0];
            if (!gid) continue;
            for (const mid of tags.moods.flatMap(m => MOOD_IDS[kind][m])) {
                if (mid !== gid) pairs.add(`${gid},${mid}`);
            }
        }
        for (const pair of [...pairs].slice(0, 4)) {
            for (const country of countryVariants) jobs.push(discover(kind, providerId, { with_genres: pair, ...country, ...date }, 1));
        }

        // 시리즈의 로맨스·공포는 장르 번호가 없어서 키워드로 따로 찾음
        if (kind === 'tv') {
            const wanted = new Set(tags.genres.filter(t => TV_KEYWORD[t]));
            if (tags.genres.length === 0 && tags.moods.includes('설렘')) wanted.add('로맨스');
            for (const tag of wanted) {
                const keywordId = await getKeywordId(TV_KEYWORD[tag]);
                if (!keywordId) continue;
                for (const country of countryVariants) {
                    jobs.push(discover('tv', providerId, { with_keywords: keywordId, ...country, ...date }, 1, tag));
                }
            }
        }
    }
    return dedupeAndRank((await Promise.all(jobs)).flat());
}

// 한 플랫폼의 검색 결과 만들기: 정확히 맞는 작품 → 모자라면 조건을 풀어 "비슷한 작품"으로 채움
async function searchPlatform(platformId, providerId, tags) {
    if (!providerId) return [];
    const out = [];
    const seen = new Set();
    const add = (items, similar) => {
        for (const item of items) {
            if (out.length >= MAX_PER_PLATFORM) return;
            const key = item.type + item.tmdbId;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ ...item, similar, rank: out.length });
        }
    };
    const find = async t => (await fetchCandidates(providerId, t)).map((r, i) => toItem(r, platformId, i)).filter(item => matchesTags(item, t));

    // 1단계: 고른 태그에 전부 맞는 작품
    add(await find(tags), false);

    // 2단계: 모자라면 시기 → 국가 → 기분 순서로 조건을 하나씩 풀어서 채움
    const relaxed = [];
    let t = tags;
    if (t.era.length) { t = { ...t, era: [] }; relaxed.push(t); }
    if (t.country.length) { t = { ...t, country: [] }; relaxed.push(t); }
    if (t.moods.length && t.genres.length) { t = { ...t, moods: [] }; relaxed.push(t); }
    for (const r of relaxed) {
        if (out.length >= MAX_PER_PLATFORM) break;
        add(await find(r), true);
    }

    // 3단계: 그래도 모자라면 비슷한 장르로 채움 (예: 공포 → 스릴러)
    if (out.length < MAX_PER_PLATFORM && tags.genres.length) {
        const related = [...new Set(tags.genres.flatMap(g => RELATED[g] || []))].filter(g => !tags.genres.includes(g));
        if (related.length) add(await find({ genres: related, moods: [], country: [], era: [] }), true);
    }

    // 4단계: 그래도 모자라면 이 플랫폼 인기작 중 고른 태그가 하나라도 맞는 작품
    if (out.length < MAX_PER_PLATFORM) {
        const all = GROUPS.flatMap(g => tags[g].map(tag => [g, tag]));
        const popular = (await getContents().catch(() => []))
            .filter(item => item.platform === platformId && all.some(([g, tag]) => item[g].includes(tag)));
        add(popular, true);
    }
    return out;
}

// 검색 결과 기억해두기 (같은 태그 조합을 또 누르면 TMDB를 안 부름)
const searchCache = new Map();   // key → { time, promise }
function cachedSearch(platformId, providerId, tags) {
    const key = platformId + '|' + GROUPS.map(g => [...tags[g]].sort().join(',')).join('|');
    const hit = searchCache.get(key);
    if (hit && Date.now() - hit.time < CACHE_MS) return hit.promise;
    const promise = searchPlatform(platformId, providerId, tags).catch(e => { searchCache.delete(key); throw e; });
    searchCache.set(key, { time: Date.now(), promise });
    if (searchCache.size > SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value);   // 가장 오래된 것 버리기
    return promise;
}

// 주소에 붙어온 글자(?genres=액션,스릴러)를 태그 목록으로 바꾸기. 우리 목록에 없는 값은 버림
function parseList(value, allowed) {
    if (typeof value !== 'string') return [];
    return [...new Set(value.split(',').map(s => s.trim()).filter(s => allowed.includes(s)))];
}

function sendError(res, e, where) {
    const hint = e.status === 401 ? 'API 키가 틀렸어요. .env 파일의 TMDB_API_KEY를 확인하세요.' : 'TMDB에서 데이터를 못 받아왔어요.';
    console.error(`[검색 API] ${where}:`, hint, e.message);
    res.status(502).json({ error: 'tmdb_failed', message: hint });
}

module.exports = function registerJongwonApi(app) {
    const noKey = res => res.status(503).json({ error: 'no_key', message: '.env 파일에 TMDB_API_KEY가 없어요. 샘플 데이터로 보여줍니다.' });

    app.get('/api/jongwon/contents', async (req, res) => {
        if (!apiKey()) return noKey(res);
        try {
            const items = await getContents();
            res.json({ source: 'tmdb', count: items.length, items });
        } catch (e) { sendError(res, e, '인기작'); }
    });

    app.get('/api/jongwon/search', async (req, res) => {
        if (!apiKey()) return noKey(res);
        const tags = {};
        GROUPS.forEach(g => { tags[g] = parseList(req.query[g], TAGS[g]); });
        if (GROUPS.every(g => tags[g].length === 0)) {
            return res.status(400).json({ error: 'no_tags', message: '태그를 하나 이상 골라주세요.' });
        }
        const wanted = parseList(req.query.otts, PLATFORMS.map(p => p.id));
        const platforms = wanted.length ? PLATFORMS.filter(p => wanted.includes(p.id)) : PLATFORMS;
        try {
            const providerIds = await getProviderIds();
            const lists = await Promise.all(platforms.map(p => cachedSearch(p.id, providerIds[p.id], tags)));
            const result = {};
            platforms.forEach((p, i) => { result[p.id] = lists[i]; });
            res.json({ source: 'tmdb', platforms: result });
        } catch (e) { sendError(res, e, '태그 검색'); }
    });

    if (!apiKey()) console.log('ℹ️  TMDB_API_KEY가 없어서 검색 페이지는 샘플 데이터로 동작합니다. (.env 파일 확인)');
};
