const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

const SECRET_KEY_DEFAULT_B64 = "NzZpUmwwN3MweFNOOWpxbUVXQXQ3OUVCSlp1bElRSXNWNjRGWnIyTw==";
const MODERN_USER_AGENT = "com.community.mbox.in/50020130 (Linux; U; Android 14; en_IN; Pixel 8; Build/UD1A.230803.041; Cronet/145.0.7582.0)";
const WEB_USER_AGENT = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36";
const NATIVE_API_BASE = "https://api3.aoneroom.com";
const BOOTSTRAP_URL = "https://apig.inmoviebox.com/wefeed-mobile-bff/tab/ranking-list?tabId=0&categoryType=4516404531735022304&page=1&perPage=1";
const WEB_DOMAINS = [
    "https://123moviesfree.club", "https://movie-box.co", "https://movieboxonline.net",
    "https://sflix.film", "https://h5-api.aoneroom.com", "https://netnaija.film", "https://movieboxhd.net"
];

function b64decode(str) {
    let s = str.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return Buffer.from(s, 'base64');
}

function getSecretBytes() { return b64decode(b64decode(SECRET_KEY_DEFAULT_B64).toString('utf-8')); }
function md5Hex(data) { return crypto.createHash('md5').update(data).digest('hex'); }
function generateDeviceId() { return crypto.randomBytes(16).toString('hex'); }

function generateXClientToken(timestamp) {
    const tsStr = String(timestamp);
    const reversed = tsStr.split('').reverse().join('');
    return `${tsStr},${md5Hex(Buffer.from(reversed))}`;
}

function generateClientInfo(deviceId) {
    const info = {
        package_name: "com.community.mbox.in", version_name: "4.0.03.0920.03", version_code: 50020130,
        os: "android", os_version: "14", device_id: deviceId, install_store: "official",
        gaid: "1b2212c1-dadf-43c3-a0c8-bd6ce48ae22d", brand: "Google", model: "Pixel 8",
        system_language: "en", net: "NETWORK_WIFI", region: "IN", timezone: "Asia/Calcutta", sp_code: ""
    };
    return JSON.stringify(info);
}

function buildCanonicalString(method, accept, contentType, url, body, timestamp) {
    const parsedUrl = new URL(url);
    let path = parsedUrl.pathname || "/";
    if (parsedUrl.search) {
        const params = parsedUrl.search.slice(1).split("&").filter(Boolean).map(p => p.split("="));
        params.sort((a, b) => a[0].localeCompare(b[0]));
        path += "?" + params.map(p => `${p[0]}=${p[1] || ""}`).join("&");
    }
    let bodyLength = "", bodyHash = "";
    if (body) {
        const buf = Buffer.from(body, 'utf-8');
        bodyLength = String(buf.length);
        bodyHash = md5Hex(buf.slice(0, 102400));
    }
    return [method.toUpperCase(), accept || "", contentType || "", bodyLength, String(timestamp), bodyHash, path].join("\n");
}

function generateXTrSignature(method, accept, contentType, url, body, timestamp) {
    const canonical = buildCanonicalString(method, accept, contentType, url, body, timestamp);
    const digest = crypto.createHmac('md5', getSecretBytes()).update(canonical).digest('base64');
    return `${timestamp}|2|${digest}`;
}

function buildAuthHeaders(method, url, body = null, token = null, deviceId = null) {
    const ts = Date.now();
    const devId = deviceId || generateDeviceId();
    const headers = {
        "user-agent": MODERN_USER_AGENT, 
        "accept": "application/json", 
        "content-type": "application/json",
        "x-client-token": generateXClientToken(ts),
        "x-tr-signature": generateXTrSignature(method, "application/json", "application/json", url, body, ts),
        "x-client-info": generateClientInfo(devId), 
        "x-client-status": "0"
    };
    if (token) headers["authorization"] = `Bearer ${token}`;
    return headers;
}

let bearerToken = null;
let sessionDeviceId = generateDeviceId();

async function bootstrapToken() {
    if (bearerToken) return bearerToken;
    try {
        const headers = buildAuthHeaders("GET", BOOTSTRAP_URL, null, null, sessionDeviceId);
        // SPOOF HEADER BUAT VERCEL
        headers["x-forwarded-for"] = "103.150.117.76";
        headers["referer"] = "https://moviebox.ph/";
        headers["origin"] = "https://moviebox.ph";

        const resp = await axios.get(BOOTSTRAP_URL, { headers });
        const xUser = resp.headers['x-user'];
        if (xUser) bearerToken = JSON.parse(xUser).token;
    } catch (e) { console.error("Bootstrap failed:", e.message); }
    return bearerToken;
}

async function apiRequest(method, path, bodyDict = null) {
    await bootstrapToken();
    const fullUrl = path.startsWith('http') ? path : `${NATIVE_API_BASE}${path}`;
    const bodyStr = bodyDict ? JSON.stringify(bodyDict) : null;
    const headers = buildAuthHeaders(method, fullUrl, bodyStr, bearerToken, sessionDeviceId);
    
    // SPOOF HEADER BUAT VERCEL
    headers["x-forwarded-for"] = "103.150.117.76";
    headers["referer"] = "https://moviebox.ph/";
    headers["origin"] = "https://moviebox.ph";

    try {
        let resp;
        if (method.toUpperCase() === "POST") resp = await axios.post(fullUrl, bodyStr, { headers });
        else resp = await axios.get(fullUrl, { headers });
        return resp.data;
    } catch (e) {
        if (e.response && (e.response.status === 401 || e.response.status === 441)) {
            bearerToken = null;
            return apiRequest(method, path, bodyDict);
        }
        throw e;
    }
}

app.get('/search', async (req, res) => {
    try {
        const data = await apiRequest("POST", "/wefeed-mobile-bff/subject-api/search", { keyword: req.query.q, page: 1, perPage: 20 });
        const items = data.data?.items || data.data?.list || [];
        const results = items.map(item => {
            const sub = item.subject || item;
            return { subject_id: String(sub.subjectId), title: sub.title, type: sub.subjectType === 1 ? "Movie" : "Series", cover: sub.cover?.url || null };
        });
        res.json({ results });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stream/:id', async (req, res) => {
    const subjectId = req.params.id;
    const se = parseInt(req.query.se) || 0;
    const ep = parseInt(req.query.ep) || 0;
    const streams = [];

    for (const domain of WEB_DOMAINS) {
        try {
            const playUrl = `${domain}/wefeed-h5api-bff/subject/play?subjectId=${subjectId}&se=${se}&ep=${ep}&detailPath=&streamSignType=1`;
            const headers = { 
                "User-Agent": WEB_USER_AGENT, 
                "Referer": `${domain}/`, 
                "Origin": domain,
                "x-forwarded-for": "103.150.117.76",
                "Authorization": `Bearer ${bearerToken || ""}` 
            };
            const r = await axios.get(playUrl, { headers, timeout: 10000 });
            for (const st of (r.data?.data?.streams || [])) {
                streams.push({ source: `Web CDN`, format: st.format || "MP4", quality: st.resolutions || "HD", url: st.url });
            }
            if (streams.length > 0) break;
        } catch (e) {}
    }

    try {
        const nativeData = await apiRequest("GET", `/wefeed-mobile-bff/subject-api/play-info?subjectId=${subjectId}&se=${se}&ep=${ep}`);
        for (const st of (nativeData.data?.streams || [])) {
            streams.push({ source: "Native CDN", format: st.format || "MP4", quality: st.resolutions || "HD", url: st.url });
        }
    } catch (e) {}

    res.json({ count: streams.length, streams });
});

app.get('/api/stream/:id/captions', async (req, res) => {
    const subjectId = req.params.id;
    const se = parseInt(req.query.se) || 0;
    const ep = parseInt(req.query.ep) || 0;
    const captions = [];
    try {
        const nativeData = await apiRequest("GET", `/wefeed-mobile-bff/subject-api/play-info?subjectId=${subjectId}&se=${se}&ep=${ep}`);
        const streamId = nativeData.data?.streams?.[0]?.id;
        if (streamId) {
            const capData = await apiRequest("GET", `/wefeed-mobile-bff/subject-api/get-stream-captions?subjectId=${subjectId}&streamId=${streamId}`);
            for (const c of (capData.data?.extCaptions || capData.data?.captions || capData.data || [])) {
                captions.push({ language: c.lanName || c.language, url: c.url });
            }
        }
    } catch (e) {}
    res.json({ count: captions.length, captions });
});

module.exports = app;
