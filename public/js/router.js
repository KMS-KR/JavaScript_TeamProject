import { loadComponent } from './core.js';

async function loadView() {
    let hash = window.location.hash || '#home';
    const viewName = hash.replace('#', '');
    const appRoot = document.getElementById('app-root');

    try {
        const response = await fetch(`/views/${viewName}.html`);
        if (!response.ok) throw new Error('View not found');
        appRoot.innerHTML = await response.text();

        if (viewName === 'home') {
            loadComponent('zone-memberA', 'mood_memberA');
            loadComponent('zone-memberB', 'platform_top10_memberB');
            loadComponent('zone-memberC', 'hidden_gems_memberC');
        }
        if (viewName === 'search') {
            loadComponent('zone-search', 'search_jongwon');
        }
        if (viewName === 'ai') {
            loadComponent('zone-ai', 'ai_seungwoo');
        }
    } catch (error) {
        appRoot.innerHTML = '<div style="padding: 100px 4%; text-align:center;"><h2>페이지 준비 중입니다.</h2></div>';
    }
}

window.addEventListener('hashchange', loadView);
window.addEventListener('DOMContentLoaded', loadView);