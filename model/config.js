const SystemModes = ['heat', 'cool'];
const FanModes = ['auto'];
const TimeFormats = ['12', '24'];

function isNumber() {
    return function(v) { return typeof v === 'number'};
}

function inValidator(list) {
    return function(value) {
        return list.includes(value);
    }
}

function boolOnOff() {
    return {
        formatOut(value) { return value?'on': 'off'},
        formatIn(value) { return value === 'on'? true: false},
    }
}

function listBuilder(type) {
    return function(value) {
        return value.map(v => new type(value));
    }
}

const ConfigKeys = {
    'mode': {validator: inValidator(['heat', 'cool'])}, 
    'fan': {validator: inValidator(['auto'])}, 
    'zones': {builder: listBuileder(Zone)}, 
    'timeFormat': {validator: inValidator(['12','24'])}, 
    'dst': boolOnOff(), 
    'volume': {validator: isNumber()},
    'soundType'
} 

class Config {
    constructor(o) {
        this.mode = o.mode;
        this.fan = o.fan;
        this.zones = o.zones.map(z => new Zone(z));
        this.timeFormat = o.timeFormat;
        this.dst = o.dst;
        this.volume = o.volume;
        this.soundType = o.soundType;
        this.scrLockout = o.screenLockout;
        this.scrLockoutCode = o.scrLockoutCode;
        this.humSetpoint = o.humSetpoint;
        this.dehumSetpoint = o.dehumSetpoint;
        this.blight = o.blight;
    }

    toXml
}