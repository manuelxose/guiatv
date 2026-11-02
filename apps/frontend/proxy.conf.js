const backendTarget = process.env.GUIATV_PROXY_TARGET || 'http://localhost:4000';

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
