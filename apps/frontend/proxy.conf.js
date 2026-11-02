const localTarget = process.env.GUIATV_PROXY_TARGET || 'http://localhost:8080';
const prodTarget = process.env.GUIATV_PROXY_TARGET_PROD || 'https://guiaprogramaciontv.com';

const { execSync } = require('child_process');
let backendTarget = localTarget;
try {
    execSync(`node -e "fetch('${localTarget}/health',{signal:AbortSignal.timeout(1500)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`, { stdio: 'ignore', timeout: 3000 });
    console.log(`[proxy] Backend local detectado en ${localTarget}`);
} catch {
    backendTarget = prodTarget;
    console.log(`[proxy] Backend local no disponible; usando producción ${prodTarget}`);
}

const PROXY_CONFIG = {
    "/v2": {
        "target": backendTarget,
        "secure": false,
        "changeOrigin": true,
        "logLevel": "debug"
    },
    "/storage": {
        "target": backendTarget,
        "secure": false,
        "changeOrigin": true,
        "logLevel": "debug"
    },
    "/api/tmdb/*": {
        "target": "https://api.themoviedb.org",
        "secure": false,
        "changeOrigin": true,
        "logLevel": "debug",
        "pathRewrite": {
            "^/api/tmdb": ""
        },
        "headers": {
            "Accept": "application/json",
            "Content-Type": "application/json"
        },
        "onError": function(err, req, res) {
            console.log("TMDb API Proxy Error:", err.message);
            res.writeHead(500, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({
                error: 'TMDb API temporarily unavailable',
                message: err.message
            }));
        }
    }
};

module.exports = PROXY_CONFIG;
