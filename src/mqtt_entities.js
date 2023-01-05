

const crypto = require('crypto');
const { isString } = require("./is-string");
const strict = require("assert/strict");
const { ValueWatcher, MapWatcher } = require('./watchers.js');

const log = require('debug')('thermocouple:entities');

function generateId(...args) {
    return crypto
    .createHash('sha1')
    .update(args.join('/'))
    .digest('base64url');
}

async function defaultValueGetter({getter, source, path, value}) {
    log('retrieving value %s(%s) from %s[%s]', getter?.name ?? '', typeof ev, source.constructor.name, path);
    if (getter) return await getter({source, path, value});

    if (value != undefined) {
        value = value?.value ?? value?.newValue ?? value;
    }

    value = source[path] ?? source.get?.call(source, path) ?? source.value ?? source;

    return await value;
}

async function defaultHandlerAction({source, path, entity, stateTopic, transform, getter, ev}) {
    value = await defaultValueGetter({getter, source, path, value: ev});

    transform = transform ?? entity.stateTransform;

    if (transform) {
        try {
            value = transform.call(source, value, ev, entity);
        }
        catch(error) {
            log('Transform of value: (%s) for topic: (%s) on %s failed with error: \n%O', value, stateTopic, entity.name, error);
            return;
        }
    }

    
    if (value === undefined) {
        log('New value for topic: (%s) on %s is undefined, publish aborted', stateTopic, entity.name);
        return;
    }
    
    log('defaultHandlerAction: Publishing (%s) to %s for %s', value, stateTopic, entity.name);
    
    try {
        await entity.publish(stateTopic, value);
    }
    catch(error) {
        log('Publishing of value: (%s) for topic: (%s) on %s failed with error: %o', value, stateTopic, entity.name, error);
        throw error;
    }
}

function eventEmitterHandler({source, path, entity, getter, transform, stateTopic}) {
    log('configuring event emitter for %s on %s ', stateTopic, entity.name);
    let node = (source.subscribe ?? source.on);
    if (!node) {
        throw Error(`Source (${source?.constructor?.name}) does not have a listenable method for subscription on topic: ${stateTopic}.`)
    }

    let handler = (ev) => defaultHandlerAction({
        entity, transform, 
        stateTopic, ev,
        source, path, 
        getter,
    });

    node.call(source, path ?? 'change', handler);
    return handler;  
}

let namedHandlers = {
    eventEmitter: eventEmitterHandler,
}

function makeHandler(value, args) {
    log('creating handler for topic (%s) for %s', args.stateTopic, args.entity?.name);
    if (value instanceof Function) {
        return value(args);
    }

    if (isString(value) || value instanceof RegExp) {
        value = {
            transform: value.transform,
            ...args,
            type: 'eventEmitter',
            source: args.entity.store,
            path: args.entity.makeDeviceStorePath(value),
        };
    }

    else if (value.subscribe ?? value.on) {
        value = {
            transform: value.transform,
            ...args,
            type: 'eventEmitter',
            source: value,
            path: 'change',
        };
    }

    else if (value instanceof Object) {
        // if (value.path && args.entity) {
        //     value.path = args.entity.makeDeviceStorePath(value.path);
        // }

        value = {
            ...args,
            ...value,
            source: args.entity.store,
            path: args.entity.makeDeviceStorePath(value.path),
            type: 'eventEmitter',
        }
    }

    let handler = namedHandlers[value?.type];

    if (handler) {
        return handler(value);
    }

    throw Error(`unsupported handler: ${value} for topic (${args.stateTopic}}) on entity: ${args.entity}`);

}

function fixPushArgs(key, info) {
    if (!info && typeof key === 'object') {
        info = key;
    } else {
        info = Object.fromEntries([[key, info]]);
    }

    return info;
}

class Entity {
    get id() {
        this.ensureConfigured();

        if (!this._id) {
            this._id = generateId(
                this.deviceId,
                this.domain,
                this.name,
            );
        }

        return this._id;
    }

    set id(value) {
        this._id = value;
    }

    get discoveryTopic() {
        this.ensureConfigured();

        return [
            this.baseDiscoveryTopic,
            this.domain,
            this.id,
            'config'
        ].join('/');
    }

    get discoveryInfo() {
        this.ensureConfigured();

        return this._discoveryInfo; 
    }

    get topicHandlers() {
        return this._topicHandlers;
    }
    get configured() { return this._configured ?? false; }

    get available() { return this._available.value; }
    set available(value) { 
        this._available.value = value; 
    }

    constructor({
        domain, 
        name,
        store,
        client,
        baseTopic = 'thermocouple',
        baseDiscoveryTopic = 'homeassistant',
        extraConfigure,
        discoveryInfo,
        topics,
        commands,
        stateTransform,
    } = {}) {
        strict(domain?.length > 0, 'Domain is required for entity.');
        strict(name?.length > 0, 'Name is required for entity.');
        strict(typeof client?.connected === 'boolean');
        strict(typeof client?.publish === 'function');
        strict(typeof store?.subscribe === 'function');


        this.name = name;
        this.domain = domain;
        this.store = store;
        this.client = client;
        this.baseTopic = baseTopic;
        this.baseDiscoveryTopic = baseDiscoveryTopic;
        this.stateTransform = stateTransform;
        this._extraConfigure = extraConfigure;

        this._discoveryInfo = {};
        this._topicHandlers = {};
        this._commandHandlers = {};

        this._extraDiscoveryInfo = discoveryInfo;
        this._extraTopics = topics;
        this._extraCommands = commands;

        this.attributes = new MapWatcher({});
        this._available = new ValueWatcher(true, {
            transform: (value) => value? 'online': 'offline'
        });
    }

    ensureConfigured() {
        strict(this.deviceId, 'Device not configured!');
    }

    async getEntityConfiguration() {
        throw Error(`getDeviceConfiguration not impelemented on ${this.constructor.name}!`);
    }

    async getDeviceInfo(device) {
        log('generating devince info for device: %s', this.deviceId);

        if (!device) {
            device = await this.store.get(this.makeDeviceStorePath());
        }
        
        return {
            name: `${device.profile.brand} Climate Control`,
            model: device.profile.model,
            identifiers: device.profile.serial,
            sw_version: device.profile.firmware,
            connections: [["mac", device.profile.routerMac]],
        };
    }

    async configureDevice(id, device) {
        strict(id, 'Device id is required!');

        this.deviceId = id;

        log('configuring device: %s', id);

        this.pushDiscoveryInfo({
            device: await this.getDeviceInfo(device),
            name: this.name,
            unique_id: this.id,
            ...this._extraDiscoveryInfo,
        });

        this.pushTopics({
            availability: this._available,
            json_attributes: this.attributes,
            ...this._extraTopics,
        });

        if (this._extraCommands) {
            this.pushCommands(this._extraCommands);
        }

        this._extraConfigure?.call(this, id, device);
        this.onConfiguring?.call(this, device);

        this._configured = true;

        await this.forceUpdateWhenConnected();
    }

    pushDiscoveryInfo(key, info) {
        info = fixPushArgs(key, info);

        this._discoveryInfo = {
            ...this.discoveryInfo,
            ...info
        };

        if (this.configured)
            this.publishDiscoveryInfo();
    }

    pushTopic(key, handler) {
        if (this.topicHandlers[key]) {
            log('duplicate topic handler provided for %s, previously configured handler will be lost');
        }

        let args = {
            discoveryKey: `${key}_topic`,
            stateTopic: this.makeDeviceTopic(key, 'state'),
            entity: this,
        };
        
        this.pushDiscoveryInfo(args.discoveryKey, args.stateTopic);

        handler = makeHandler(handler, args);
        this.topicHandlers[key] = handler;


        if (this.configured) {
            handler();
        }

        return handler;
    }

    pushCommand(key, command) {
        strict(key, 'key is required');
        strict(command, 'command is required');

        if (this._commandHandlers[key]) {
            log('duplicate command handler provided for %s, previously configured handler will be lost');
        }

        let args = {
            commandTopic: this.makeDeviceTopic(key, 'command'),
            entity: this,
        }

        this.pushDiscoveryInfo(`${key}_topic`, args.commandTopic);
        this.client.subscribe(args.commandTopic);
        this.client.on('message', (topic, payload, packet) => {
            command.call(this, payload.toString(), topic)
            console.log(topic, payload.toString(), packet);
        })

    }

    pushTopics(handlerMap) {
        return Object.fromEntries(
            Object.entries(handlerMap).map(([key, handler]) => { 
                return [key, this.pushTopic(key, handler)];
            })
        );
    }

    pushCommands(handlerMap) {
        return Object.fromEntries(
            Object.entries(handlerMap).map(([key, handler]) => { 
                return [key, this.pushCommand(key, handler)];
            })
        );
    }

    async forceUpdate() {
        await this.publishDiscoveryInfo();
        await this.publishAllTopics();
    }

    async forceUpdateWhenConnected() {
        if (this.client.connected) {
            return this.forceUpdate();
        }

        this.client.once('connect', () => {
            return this.forceUpdate();
        })
    }

    publishDiscoveryInfo() {
        return this.publish(this.discoveryTopic, this.discoveryInfo);
    }

    publishAllTopics() {
        return Promise.all(Object.values(this.topicHandlers).map(async (handler) => {
            return await handler();
        }));
    }

    publish(topic, data) {
        if (!this.client.connected) {
            log('MQTT client disconnected, aborting publish for %s.', topic);
            return;
        }

        if (typeof data === 'object') {
            data = JSON.stringify(data);
        } else {
            data = data.toString();
        }

        return new Promise((res, rej) => {
            this.client.publish(topic, data, error => {
                let result = {
                    topic,
                    data,
                    error,
                }

                if (error) {
                    log('Failed publishing topic (%s)\nError: %O', topic, error);
                    rej(result)
                } else {
                    log('Published %s on topic (%s) %o', this.name, topic, data);
                    res(result);
                }


                if (error) return rej(result);
                return res(result);

            });
        });
    }

    makeDeviceTopic(...args) {
        return [
            this.baseTopic,
            this.deviceId,
            this.id,
            ...args 
        ].join('/');
    }

    makeDeviceStorePath(path = '') {
        if (path instanceof RegExp) {
            let source = path.source;
            console.log('!!!! ----- ' + source);
            if (!source.startsWith('\/devices')) {
                console.log('!!!! ----- ' + source);
                return RegExp(`\/devices\/${this.deviceId}\/${source}`);
            }

            return path;
        }

        if (path.startsWith('/devices')) return path;
        return `/devices/${this.deviceId}/${path}`;
    }
}

class Sensor extends Entity {
    constructor(config) {
        super({
            domain: 'sensor',
            ...config,
            topics: {
                state: config.stateTopic,
                ...config.topics, 
            }
        });
        strict(config.stateTopic, 'stateTopic is required');

        this.stateTopic = config.stateTopic;
    }
}

class CommandableSensor extends Sensor {
    constructor(config) {
        super({
            domain: 'switch',
            ...config,
            commands: {
                command: config.commandTopic,
                ...config.commands
            }
        });
        strict(config.commandTopic, 'commandTopic is required');

        this.commandTopic = config.commandTopic;
    }
}

class Climate extends Entity {
    constructor(config) {
        super({
            domain: 'climate',
            ...config,
        })
    }

    onConfiguring(device) {
        this.pushDiscoveryInfo({
            max_temp: device.dealer_config.maxhtsp,
            min_temp: device.dealer_config.minclsp,
            temperature_unit: device.dealer_config.cfgem,
            modes: ['auto', 'off', 'cool', 'heat', 'fan_only'],
            name: `${device.profile.model} Climate Control`,
        });

        this.pushTopics({
            action_topic: {
                getter: () => this.getAction(),
                path: /device-status\/zones\/zone\[0\]\/(heaticon|coolicon|fanicon)/
                // path: RegExp('device-status/zones/zone\\[0\\]/(heaticon|coolicon|fanicon)'),
                // path: /device-status\/zones\/zone\[0\]\/(heaticon|coolicon|fanicon)/,
            },
            current_temperature: `device-status/zones/zone[0]/rt`,
            fan_mode_state: `device-status/fan`,
            mode_state: `device-status/mode`,
            temperature_high_state: `device-status/zones/zone[0]/htsp`,
            temperature_low_state: `device-status/zones/zone[0]/clsp`,
            // temperature_state: {
            //     getter: () => this.getSetpoint(),
            //     path: /\/device-status\/(mode|zones\/zone\[0\]\/(htsp|clsp))/,
            // },
        });

        this.pushCommands({
            fan_mode_command: `system/config/fan`,
            mode_command: `system/config/mode`,
            temperature_high_command: `system/config/zones/zone[0]/htsp`,
            temperature_low_command: `system/config/zones/zone[0]/clsp`,
            // temperature: {
            //     getter: () => this.getSetpoint(),
            //     path: /\/device-status\/(mode|zones\/zone\[0\]\/(htsp|clsp))/,
            // },            
        });
    }

    async getAction() {

        let state = await this.store.get(this.makeDeviceStorePath('device-status'));
        let {heaticon, coolicon, fanicon} = state.zones.zone[0];
        
        console.log(state, heaticon, coolicon, fanicon);
        return isOn(heaticon)? 'heating'
        : isOn(coolicon)? 'cooling'
        : isOn(fanicon)? 'fan'
        : state.mode === 'off'? 'off'
        : 'idle';
    }

    async getSetpoint() {
        let state = await this.store.get(this.makeDeviceStorePath('device-status'));
        let {htsp, clsp} = state.zones.zone[0];

        switch(state.mode) {
            case 'heat': return htsp;
            case 'cool': return clsp;
            default: return clsp;
        }
    }
}

function isOn(value) { 
    return value === true 
    || value.toString().trim().toLowerCase() === 'on'; 
}

module.exports = {
    Entity,
    Sensor,
    CommandableSensor,
    Climate,
    generateId, 
    isOn,
}