// 종원 - 해시태그 기반 통합 검색
import { PLATFORMS, TAG_GROUPS, CONTENTS as SAMPLE } from './data.js';

const MAX_PER_PLATFORM = 10;            // 플랫폼마다 최대 몇 개 보여줄지
const SAVE_KEY = 'ottpia-my-otts';      // 구독 OTT를 브라우저에 저장할 때 쓰는 이름

// ── 작품 데이터: 서버(/api/jongwon/contents)가 TMDB에서 받아온 걸 쓰고,
//    실패하면(키 없음 등) data.js 의 샘플을 대신 씀
let CONTENTS = SAMPLE;
let source = 'sample';

async function loadContents() {
    try {
        const res = await fetch('/api/jongwon/contents');
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.items) && data.items.length > 0) {
            CONTENTS = data.items;
            source = 'tmdb';
        }
    } catch (e) { /* 서버 연결 실패 → 샘플 그대로 */ }
}

// 글자 안의 < > 같은 기호가 태그로 해석되지 않게 바꿔주기 (외부 데이터라서 필요)
function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── 현재 선택 상태
const state = {
    tags: {},          // 예: { genres: ['액션'], moods: [] ... }
    myOtts: loadMyOtts(),
    onlyMine: false,
    keyword: '',       // 상단 검색창에 친 글자 (제목 검색)
};
TAG_GROUPS.forEach(g => { state.tags[g.key] = []; });

function loadMyOtts() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || []; }
    catch (e) { return []; }
}
function saveMyOtts() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state.myOtts)); } catch (e) {}
}

// 배열에 값이 있으면 빼고, 없으면 넣기 (칩 눌렀다 뗐다)
function toggle(list, value) {
    const i = list.indexOf(value);
    if (i === -1) list.push(value); else list.splice(i, 1);
}

// ── 화면 그리기: OTT 칩
function renderOttChips() {
    const box = document.getElementById('sj-ott-chips');
    box.innerHTML = PLATFORMS.map(p => `
        <button type="button" class="sj-chip ott ${state.myOtts.includes(p.id) ? 'on' : ''}"
                style="--sj-color:${p.color}" data-ott="${p.id}"
                aria-pressed="${state.myOtts.includes(p.id)}">${p.name}</button>
    `).join('');
}

// ── 화면 그리기: 해시태그 칩
function renderTagGroups() {
    const box = document.getElementById('sj-tag-groups');
    box.innerHTML = TAG_GROUPS.map(g => `
        <div class="sj-group">
            <span class="sj-group-name">${g.name}</span>
            <div class="sj-chips">
                ${g.tags.map(t => `
                    <button type="button" class="sj-chip ${state.tags[g.key].includes(t) ? 'on' : ''}"
                            data-group="${g.key}" data-tag="${t}"
                            aria-pressed="${state.tags[g.key].includes(t)}">#${t}</button>
                `).join('')}
            </div>
        </div>
    `).join('');
}

// ── 검색 규칙
// 같은 묶음 안에서는 하나만 맞아도 OK (액션 또는 스릴러)
// 다른 묶음끼리는 모두 맞아야 함 (장르도 맞고 기분도 맞고)
function matchesTags(item) {
    return TAG_GROUPS.every(g => {
        const picked = state.tags[g.key];
        if (picked.length === 0) return true;
        return picked.some(t => item[g.key].includes(t));
    });
}

function matchesKeyword(item) {
    return !state.keyword || item.title.toLowerCase().includes(state.keyword);
}

// 선택한 태그와 몇 개나 겹치는지 (많이 겹칠수록 위로)
function score(item) {
    let n = 0;
    TAG_GROUPS.forEach(g => {
        state.tags[g.key].forEach(t => { if (item[g.key].includes(t)) n++; });
    });
    return n;
}

function pickedTags() {
    return TAG_GROUPS.flatMap(g => state.tags[g.key]);
}

function byRank(a, b) {
    return score(b) - score(a) || (a.rank ?? 0) - (b.rank ?? 0) || b.year - a.year;
}

// 지금 보여줄 플랫폼 (구독 중인 OTT만 보기 체크 반영)
function visiblePlatforms() {
    return state.onlyMine ? PLATFORMS.filter(p => state.myOtts.includes(p.id)) : PLATFORMS;
}

// ── 결과 만들기 (1) 내 브라우저가 가진 목록에서 찾기
//    태그를 안 골랐을 때, 그리고 샘플 데이터로 동작할 때 사용
//    모자라면 태그가 하나라도 맞는 작품을 "비슷한 작품"으로 채움
function searchLocal(platformId) {
    const mine = CONTENTS.filter(item => item.platform === platformId);
    const exact = mine.filter(matchesTags).sort(byRank).slice(0, MAX_PER_PLATFORM);
    if (pickedTags().length === 0 || exact.length >= MAX_PER_PLATFORM) return exact;

    const similar = mine
        .filter(item => !exact.includes(item) && score(item) > 0)
        .sort(byRank)
        .slice(0, MAX_PER_PLATFORM - exact.length)
        .map(item => ({ ...item, similar: true }));
    return [...exact, ...similar];
}

// ── 결과 만들기 (2) 서버에 태그 조건을 보내서 TMDB에서 직접 찾기
//    서버가 플랫폼마다 최대 10개를 채워서 돌려줌 (모자라면 비슷한 작품 포함)
async function searchServer(platforms) {
    const params = new URLSearchParams();
    TAG_GROUPS.forEach(g => {
        if (state.tags[g.key].length) params.set(g.key, state.tags[g.key].join(','));
    });
    params.set('otts', platforms.map(p => p.id).join(','));
    const res = await fetch('/api/jongwon/search?' + params);
    if (!res.ok) throw new Error('search failed');
    return (await res.json()).platforms || {};
}

// ── 카드를 눌렀을 때 갈 곳
//    영화: 규빈 님의 작품 정보 페이지 (/community.html?movie=TMDB번호)
//    시리즈: 작품 정보 페이지가 아직 영화만 지원해서, TMDB 사이트의 작품 페이지를 새 탭으로 엶
//    샘플 데이터(TMDB 번호 없음): 갈 곳이 없어서 누를 수 없음
function linkOf(item) {
    const id = Number(item.tmdbId);
    if (!Number.isInteger(id) || id <= 0) return null;
    if (item.type === '영화') return { href: `/community.html?movie=${id}`, external: false };
    return { href: `https://www.themoviedb.org/tv/${id}`, external: true };
}

// ── 화면 그리기: 카드 한 장
function cardHtml(item, i, p, picked) {
    const tags = [...item.genres, ...item.moods];
    const link = linkOf(item);
    const tag = link ? 'a' : 'article';
    const linkAttrs = !link ? ''
        : link.external
            ? ` href="${esc(link.href)}" target="_blank" rel="noopener noreferrer" title="TMDB에서 작품 정보 보기 (새 탭)"`
            : ` href="${esc(link.href)}" title="작품 정보 보기"`;
    return `
        <${tag} class="sj-card ${item.poster ? 'has-poster' : ''} ${item.similar ? 'similar' : ''} ${link ? 'is-link' : ''}" style="--sj-color:${p.color}"${linkAttrs}>
            ${item.poster ? `<img class="sj-card-poster" src="${esc(item.poster)}" alt="${esc(item.title)} 포스터" loading="lazy">` : ''}
            <div class="sj-card-rank">${i + 1}</div>
            ${item.similar ? '<div class="sj-card-similar">비슷한 작품</div>' : ''}
            <div class="sj-card-title">${esc(item.title)}${link && link.external ? ' <span class="sj-card-ext" aria-hidden="true">↗</span>' : ''}</div>
            <div class="sj-card-meta">${[item.year, item.type, item.country[0]].filter(Boolean).map(esc).join(' · ')}</div>
            <div class="sj-card-line">${esc(item.line) || '줄거리 정보가 아직 없어요.'}</div>
            <div class="sj-card-tags">
                ${tags.map(t => `<span class="${picked.includes(t) ? 'hit' : ''}">#${esc(t)}</span>`).join('')}
            </div>
        </${tag}>`;
}

// ── 화면 그리기: 결과 전체
let searchSeq = 0;   // 태그를 빠르게 여러 번 누르면, 늦게 도착한 예전 결과는 버리기 위한 번호

async function renderResults() {
    const seq = ++searchSeq;
    const picked = pickedTags();
    const platforms = visiblePlatforms();
    const summary = document.getElementById('sj-summary');
    const results = document.getElementById('sj-results');

    if (state.onlyMine && state.myOtts.length === 0) {
        summary.innerHTML = '';
        results.innerHTML = '<div class="sj-empty">구독 중인 OTT를 위에서 먼저 골라주세요.</div>';
        return;
    }

    // 플랫폼별 결과 모으기
    let lists = null;
    if (source === 'tmdb' && picked.length > 0) {
        summary.textContent = '조건에 맞는 작품을 찾는 중이에요...';
        results.classList.add('loading');
        try {
            lists = await searchServer(platforms);
        } catch (e) { /* 서버 검색 실패 → 아래에서 내 목록으로 대신 찾음 */ }
        if (seq !== searchSeq || !document.getElementById('sj-results')) return;   // 그사이 다른 태그를 눌렀거나 페이지를 떠남
        results.classList.remove('loading');
    }
    const listOf = p => (lists ? lists[p.id] || [] : searchLocal(p.id)).filter(matchesKeyword);

    let exactTotal = 0;
    let similarTotal = 0;
    const rowsHtml = platforms.map(p => {
        const list = listOf(p);
        const similarCount = list.filter(item => item.similar).length;
        exactTotal += list.length - similarCount;
        similarTotal += similarCount;

        const countText = similarCount
            ? `${list.length}개 <span class="sj-row-similar">(비슷한 작품 ${similarCount}개 포함)</span>`
            : `${list.length}개`;
        return `
            <section class="sj-row" style="--sj-color:${p.color}">
                <div class="sj-row-head">
                    <span class="sj-row-name">${p.name}</span>
                    <span class="sj-row-count">${countText}</span>
                    ${state.myOtts.includes(p.id) ? '<span class="sj-row-mine">구독 중</span>' : ''}
                </div>
                ${list.length
                    ? `<div class="sj-scroll">${list.map((item, i) => cardHtml(item, i, p, picked)).join('')}</div>`
                    : '<div class="sj-empty">조건에 맞는 작품이 없어요. 태그를 줄여보세요.</div>'}
            </section>`;
    }).join('');

    const tagText = picked.length ? picked.map(t => '#' + t).join(' ') : '전체';
    const keywordText = state.keyword ? ` · 제목에 "${esc(state.keyword)}"` : '';
    const similarText = similarTotal ? ` + 비슷한 작품 ${similarTotal}개` : '';
    summary.innerHTML = `<strong>${tagText}</strong>${keywordText} 검색 결과 · ${platforms.length}개 플랫폼에서 <strong>${exactTotal}개</strong>${similarText}`;
    results.innerHTML = rowsHtml;

    document.getElementById('sj-source').textContent = source === 'tmdb'
        ? '실시간 데이터 · This product uses the TMDB API but is not endorsed or certified by TMDB.'
        : '지금은 샘플 데이터예요. (서버에 TMDB 키가 없거나 연결에 실패했어요)';
}

// ── 클릭 연결
document.getElementById('sj-ott-chips').addEventListener('click', e => {
    const btn = e.target.closest('[data-ott]');
    if (!btn) return;
    toggle(state.myOtts, btn.dataset.ott);
    saveMyOtts();
    renderOttChips();
    renderResults();
});

document.getElementById('sj-tag-groups').addEventListener('click', e => {
    const btn = e.target.closest('[data-tag]');
    if (!btn) return;
    toggle(state.tags[btn.dataset.group], btn.dataset.tag);
    renderTagGroups();
    renderResults();
});

document.getElementById('sj-only-mine').addEventListener('change', e => {
    state.onlyMine = e.target.checked;
    renderResults();
});

document.getElementById('sj-reset').addEventListener('click', () => {
    TAG_GROUPS.forEach(g => { state.tags[g.key] = []; });
    renderTagGroups();
    renderResults();
});

// 상단 메뉴의 검색창에 글자를 치면 제목으로도 걸러주기 (검색 페이지에 있을 때만)
const navSearch = document.querySelector('.search-bar');
if (navSearch) {
    state.keyword = navSearch.value.trim().toLowerCase();
    navSearch.oninput = () => {
        if (!document.getElementById('sj-results')) return;
        state.keyword = navSearch.value.trim().toLowerCase();
        renderResults();
    };
}

// ── 처음 한 번 그리기
renderOttChips();
renderTagGroups();
document.getElementById('sj-summary').textContent = '작품 정보를 불러오는 중이에요...';
await loadContents();
if (document.getElementById('sj-results')) renderResults();   // 그사이 다른 페이지로 갔으면 건너뜀
