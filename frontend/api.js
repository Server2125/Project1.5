const API_BASE = 'https://cooperation-map-api.onrender.com';

async function apiGet(path) {
    const res = await fetch(API_BASE + path);
    if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
    return res.json();
}

window.API = {
    getConnection:  () => apiGet('/api/connection'),
    getImport:      () => apiGet('/api/import'),
    getExport:      () => apiGet('/api/export'),
    getProduction:  () => apiGet('/api/production'),
    getProcurement: () => apiGet('/api/procurement'),
    getRegistry:    () => apiGet('/api/registry'),
    getStavka:      () => apiGet('/api/stavka'),
    health:         () => apiGet('/api/health'),
};