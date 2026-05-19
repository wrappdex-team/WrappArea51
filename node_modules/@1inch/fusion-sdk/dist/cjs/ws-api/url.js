"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "castUrl", {
    enumerable: true,
    get: function() {
        return castUrl;
    }
});
function castUrl(url) {
    if (url.startsWith('http')) {
        return url.replace('http', 'ws');
    }
    return url;
}
