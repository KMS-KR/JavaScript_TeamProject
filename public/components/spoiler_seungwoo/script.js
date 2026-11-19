// 승우: 커뮤니티 > 스포일러 화면 담당
// 1) 영화 + 시리즈 검색   GET /api/seungwoo/spoiler/search?query=...
// 2) 줄거리 + 결말        GET /api/seungwoo/spoiler?type=movie|tv&tmdbId=...   (서버: api_seungwoo.js)
// 시리즈는 시즌을 나누지 않고 작품 전체의 결말만 보여 줍니다. 국내 OTT 정보도 같이 보여 줍니다.
// 줄거리와 결말은 처음에 흐리게(블러) 가려 두고, 버튼을 눌러야 보입니다.

const EXAMPLES = ['기생충', '인셉션', '식스 센스', '오징어 게임', '더 글로리', '브레이킹 배드'];
const TYPE_LABEL = { movie: '영화', tv: '시리즈' };

const $ = id => document.getElementById(id);
let requestNo = 0;   // 검색을 빠르게 여러 번 해도 마지막 결과만 그리기

// 외부 데이터에 < > 같은 기호가 있어도 화면이 깨지지 않게
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const paragraphs = str => String(str || '').split('\n').map(s => s.trim()).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('');

function posterHtml(movie) {
    return movie.poster
        ? `<img class="sp-poster" src="${esc(movie.poster)}" alt="${esc(movie.title)} 포스터">`
        : `<div class="sp-poster sp-poster-empty" aria-hidden="true"><span>${esc((movie.title || '?')[0])}</span></div>`;
}

// ── 1. 검색
async function search(query) {
    query = query.trim();
    if (!query) return;
    const no = ++requestNo;
    $('sp-card').hidden = true;
    $('sp-results').innerHTML = '<p class="sp-loading">작품을 찾는 중이에요...</p>';

    try {
        const res = await fetch(`/api/seungwoo/spoiler/search?query=${encodeURIComponent(query)}`);
        if (no !== requestNo || !$('sp-results')) return;
        if (!res.ok) {
            // TMDB 키가 없거나 오류면 제목으로 바로 스포일러 찾기
            $('sp-results').innerHTML = '';
            return openSpoiler({ title: query }, '작품 검색(TMDB)을 쓸 수 없어서 제목으로 바로 찾았어요.');
        }
        const { results = [] } = await res.json();
        if (!results.length) {
            $('sp-results').innerHTML = `<p class="sp-empty">"${esc(query)}"에 해당하는 영화나 시리즈를 찾지 못했어요. 제목을 다시 확인해 주세요.</p>`;
            return;
        }
        const list = results.slice(0, 8);
        $('sp-results').innerHTML = `
            <p class="sp-results-head">어떤 작품인가요? <span>골라 주세요</span></p>
            <ul class="sp-list">
                ${list.map((m, i) => `
                <li><button type="button" class="sp-item" data-index="${i}">
                    <span class="sp-thumb">${posterHtml(m)}<em class="sp-type sp-type-${m.type === 'tv' ? 'tv' : 'movie'}">${TYPE_LABEL[m.type] || '영화'}</em></span>
                    <strong>${esc(m.title)}</strong>
                    <span>${esc([m.year, m.originalTitle !== m.title ? m.originalTitle : ''].filter(Boolean).join(' · '))}</span>
                </button></li>`).join('')}
            </ul>`;
        $('sp-results').querySelectorAll('.sp-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const m = list[Number(btn.dataset.index)];
                $('sp-results').querySelectorAll('.sp-item').forEach(b => b.classList.toggle('is-picked', b === btn));
                openSpoiler({ tmdbId: m.id, type: m.type, title: m.title, year: m.year, poster: m.poster, originalTitle: m.originalTitle });
            });
        });
        if (list.length === 1) $('sp-results').querySelector('.sp-item').click();
    } catch (e) {
        if ($('sp-results')) $('sp-results').innerHTML = '<p class="sp-empty">검색하지 못했어요. 서버가 켜져 있는지 확인해 주세요.</p>';
    }
}

// ── 2. 줄거리 + 결말 불러오기
async function openSpoiler(picked, extraNotice = '') {
    const no = ++requestNo;
    const card = $('sp-card');
    card.hidden = false;
    card.innerHTML = `<p class="sp-loading">「${esc(picked.title)}」의 줄거리와 결말을 정리하고 있어요...<br><small>AI 요약은 10초 정도 걸릴 수 있어요.</small></p>`;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
        const params = picked.tmdbId
            ? `type=${picked.type === 'tv' ? 'tv' : 'movie'}&tmdbId=${encodeURIComponent(picked.tmdbId)}`
            : `title=${encodeURIComponent(picked.title)}`;
        const res = await fetch(`/api/seungwoo/spoiler?${params}`);
        const data = await res.json();
        if (no !== requestNo || !$('sp-card')) return;
        if (!res.ok) throw new Error(data.message);

        // 검색 결과에 있던 포스터·연도를 우선 사용
        const movie = { ...data.movie, poster: picked.poster || data.movie.poster, year: picked.year || data.movie.year };
        renderCard(movie, data, [extraNotice, data.notice].filter(Boolean).join(' '));
    } catch (e) {
        if (no === requestNo && $('sp-card')) {
            card.innerHTML = `<p class="sp-empty">${esc(e.message || '줄거리를 불러오지 못했어요.')}</p>`;
        }
    }
}

function block(key, label, body, emptyText, tag = '') {
    const title = `${label}${tag ? ` <small class="sp-block-tag">${esc(tag)}</small>` : ''}`;
    if (!body) {
        return `<section class="sp-block sp-block-${key} is-empty">
            <h3 class="sp-block-title">${title}</h3>
            <p class="sp-block-empty">${esc(emptyText)}</p>
        </section>`;
    }
    return `<section class="sp-block sp-block-${key}" data-key="${key}">
        <div class="sp-block-head">
            <h3 class="sp-block-title">${title}</h3>
            <button type="button" class="sp-hide" hidden>다시 가리기</button>
        </div>
        <div class="sp-veil">
            <div class="sp-text" aria-hidden="true" inert>${paragraphs(body)}</div>
            <button type="button" class="sp-reveal">
                <span class="sp-reveal-icon" aria-hidden="true">👁</span>
                ${label} 보기
                <small>${key === 'ending' ? (tag ? '마지막 시즌까지의 결말과 반전이 그대로 나와요' : '결말과 반전이 그대로 나와요') : '결말 직전까지의 내용이 나와요'}</small>
            </button>
        </div>
    </section>`;
}

// 국내에서 볼 수 있는 OTT (TMDB 가 JustWatch 에서 받아 온 정보)
function providersHtml(p) {
    if (!p || !p.list || !p.list.length) return '';
    return `<div class="sp-ott">
        <span class="sp-ott-label">볼 수 있는 곳</span>
        <ul class="sp-ott-list">
            ${p.list.map(o => `<li>${o.logo ? `<img src="${esc(o.logo)}" alt="" loading="lazy">` : ''}${esc(o.name)}</li>`).join('')}
        </ul>
        <small class="sp-ott-credit">${p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">` : ''}JustWatch 제공${p.link ? '</a>' : ''}</small>
    </div>`;
}

function renderCard(movie, data, notice) {
    const card = $('sp-card');
    const isTv = movie.type === 'tv';
    const sub = [
        movie.year,
        isTv && movie.seasons ? `시즌 ${movie.seasons}개` : '',
        movie.status,
        movie.originalTitle && movie.originalTitle !== movie.title ? movie.originalTitle : '',
    ].filter(Boolean).join(' · ');
    const badge = { ai: 'AI 요약 · 위키백과 기반', source: '위키백과 원문', none: '' }[data.mode];
    if (isTv && data.found && data.ongoing && data.ending) {
        notice = ['아직 방영 중인 시리즈라서, 결말은 위키백과에 나온 가장 최근 내용까지만 정리했어요.', notice].filter(Boolean).join(' ');
    }

    card.innerHTML = `
        <div class="sp-head">
            ${posterHtml(movie)}
            <div class="sp-head-body">
                <p class="sp-warn"><span class="sp-type sp-type-${isTv ? 'tv' : 'movie'}">${isTv ? '시리즈' : '영화'}</span>⚠️ 이 아래부터 스포일러가 있어요</p>
                <h2 class="sp-title">${esc(movie.title)}${sub ? `<small>${esc(sub)}</small>` : ''}</h2>
                ${movie.overview ? `<p class="sp-overview"><span>스포일러 없는 소개</span>${esc(movie.overview)}</p>` : ''}
                ${providersHtml(data.providers)}
            </div>
        </div>

        ${data.found ? `
        <div class="sp-toolbar">
            ${badge ? `<span class="sp-badge">${badge}</span>` : ''}
            <button type="button" class="sp-all" id="sp-all">모두 보기</button>
        </div>
        <div class="sp-blocks">
            ${block('plot', '줄거리', data.plot, '')}
            ${block('ending', '결말', data.ending, isTv
                ? '위키백과에 이 시리즈가 어떻게 끝나는지는 나와 있지 않아요. 결말을 지어내지 않도록 비워 두었어요.'
                : '위키백과 줄거리에 결말 부분이 따로 나와 있지 않아요.', isTv ? '시리즈 전체' : '')}
        </div>` : ''}

        ${notice ? `<p class="sp-notice">${esc(notice)}</p>` : ''}

        ${data.source ? `
        <p class="sp-source">
            출처: <a href="${esc(data.source.url)}" target="_blank" rel="noopener noreferrer">${data.source.lang === 'ko' ? '한국어' : '영어'} 위키백과 「${esc(data.source.title)}」</a>
            (<a href="${esc(data.source.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(data.source.license)}</a>)${data.mode === 'ai' ? ' 줄거리를 AI가 요약했어요. 요약이 틀릴 수 있으니 정확한 내용은 원문을 확인해 주세요.' : ''}
        </p>` : ''}`;

    card.querySelectorAll('.sp-block[data-key]').forEach(sec => {
        sec.querySelector('.sp-reveal').addEventListener('click', () => setOpen(sec, true));
        sec.querySelector('.sp-hide').addEventListener('click', () => setOpen(sec, false));
    });
    const all = $('sp-all');
    if (all) {
        all.addEventListener('click', () => {
            const open = !card.querySelectorAll('.sp-block[data-key]:not(.is-open)').length;
            card.querySelectorAll('.sp-block[data-key]').forEach(sec => setOpen(sec, !open));
        });
        syncAllButton();
    }
}

function setOpen(sec, open) {
    sec.classList.toggle('is-open', open);
    const textBox = sec.querySelector('.sp-text');
    textBox.setAttribute('aria-hidden', String(!open));
    textBox.inert = !open;
    sec.querySelector('.sp-reveal').hidden = open;
    sec.querySelector('.sp-hide').hidden = !open;
    if (!open) textBox.scrollTop = 0;
    syncAllButton();
}

function syncAllButton() {
    const all = $('sp-all');
    if (!all) return;
    const closed = $('sp-card').querySelectorAll('.sp-block[data-key]:not(.is-open)').length;
    all.textContent = closed ? '모두 보기' : '모두 가리기';
}

// ── 시작
$('sp-examples').innerHTML = '<span>예시</span>' + EXAMPLES.map(t => `<button type="button" class="sp-example">${esc(t)}</button>`).join('');
$('sp-examples').querySelectorAll('.sp-example').forEach(btn => {
    btn.addEventListener('click', () => { $('sp-query').value = btn.textContent; search(btn.textContent); });
});
$('sp-search').addEventListener('submit', e => { e.preventDefault(); search($('sp-query').value); });
