// scripts/page-loader.js

// Eagerly import all page scripts – forces Vite to bundle them all
const pageModules = import.meta.glob('./pages/*.js', { eager: true });

export async function loadPage(pageName) {
    const url = `/pages/${pageName}.html`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Page not found: ${url} (HTTP ${response.status})`);
    }
    const html = await response.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const section = doc.querySelector('section[data-page]');
    if (!section) {
        throw new Error(`Invalid page: missing <section data-page> in ${url}`);
    }

    const metadata = {
        page: section.dataset.page || pageName,
        script: section.dataset.script || `/scripts/pages/${pageName}.js`,
        style: section.dataset.style || `/css/${pageName}.css`,
        title: section.dataset.title || pageName,
        auth: section.dataset.auth || 'none',
        cache: section.dataset.cache === 'true',
        transition: section.dataset.transition || null,
        preload: section.dataset.preload === 'true',
        rootElement: section,
        html: section.outerHTML,
    };

    if (!metadata.script) {
        throw new Error(`Page "${pageName}" has no data-script attribute.`);
    }

    // Look up the eagerly imported module
    const relativePath = `./pages/${pageName}.js`;
    const module = pageModules[relativePath];

    if (!module) {
        throw new Error(`Page script not found for: ${pageName}`);
    }

    return { ...metadata, module };
}