document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const resultBox = document.getElementById('mood-result');
        resultBox.style.display = 'block';
        resultBox.innerHTML = `<strong>${e.target.innerText}</strong> 에 어울리는 추천 리스트를 불러오는 중입니다... (여기에 팀원A가 API 결과 연결)`;
    });
});