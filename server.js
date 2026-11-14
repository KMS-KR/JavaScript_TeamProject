const express = require('express');
const path = require('path');
const { loadLocalEnv, registerTmdbRoutes } = require('./tmdb-api');
loadLocalEnv(path.join(__dirname, '.env'));
const app = express();
const PORT = 3000;

registerTmdbRoutes(app);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 종원: 검색 페이지용 TMDB API (키는 .env 에서 읽음)
require('./api_jongwon')(app);

// 승우: AI 추천 탭 (Gemini API, 키는 .env 의 GEMINI_API_KEY)
require('./api_seungwoo')(app);

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});