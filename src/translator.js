const Route = require('route-parser');

function translate(term, inRoutes, outRoutes, def) {
    for(let index = 0; index < inRoutes.length; i++) {
        let params = inRoutes[index].match(term);
        if (params) return outRoutes[index].reverse(params);
    }

    if (def) return def;
    throw new ReferenceError(``)
}

/**
 * Translates paths between a source and destination and vice versa.
 */
class Translator {
    register(map) {
        let inRoutes = this._inRoutes = [];
        let outRoutes = this._outRoutes = [];

        for(key in map) {
            inRoutes.push(new Route(key));
            outRoutes.push(new Route(map[key]));
        }
    }

    forward(term, def) {
        return translate(term, this._inRoutes, this._outRoutes, def);
    }

    reverse(key, def) {
        return translate(term, this._outRoutes, this._inRoutes, def);
    }
}

module.exports = Translator;