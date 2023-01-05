
const {EventEmitter} = require('events');

function makeChangeEventArgs(sender, oldValue, newValue) {
    return {
        sender,
        oldValue,
        newValue
    };
}

class ValueWatcher extends EventEmitter {
    get value() { return this._value; }
    set value(newValue) {
        let oldValue = this._value;

        if (oldValue !== newValue) {
            this._value = newValue;

            this.emit('change', makeChangeEventArgs(this, oldValue, newValue));
        }
    }

    constructor(initialValue, {transform} = {}) {
        super();

        this._value = initialValue;
        this.transform = transform;
    }
}

class MapWatcher extends EventEmitter {

    get value() {
        return {...this._store};
    }

    constructor(initialValue, {transform} = {}) {
        super();
        this._store = {...initialValue};
        this.transform = transform;
    }

    get(key) { return this._store[key]; }
    set(key, newValue) {
        let oldValue = this.get(key);
        if (newValue != oldValue) {
            this._store[key] = newValue;
            
            this.emit('change', {
                ...makeChangeEventArgs(this, oldValue, newValue),
                value: this.value,
            });
        }
    }
}

module.exports = {
    MapWatcher,
    ValueWatcher
}