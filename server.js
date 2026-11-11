const express = require('express');
const path = require('path');
const { loadLocalEnv, registerTmdbRoutes } = require('./tmdb-api');
loadLocalEnv(path.join(__dirname, '.env'));
const app = express();
const PORT = 3000;

registerTmdbRoutes(app);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});