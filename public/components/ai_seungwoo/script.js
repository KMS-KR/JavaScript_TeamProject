// 승우: AI 추천 탭 화면 담당
// AI 호출은 서버(api_seungwoo.js)가 하고, 여기서는 결과를 받아 화면에 그리기만 합니다.
//   - 오늘의 AI 픽:      GET  /api/seungwoo/today
//   - 상황별 큐레이션:   POST /api/seungwoo/curate
// 포스터는 TMDB 검색(/api/tmdb/search)으로, OTT 정보는 종원 검색 데이터로 찾아 붙입니다.
import { PLATFORMS, CONTENTS as SAMPLE } from '../search_jongwon/data.js';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

const OPTIONS = {
    weather: [
        { value: '맑음', label: '☀️ 맑음' }, { value: '흐림', label: '☁️ 흐림' },
        { value: '비', label: '🌧️ 비' }, { value: '눈', label: '❄️ 눈' },
        { value: '추움', label: '🥶 추움' }, { value: '더움', label: '🥵 더움' },
    ],
    day: DAYS.map(d => ({ value: d, label: d })),
    mood: [
        { value: '지침', label: '😮‍💨 지쳤어요' }, { value: '신남', label: '😆 신나요' },
        { value: '울적', label: '😢 울적해요' }, { value: '설렘', label: '💗 설레요' },
        { value: '심심', label: '🥱 심심해요' }, { value: '스트레스', label: '🤯 스트레스 폭발' },
        { value: '생각', label: '🤔 생각에 잠기고 싶어요' },
    ],
};

const now = new Date();
const state = { weather: null, day: DAYS[now.getDay()], mood: null };   // 요일은 오늘로 미리 선택
let shown = [];          // 큐레이션에서 이미 보여준 제목 (다시 받기 때 겹치지 않게)
let catalog = SAMPLE;    // 우리 사이트 작품 목록 (OTT 배지용)
let busy = false;

const $ = id => document.getElementById(id);

// 외부 데이터에 < > 같은 기호가 있어도 화면이 깨지지 않게
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── 포스터 & OTT 정보 찾기
async function findPoster(movie) {
    for (const q of [movie.title, movie.originalTitle].filter(Boolean)) {
        try {
            const res = await fetch(`/api/tmdb/search?query=${encodeURIComponent(q)}`);
            if (!res.ok) return null;                    // TMDB 키가 없으면 포스터 없이
            const { results = [] } = await res.json();
            const hit = results.find(r => movie.year && Math.abs(Number(r.year) - movie.year) <= 1) || results[0];
            if (hit?.poster) return hit.poster;
        } catch (e) { return null; }
    }
    return null;
}

function ottOf(movie) {
    const hit = catalog.find(c => c.title === movie.title);
    return hit ? PLATFORMS.find(p => p.id === hit.platform) : null;
}

function posterHtml(movie, poster, size = '') {
    return poster
        ? `<img class="sw-poster ${size}" src="${esc(poster)}" alt="${esc(movie.title)} 포스터">`
        : `<div class="sw-poster sw-poster-empty ${size}" aria-hidden="true"><span>${esc(movie.title[0] || '?')}</span></div>`;
}

function metaHtml(m) {
    const parts = [m.year && `${m.year}`, m.director && `감독 ${m.director}`, ...(m.genres || [])].filter(Boolean);
    return `<p class="sw-meta">${parts.map(esc).join(' · ')}</p>`;
}

function ottHtml(m) {
    const p = ottOf(m);
    return p ? `<span class="sw-ott" style="--ott:${p.color}">${esc(p.name)}에서 바로 보기</span>` : '';
}

// ── 1. 오늘의 AI 픽
async function loadToday() {
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    try {
        const res = await fetch(`/api/seungwoo/today?date=${date}`);
        const data = await res.json();
        const m = data.movie;
        const poster = await findPoster(m);
        if (!$('sw-today')) return;            // 그사이 다른 페이지로 갔으면 중단

        $('sw-today-date').textContent = `${data.label} · 하루에 한 편, 매일 바뀌어요`;
        $('sw-today').innerHTML = `
            <div class="sw-today-poster">${posterHtml(m, poster, 'is-large')}</div>
            <div class="sw-today-body">
                <p class="sw-theme">오늘의 테마 <strong>${esc(data.theme.name)}</strong></p>
                <h3 class="sw-title">${esc(m.title)}${m.originalTitle && m.originalTitle !== m.title ? `<small>${esc(m.originalTitle)}</small>` : ''}</h3>
                ${metaHtml(m)}
                <p class="sw-hook">${esc(m.hook)}</p>
                <dl class="sw-why">
                    <div><dt>왜 오늘 이 영화?</dt><dd>${esc(m.whyToday)}</dd></div>
                    <div><dt>관전 포인트</dt><dd>${esc(m.watchPoint)}</dd></div>
                    <div><dt>이런 분께 추천해요</dt><dd>${esc(m.forWhom)}</dd></div>
                </dl>
                ${ottHtml(m)}
                ${data.notice ? `<p class="sw-notice">${esc(data.notice)} 지금은 기본 추천을 보여드려요.</p>` : ''}
            </div>`;
    } catch (e) {
        if ($('sw-today')) $('sw-today').innerHTML = '<div class="sw-loading">오늘의 픽을 불러오지 못했어요. 서버가 켜져 있는지 확인해 주세요.</div>';
    }
}

// ── 2. 상황별 큐레이션
function renderChips() {
    document.querySelectorAll('.sw-chips').forEach(box => {
        const key = box.dataset.key;
        box.innerHTML = OPTIONS[key].map(o => `
            <button type="button" class="sw-chip" data-key="${key}" data-value="${esc(o.value)}"
                    aria-pressed="${state[key] === o.value}">${esc(o.label)}</button>`).join('');
    });
    const ready = state.weather && state.mood && state.day;
    $('sw-go').disabled = !ready || busy;
    $('sw-go').textContent = busy ? 'AI가 분석하는 중...' : ready ? 'AI에게 추천받기' : '날씨와 기분을 골라 주세요';
}

async function curate(again = false) {
    if (busy) return;
    if (!again) shown = [];
    busy = true;
    renderChips();
    $('sw-result').innerHTML = '<div class="sw-loading">날씨, 요일, 기분을 분석하고 있어요...</div>';

    try {
        const res = await fetch('/api/seungwoo/curate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...state, hour: new Date().getHours(), avoid: shown,
                catalog: catalog.filter(c => c.type === '영화').map(c => c.title),
            }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);

        const all = [data.main, ...data.alternatives];
        shown.push(...all.map(m => m.title));
        const posters = await Promise.all(all.map(findPoster));
        if (!$('sw-result')) return;
        renderResult(data, posters);
    } catch (e) {
        if ($('sw-result')) $('sw-result').innerHTML = `<div class="sw-loading">추천을 받지 못했어요. ${esc(e.message || '')}</div>`;
    } finally {
        busy = false;
        if ($('sw-go')) renderChips();
    }
}

function renderResult(data, posters) {
    const m = data.main;
    $('sw-result').innerHTML = `
        <p class="sw-analysis"><span>AI 분석</span>${esc(data.analysis)}</p>
        ${data.notice ? `<p class="sw-notice">${esc(data.notice)} 지금은 기본 추천을 보여드려요.</p>` : ''}

        <article class="sw-main">
            ${posterHtml(m, posters[0])}
            <div class="sw-main-body">
                <p class="sw-badge">지금 상황에 찰떡인 영화</p>
                <h3 class="sw-title">${esc(m.title)}${m.originalTitle && m.originalTitle !== m.title ? `<small>${esc(m.originalTitle)}</small>` : ''}</h3>
                ${metaHtml(m)}
                <p class="sw-hook">${esc(m.hook)}</p>
                <ol class="sw-reasons">${m.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ol>
                ${ottHtml(m)}
            </div>
        </article>

        <h4 class="sw-alt-title">이게 별로라면, 이것도 있어요</h4>
        <div class="sw-alts">
            ${data.alternatives.map((a, i) => `
                <article class="sw-alt">
                    ${posterHtml(a, posters[i + 1], 'is-small')}
                    <div>
                        <h5>${esc(a.title)} <span>${esc(a.year || '')}</span></h5>
                        <p>${esc(a.reason)}</p>
                        ${ottHtml(a)}
                    </div>
                </article>`).join('')}
        </div>

        <button type="button" class="sw-again" id="sw-again">다른 영화로 다시 추천받기</button>`;
}

// ── 클릭 연결 (페이지에 올 때마다 새로 그려지니까 각 요소에 직접 연결)
document.querySelector('.sw-picker').addEventListener('click', e => {
    const chip = e.target.closest('.sw-chip');
    if (chip && !busy) {
        state[chip.dataset.key] = chip.dataset.value;
        renderChips();
    }
    if (e.target.closest('#sw-go')) curate(false);
});
$('sw-result').addEventListener('click', e => {
    if (e.target.closest('#sw-again')) curate(true);
});

// ── 시작
renderChips();
loadToday();

(async () => {
    try {    // TMDB 키가 있으면 실시간 작품 목록으로 OTT 배지 표시
        const res = await fetch('/api/jongwon/contents');
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.items) && data.items.length) catalog = data.items;
        }
    } catch (e) { /* 샘플 그대로 */ }
    try {
        const s = await (await fetch('/api/seungwoo/status')).json();
        if ($('sw-foot')) $('sw-foot').textContent = s.ai
            ? `Google Gemini(${s.model})가 추천하고 있어요. AI 추천은 가끔 틀릴 수 있어요.`
            : 'GEMINI_API_KEY가 없어서 기본(규칙 기반) 추천으로 동작하고 있어요.';
    } catch (e) { /* 무시 */ }
})();
