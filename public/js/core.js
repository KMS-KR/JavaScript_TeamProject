export async function loadComponent(containerId, componentFolder) {
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        const htmlResponse = await fetch(`/components/${componentFolder}/index.html`);
        if (!htmlResponse.ok) return; 
        container.innerHTML = await htmlResponse.text();

        const cssId = `css-${componentFolder}`;
        if (!document.getElementById(cssId)) {
            const link = document.createElement('link');
            link.id = cssId;
            link.rel = 'stylesheet';
            link.href = `/components/${componentFolder}/style.css`;
            document.head.appendChild(link);
        }

        const oldScript = document.getElementById(`js-${componentFolder}`);
        if (oldScript) oldScript.remove();
        
        const script = document.createElement('script');
        script.id = `js-${componentFolder}`;
        script.type = 'module';
        script.src = `/components/${componentFolder}/script.js?v=${new Date().getTime()}`;
        document.body.appendChild(script);
    } catch (error) {
        console.error(`${componentFolder} 로드 실패:`, error);
    }
}