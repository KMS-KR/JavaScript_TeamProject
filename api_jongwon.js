// 종원 - 검색 페이지용 TMDB 연결 (서버 쪽)
//
// 왜 서버에 두나요?
//   API 키를 브라우저 코드(public 폴더)에 적으면 누구나 볼 수 있어요.
//   그래서 키는 .env 파일에만 두고, 서버가 대신 TMDB에 물어본 뒤
//   결과만 브라우저에 넘겨줍니다. (.env 는 .gitignore 에 있어서 GitHub에 안 올라가요)
//
// 브라우저는 이 주소 하나만 부르면 됩니다:  GET /api/jongwon/contents

const path = require('path');

// .env 파일 읽기 (파일이 없으면 그냥 넘어감)
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) {}

const TMDB_BASE = process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p/w342';
const PAGES = 3;                         // 플랫폼마다 인기순으로 몇 페이지(1페이지=20개) 가져올지
const PAGES_KR = 2;                      // 그와 별도로 한국 작품만 몇 페이지 더 가져올지
const CACHE_MS = 6 * 60 * 60 * 1000;     // 한 번 받아온 결과는 6시간 동안 재사용

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

// TMDB 장르 번호 → 우리 해시태그
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

function eraOf(year) {
    if (year >= 2023) return '최신작';
    if (year >= 2020) return '2020~2022';
    return '2019 이전';
}

async function tmdb(pathname, params = {}) {
    const url = new URL(TMDB_BASE + pathname);
    url.searchParams.set('api_key', apiKey());
    url.searchParams.set('language', 'ko-KR');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url);
    if (!res.ok) {
        const err = new Error(`TMDB 응답 오류 ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

// 한국에서 서비스 중인 OTT의 TMDB 번호 찾기
async function findProviderIds() {
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
}

// 한 플랫폼의 인기작 가져오기 (영화 + 시리즈)
// 전 세계 인기순으로만 가져오면 오래된 미국 시리즈가 위를 다 차지해서,
// 한국 작품을 따로 더 가져온 뒤 "한국 작품 + 최신작"에 가산점을 줘서 순서를 정함
async function fetchPlatform(platformId, providerId) {
    if (!providerId) return [];
    const base = {
        with_watch_providers: providerId,
        watch_region: 'KR',
        with_watch_monetization_types: 'flatrate',
        sort_by: 'popularity.desc',
        include_adult: 'false',
    };
    const jobs = [];
    for (const kind of ['movie', 'tv']) {
        const add = (extra, page) => jobs.push(
            tmdb(`/discover/${kind}`, { ...base, ...extra, page })
                .then(d => (d.results || []).map(r => ({ ...r, kind })))
                .catch(() => [])   // 한 페이지가 실패해도 나머지는 보여주기
        );
        for (let page = 1; page <= PAGES; page++) add({}, page);
        for (let page = 1; page <= PAGES_KR; page++) add({ with_origin_country: 'KR' }, page);
    }

    // 두 번 가져온 작품(전체 인기 + 한국 작품)은 하나로 합치기
    const seen = new Set();
    const raw = (await Promise.all(jobs)).flat().filter(r => {
        const key = r.kind + r.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // 순서 점수 = 인기 순위(0~1) + 한국 작품 가산점 + 최신작 가산점
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

    return raw.map((r, i) => {
        const ids = r.genre_ids || [];
        const genres = [...new Set(ids.map(id => GENRE_TAG[id]).filter(Boolean))];
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
            rank: i,   // 추천 순서 (작을수록 위)
        };
    });
}

async function loadAll() {
    const providerIds = await findProviderIds();
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

module.exports = function registerJongwonApi(app) {
    app.get('/api/jongwon/contents', async (req, res) => {
        if (!apiKey()) {
            return res.status(503).json({ error: 'no_key', message: '.env 파일에 TMDB_API_KEY가 없어요. 샘플 데이터로 보여줍니다.' });
        }
        try {
            const items = await getContents();
            res.json({ source: 'tmdb', count: items.length, items });
        } catch (e) {
            const hint = e.status === 401 ? 'API 키가 틀렸어요. .env 파일의 TMDB_API_KEY를 확인하세요.' : 'TMDB에서 데이터를 못 받아왔어요.';
            console.error('[검색 API]', hint, e.message);
            res.status(502).json({ error: 'tmdb_failed', message: hint });
        }
    });

    if (!apiKey()) console.log('ℹ️  TMDB_API_KEY가 없어서 검색 페이지는 샘플 데이터로 동작합니다. (.env 파일 확인)');
};
