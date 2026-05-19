"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    add0x: function() {
        return add0x;
    },
    trim0x: function() {
        return trim0x;
    }
});
function trim0x(data) {
    if (data.startsWith('0x')) {
        return data.substring(2);
    }
    return data;
}
function add0x(data) {
    if (data.includes('0x')) {
        return data;
    }
    return '0x' + data;
}
