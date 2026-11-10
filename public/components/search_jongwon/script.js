// 종원 - 해시태그 기반 통합 검색
import { PLATFORMS, TAG_GROUPS, CONTENTS } from './data.js';

const MAX_PER_PLATFORM = 10;            // 플랫폼마다 최대 몇 개 보여줄지
const SAVE_KEY = 'ottpia-my-otts';      // 구독 OTT를 브라우저에 저장할 때 쓰는 이름

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
function matches(item) {
    if (state.keyword && !item.title.toLowerCase().includes(state.keyword)) return false;
    return TAG_GROUPS.every(g => {
        const picked = state.tags[g.key];
        if (picked.length === 0) return true;
        return picked.some(t => item[g.key].includes(t));
    });
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

// ── 화면 그리기: 결과
function renderResults() {
    const picked = pickedTags();

    // 보여줄 플랫폼 정하기
    let platforms = PLATFORMS;
    if (state.onlyMine) platforms = PLATFORMS.filter(p => state.myOtts.includes(p.id));

    const summary = document.getElementById('sj-summary');
    const results = document.getElementById('sj-results');

    if (state.onlyMine && state.myOtts.length === 0) {
        summary.innerHTML = '';
        results.innerHTML = '<div class="sj-empty">구독 중인 OTT를 위에서 먼저 골라주세요.</div>';
        return;
    }

    let total = 0;
    const rowsHtml = platforms.map(p => {
        const list = CONTENTS
            .filter(item => item.platform === p.id && matches(item))
            .sort((a, b) => score(b) - score(a) || b.year - a.year)
            .slice(0, MAX_PER_PLATFORM);
        total += list.length;

        const cards = list.map((item, i) => {
            const tags = [...item.genres, ...item.moods];
            return `
                <article class="sj-card" style="--sj-color:${p.color}">
                    <div class="sj-card-rank">${i + 1}</div>
                    <div class="sj-card-title">${item.title}</div>
                    <div class="sj-card-meta">${item.year} · ${item.type} · ${item.country[0]}</div>
                    <div class="sj-card-line">${item.line}</div>
                    <div class="sj-card-tags">
                        ${tags.map(t => `<span class="${picked.includes(t) ? 'hit' : ''}">#${t}</span>`).join('')}
                    </div>
                </article>`;
        }).join('');

        return `
            <section class="sj-row" style="--sj-color:${p.color}">
                <div class="sj-row-head">
                    <span class="sj-row-name">${p.name}</span>
                    <span class="sj-row-count">${list.length}개</span>
                    ${state.myOtts.includes(p.id) ? '<span class="sj-row-mine">구독 중</span>' : ''}
                </div>
                ${list.length
                    ? `<div class="sj-scroll">${cards}</div>`
                    : '<div class="sj-empty">조건에 맞는 작품이 없어요. 태그를 줄여보세요.</div>'}
            </section>`;
    }).join('');

    const tagText = picked.length ? picked.map(t => '#' + t).join(' ') : '전체';
    const keywordText = state.keyword ? ` · 제목에 "${state.keyword}"` : '';
    summary.innerHTML = `<strong>${tagText}</strong>${keywordText} 검색 결과 · ${platforms.length}개 플랫폼에서 <strong>${total}개</strong>`;
    results.innerHTML = rowsHtml;
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
renderResults();
