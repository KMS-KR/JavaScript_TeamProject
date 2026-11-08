
const dummyData = {
    netflix: ['오징어 게임 2', '더 글로리', '경성크리처', '기묘한 이야기', '종이의 집', '스위트홈', '수리남', 'D.P.', '마스크걸', '사냥개들'],
    tving: ['환승연애3', '내 남편과 결혼해줘', '이재, 곧 죽습니다', '운수 오진 날', '피라미드 게임', '유퀴즈', '뿅뿅 지구오락실', '여고추리반', '크라임씬', '술꾼도시여자들'],
    watcha: ['좋좋소', '시맨틱 에러', '체르노빌', '킬링 이브', '이어즈&이어즈', '와이 우먼 킬', '미나리', '헤어질 결심', '에브리씽 에브리웨어', '드라이브 마이 카'],
    disney: ['무빙', '카지노', '최악의 악', '킬러들의 쇼핑몰', '비질란테', '로키', '만달로리안', '완다비전', '크루엘라', '엔드게임']
};

function renderList(platform) {
    const list = document.getElementById('top10-list');
    list.innerHTML = '';
    dummyData[platform].forEach((title, index) => {
        list.innerHTML += `
            <div class="top10-card">
                <div class="top10-rank">${index + 1}</div>
                <div class="top10-title">${title}</div>
            </div>
        `;
    });
}

document.querySelectorAll('.plat-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
        document.querySelectorAll('.plat-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        renderList(e.target.dataset.plat);
    });
});
// 초기 렌더링
renderList('netflix');
