'use strict';
// Express 외 추가 패키지 없이 동작하는, 읽기 전용 TMDB 프록시입니다.
const fs = require('fs');
const https = require('https');

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

// 이 프로젝트에서 사용하는 단순 KEY=value .env 형식만 읽습니다.
// 이미 배포 환경에 설정된 환경변수는 덮어쓰지 않습니다. 실행 위치와 무관합니다.
function loadLocalEnv(filename) {
  let content;
  try { content = fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''); }
  catch (err) { if (err.code === 'ENOENT') return; throw err; }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    process.env[match[1]] = value;
  }
}

function positiveInteger(value, name, max = 2147483647) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) {
    throw new ApiError(400, 'INVALID_INPUT', `${name} 값이 올바르지 않습니다.`);
  }
  return Number(value);
}
function pageNumber(value) { return value === undefined ? 1 : positiveInteger(value, '페이지', 500); }
function reviewLanguage(value) {
  const language = value === undefined ? 'ko-KR' : value;
  if (!['ko-KR', 'en-US'].includes(language)) throw new ApiError(400, 'INVALID_LANGUAGE', '지원 언어는 ko-KR, en-US입니다.');
  return language;
}
function imageUrl(value) {
  return typeof value === 'string' && /^\/[A-Za-z0-9_.-]+\.(jpg|png|webp)$/i.test(value) ? `https://image.tmdb.org/t/p/w500${value}` : '';
}
function movieRecord(raw, details = false, overviewLanguage = 'ko-KR') {
  const id = Number(raw.id);
  const credits = raw.credits || {};
  return {
    id: String(id), tmdbId: id, source: 'tmdb', detailLoaded: details,
    title: raw.title || raw.original_title || '제목 미등록', originalTitle: raw.original_title || '',
    year: (raw.release_date || '').slice(0, 4), releaseDate: raw.release_date || '',
    runtime: Number.isFinite(raw.runtime) && raw.runtime > 0 ? raw.runtime : null,
    country: (raw.production_countries || []).map((c) => c.name).filter(Boolean).join(' · '),
    genres: (raw.genres || []).map((g) => g.name).filter(Boolean),
    director: (credits.crew || []).filter((c) => c.job === 'Director').map((c) => c.name).filter(Boolean).join(' · '),
    cast: (credits.cast || []).slice(0, 8).map((c) => c.name).filter(Boolean),
    tagline: raw.tagline || '', synopsis: raw.overview || '', overviewLanguage,
    keywords: [], tone: 'space', poster: imageUrl(raw.poster_path),
    tmdbRating: Number.isFinite(raw.vote_average) ? raw.vote_average : null,
    tmdbVoteCount: Number.isFinite(raw.vote_count) ? raw.vote_count : 0,
    tmdbUrl: `https://www.themoviedb.org/movie/${id}`,
  };
}

function upstreamJSON(url, headers, get = https.get) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let request;
    const timer = setTimeout(() => {
      finish(new ApiError(504, 'TMDB_TIMEOUT', 'TMDB 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.'));
      request?.destroy();
    }, 10000);
    function finish(error, data) {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (error) reject(error); else resolve(data);
    }
    try {
      request = get(url, { headers }, (response) => {
        const status = response.statusCode || 502;
        if (status !== 200) {
          response.resume();
          const errors = {
            401: [502, 'TMDB_AUTH_FAILED', 'TMDB 인증에 실패했습니다. 서버의 토큰 또는 API 키를 확인해 주세요.'],
            403: [502, 'TMDB_AUTH_FAILED', 'TMDB 접근이 거부되었습니다. 서버의 API 사용 권한을 확인해 주세요.'],
            404: [404, 'MOVIE_NOT_FOUND', 'TMDB에 해당 작품이 없습니다.'],
            429: [429, 'TMDB_RATE_LIMIT', 'TMDB 요청이 많습니다. 잠시 후 다시 시도해 주세요.'],
          };
          finish(new ApiError(...(errors[status] || [502, 'TMDB_UNAVAILABLE', 'TMDB에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'])));
          return;
        }
        let bytes = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > 5 * 1024 * 1024) {
            finish(new ApiError(502, 'TMDB_RESPONSE_TOO_LARGE', 'TMDB 응답 크기가 허용 범위를 초과했습니다.'));
            response.destroy();
          } else chunks.push(Buffer.from(chunk));
        });
        response.on('end', () => {
          if (finished) return;
          try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { finish(new ApiError(502, 'TMDB_INVALID_RESPONSE', 'TMDB에서 올바르지 않은 응답을 받았습니다.')); }
        });
        response.on('error', () => finish(new ApiError(502, 'TMDB_NETWORK_ERROR', 'TMDB 데이터 수신에 실패했습니다.')));
      });
      request.on('error', () => finish(new ApiError(502, 'TMDB_NETWORK_ERROR', 'TMDB에 연결할 수 없습니다. 네트워크를 확인해 주세요.')));
    } catch { finish(new ApiError(502, 'TMDB_NETWORK_ERROR', 'TMDB 요청을 시작할 수 없습니다.')); }
  });
}

function createTmdbService({ token = '', apiKey = '', requestJSON = upstreamJSON, now = Date.now } = {}) {
  token = token.trim().replace(/^Bearer\s+/i, '');
  apiKey = apiKey.trim();
  const configured = Boolean((token || apiKey) && !/[\r\n]/.test(token + apiKey));
  const cache = new Map();
  const inFlight = new Map();
  const ttl = 5 * 60 * 1000;
  async function request(endpoint, params = {}) {
    if (!configured) throw new ApiError(503, 'TMDB_NOT_CONFIGURED', 'TMDB 인증 정보가 없습니다. 서버 루트의 .env를 설정하고 npm start를 다시 실행해 주세요.');
    const url = new URL(`https://api.themoviedb.org/3${endpoint}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    if (!token) url.searchParams.set('api_key', apiKey);
    const key = endpoint + '?' + new URLSearchParams(params).toString();
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.data;
    if (inFlight.has(key)) return inFlight.get(key);
    if (inFlight.size >= 12) throw new ApiError(503, 'SERVER_BUSY', '현재 요청이 많습니다. 잠시 후 다시 시도해 주세요.');
    const promise = (async () => {
      const headers = { accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const data = await requestJSON(url, headers);
      cache.delete(key);
      if (cache.size >= 200) cache.delete(cache.keys().next().value);
      cache.set(key, { data, expires: now() + ttl });
      return data;
    })();
    inFlight.set(key, promise);
    try { return await promise; } finally { inFlight.delete(key); }
  }
  return {
    configured,
    async search(query, page = 1) {
      const raw = await request('/search/movie', { query, language: 'ko-KR', include_adult: false, page });
      return { results: (raw.results || []).filter((m) => !m.adult && Number.isSafeInteger(m.id) && m.id > 0).map((m) => movieRecord(m)), page: raw.page || page, totalPages: Math.min(500, raw.total_pages || 0), totalResults: raw.total_results || 0 };
    },
    async movie(id) {
      let raw = await request(`/movie/${id}`, { language: 'ko-KR', append_to_response: 'credits' });
      if (raw.adult) throw new ApiError(404, 'MOVIE_NOT_FOUND', '표시할 수 없는 작품입니다.');
      let overviewLanguage = 'ko-KR';
      if (!raw.overview) {
        try {
          const english = await request(`/movie/${id}`, { language: 'en-US' });
          if (english.overview) { raw = { ...raw, overview: english.overview }; overviewLanguage = 'en-US'; }
        } catch { /* 번역 보완 실패는 한국어 상세 정보 표시를 막지 않습니다. */ }
      }
      return { movie: movieRecord(raw, true, overviewLanguage) };
    },
    async reviews(id, language, page = 1) {
      const raw = await request(`/movie/${id}/reviews`, { language, page });
      return {
        movieId: String(id), language, page: raw.page || page,
        totalPages: Math.min(500, raw.total_pages || 0), totalResults: raw.total_results || 0,
        results: (raw.results || []).map((r) => {
          const rating = r.author_details?.rating;
          const reviewId = String(r.id || '');
          return {
            id: reviewId, author: r.author_details?.name || r.author || r.author_details?.username || 'TMDB 이용자',
            rating: typeof rating === 'number' && Number.isFinite(rating) && rating >= 0 && rating <= 10 ? rating : null,
            content: typeof r.content === 'string' ? r.content : '', createdAt: r.created_at || '',
            // 외부 응답의 임의 URL 대신 TMDB 도메인 원문 링크만 생성합니다.
            url: /^[A-Za-z0-9]+$/.test(reviewId) ? `https://www.themoviedb.org/review/${reviewId}` : `https://www.themoviedb.org/movie/${id}/reviews`,
          };
        }),
      };
    },
  };
}

function registerTmdbRoutes(app, { service } = {}) {
  const client = service || createTmdbService({ token: process.env.TMDB_READ_ACCESS_TOKEN || '', apiKey: process.env.TMDB_API_KEY || '' });
  const buckets = new Map();
  app.use('/api/tmdb', (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: '조회만 지원합니다.' } });
    const key = req.ip || 'unknown';
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.expires <= now) { bucket = { count: 0, expires: now + 60000 }; buckets.delete(key); buckets.set(key, bucket); }
    if (buckets.size > 2000) buckets.delete(buckets.keys().next().value);
    if (++bucket.count > 120) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: { code: 'RATE_LIMIT', message: '요청이 많습니다. 1분 후 다시 시도해 주세요.' } }); }
    next();
  });
  function route(fn) {
    return async (req, res) => {
      try { res.json(await fn(req)); }
      catch (err) {
        const known = err instanceof ApiError;
        // upstream의 원문 오류, 요청 URL, 인증 값은 클라이언트나 로그에 내보내지 않습니다.
        res.status(known ? err.status : 502).json({ error: { code: known ? err.code : 'TMDB_ERROR', message: known ? err.message : 'TMDB 데이터를 불러오지 못했습니다.' } });
      }
    };
  }
  app.get('/api/tmdb/status', route(async () => ({ configured: client.configured })));
  app.get('/api/tmdb/search', route(async (req) => {
    const query = req.query.query ?? req.query.q;
    if (typeof query !== 'string' || !query.trim() || query.trim().length > 100) throw new ApiError(400, 'INVALID_QUERY', '검색어를 1~100자로 입력해 주세요.');
    return client.search(query.trim(), pageNumber(req.query.page));
  }));
  app.get('/api/tmdb/movies/:id', route(async (req) => client.movie(positiveInteger(req.params.id, '영화 ID'))));
  app.get('/api/tmdb/movies/:id/reviews', route(async (req) => client.reviews(positiveInteger(req.params.id, '영화 ID'), reviewLanguage(req.query.language), pageNumber(req.query.page))));
  app.use('/api/tmdb', (req, res) => res.status(404).json({ error: { code: 'API_NOT_FOUND', message: '존재하지 않는 TMDB API 경로입니다.' } }));
  return client;
}

module.exports = { ApiError, loadLocalEnv, positiveInteger, pageNumber, reviewLanguage, movieRecord, upstreamJSON, createTmdbService, registerTmdbRoutes };
