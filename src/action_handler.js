const {strict} = require('node:assert/strict');
const { isString } = require('./is-string');

const log = require('debug')('thermocouple:entity-action-handler');

function throwNotImplemented(key, name) {
    return function() { throw Error(`${name} not implemented for ${key}`)};
}

class EntityActionHandler {
    constructor({
        name,
        entity,
    }) {
        strict(entity, 'Entity is a required');
        this.entity = entity;
        this.name = name ?? EntityActionHandler.name;

        this.get = throwNotImplemented(key, 'getter');
        this.set = throwNotImplemented(key, 'setter');
    }

    setupHandler(handler) {
        if (typeof handler === 'function') {
            handler = this._setupFunctionHandler(handler);
        }

        if (isString(value) || value instanceof RegExp) {
            handler = this._setupSubscriberHandler(handler);
        }

        this._handler = handler;
    }

    _setupFunctionHandler(functionHandler) {
        ['init', 'get', 'set']
        this.get = (...args) => {
            functionHandler.call(
                this.entity,
                'get',
                ...args, 
                this
            );
        }
        this.set = (...args) => {}
    }

    _setupSubscriberHandler(handler) {

    }
}