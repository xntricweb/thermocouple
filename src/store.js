const { parseStringPromise } = require('xml2js');

const log = require('debug')('store');

const {readFile, writeFile} = require('fs').promises;

/**
 * Converts a string "term" into a object key and array index tuple.
 * 
 * @param {String} term The term to convert into a key/index tuple.
 * @returns {[String, Number?]} The key and array index for the term.
 */
function getKeyIndex(term) {
    log('Getting key for %s', term);
    if (term.endsWith(']')) {
        let parts = term.split('[');

        return [parts[0], parseInt(parts[1])]
    }

    return [term, undefined];
}

/**
 * Obtains the parent of a target in an object for the provided path. 
 * It automatically creates the path if it doesn't exist.
 * 
 * @param {Any} path The path to use for targetting.
 * @argument {Object} base An object to path find on.
 * @returns {Object} parent of target.
 */
function getBase(path, base, pathIncludesTarget=true) {
    log('Getting base for path [%s]', path);
    // no path, result is root.
    if (typeof(path)=='string') path = path.split('/');
    if (Array.isArray(path)) path = path.filter(Boolean);
    else throw new TypeError("Parts must be an array.");

    if (!base) base = {};
    
    let key, index, target, basePath = '/';

    if (path.length == 0) return [base, undefined, basePath];

    // pop off the last part as that is the target.
    if (pathIncludesTarget) {
        [key, index] = getKeyIndex(path.pop());

        if (index !== undefined) {
            path.push(key);
            target = index;
        } else {
            target = key;
        }
        
        if (!path.length) {
            return [base, target, basePath];
        }
    }

    basePath += path.join('/');

    [key, index] = getKeyIndex(path.shift());

    if (key in base) {
        base = base[key];
    } else {
        base = base[key] = (index === undefined? {}: []);
    }

    if (index !== undefined) {
        if (index in base) {
            base = base[index];
        }
        else {
            base = base[index] = {};
        }
    }

    if (path.length) {
        [base] = getBase(path, base, false);
    }

    return [base, target, basePath];
}

function update(ev, key, base, data) {
    ev.oldValue = base[key];
    
    base[key] = data;

    ev.newValue = data;

    return true;
}

function *apply(key, base, data, {
    pathPrefix = '',
    onUpdate = update
} = {}) {
    let seperator = pathPrefix.endsWith('/')? '': '/', event;

    log('applying changes.');
    if (typeof(key) === 'object') {
        data = base;
        base = key;
        key = undefined;
    }

    if (typeof base !== 'object') {
        throw new Error('Cannot apply changes to a non object base.');
    }

    if (typeof(data) !== "object") {
        oldValue = base[key];

        if (key === undefined) {
            throw new Error('Cannot set plain data without key.');
        }

        let event = {
            type: key in base? 'changed': 'missing',
            path: pathPrefix + (Array.isArray(base)? `[${key}]`: seperator + key)
        };

        if(onUpdate(event, key, base, data)) yield event;

        return;
    }

    if (key) {
        pathPrefix += (Array.isArray(base)? `[${key}]`: seperator + key);

        if (key in base) {
            base = base[key];
            if (Array.isArray(data) && !Array.isArray(base)) {
                throw new Error('Cannot convert base object to array without data loss.');
            }
        } else {
            let event = {
                type: 'missing',
                path: pathPrefix,
            };

            if (onUpdate(event, key, base, data)) {
                yield event;
            }
            return;
        }
    }

    
    for(let subKey in data) {

        if (base[subKey] === undefined) {
            event = {
                type: 'missing',
                path: pathPrefix + (Array.isArray(base)? `[${subKey}]`: '/' + subKey),
            };
            
            if (onUpdate(event, subKey, base, data[subKey])) yield event;

            continue;
        }

        if (typeof(base[subKey]) === "object" && typeof(data[subKey]) === "object") {
            for (let change of apply(subKey, base, data[subKey], {
                pathPrefix: pathPrefix,
                onUpdate: onUpdate,
            })) {

                yield change;
            }

            continue;
        }

        if (base[subKey] !== data[subKey]) {
            event = {
                type: 'changed',
                path: pathPrefix + (Array.isArray(base)? `[${subKey}]`: '/' + subKey),
            };

            if (onUpdate(event, subKey, base, data[subKey])) yield event;
            
            continue;
        }
    }

    log('finished');
}

function parseStore(data) {
    log('load success');
    return JSON.parse(data);
}

function recoverStore(err) {
    log('load failed.');
    return {};
}

/**
 * A basic json storage object. 
 */
class Store {
    get getStore() {
        return this._storePromise;
    }

    constructor({store, path} = {}) {
        this.path = path;

        if (store) {
            this._storePromise = Promise.resolve(store);
        } else {
            this._storePromise = Promise.resolve({});
        }
    }

    load(path) {
        this._storePromise = readFile(path)
        .then(parseStore, recoverStore);
        this._path = path;

        return this;
    }
    
    async post(path, data) {
        let store = await this._storePromise;

        let [base, target, basePath] = getBase(path, store);
        
        return apply(target, base, data, {pathPrefix: basePath });
    }

    async postNow(save, path, data) {
        let changes = [];

        if (typeof save === 'string' ) {
            data = path;
            path = save;
            save = false;
        }

        for (let change of await this.post(path, data)) {
            changes.push(change);
        }

        if (save) {
            this.save();
        }

        return changes;
    }

    async get(path) {
        let store = await this._storePromise;
        let [base, target, basePath] = getBase(path, store);

        return base[target];
    }

    async save() {
        if (this._path) {
            await writeFile(this._path, JSON.stringify(await this._storePromise));
        } else {
            throw new Error('Path not set for export.')
        }

        return this;
    }
}

Store._getBase = getBase;
Store._apply = apply;
Store._getKeyIndex = getKeyIndex;

module.exports = Store;