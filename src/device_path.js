
const { strict } = require('node:assert/strict');

function devicePath(deviceId, ...args) {
    strict(deviceId, 'deviceId not specified.');
    if (args.length === 0) return `/devices/${deviceId}`;
    
    let basePath = `/devices/${deviceId}`;
    if (args[0].startsWith('/devices/')) {
        args[0].replace(/^\/devices\/.*?\/?/, basePath);
        basePath = '';
    }

    return `${basePath}/${args.map(arg => arg.replace(/^\/?(.*?)\/?/, '$1')).join('/')}`
}

module.exports = {
    devicePath
}