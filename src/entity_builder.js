const { Sensor, Climate, CommandableSensor, isOn } = require("./mqtt_entities")
const log = require('debug')('thermocouple:entityBuilder');

module.exports = async function ({store, client, deviceServer}) {
    log('initializing entity builder');
    const entities = [];

    const rDeviceStateChangePath = 
        RegExp(`${deviceServer.devicesStorePath}/(.*?)/${deviceServer.deviceStateDomain}`);

    store.subscribe(rDeviceStateChangePath, async (change) => {
        if (change.type === 'missing') {
            let deviceId = change.match[1];
            let device = await store.get(`/devices/${deviceId}`);

            log(`registering new device ${deviceId}`);
            entities.push(...initEntities(deviceId, device));
        }
    });

    // store.subscribe(/^\/devices\/(.*?)\/(device-status\/.*)$/, async (change) => {
    //     let path = change.match[0];
    //     let deviceId = change.match[1];
    //     let statePath = change.match[2];


    // });


    function createDevice(deviceId, data) {

    }

    const availabilityTimeout = 60 * 1000;

    const availabilityTimers = {};
    function resetAvailabilityTimer(deviceId) {
        return;
        log(`resetting availability timer for  ${deviceId}`);

        clearTimeout(availabilityTimers[deviceId]);
        
        availabilityTimers[deviceId] = setTimeout(() => {
            log(`${deviceId} has not communicated in ${availabilityTimeout / 1000} seconds, setting offline.`);
            entities.filter(entity => entity.deviceId === deviceId)
            .forEach(entity => entity.available = false);
        }, availabilityTimeout)
    }

    async function initEntities(deviceId, device) {
        let entities = createEntities(deviceId, device);

        resetAvailabilityTimer(deviceId);

        deviceServer.on('message', ev => {
            entities.forEach((entity) => {
                if (!entity.available) {
                    log(`${deviceId} came back online, setting online`);
                }
                entity.available = true;
                resetAvailabilityTimer(deviceId);
            })
        }) 

        entities.forEach(entity => {
            entity.configureDevice(deviceId, device);
            log('configured entity %s for %s', entity.name, deviceId);
        });

        return entities;
    }

    function createEntities(deviceId, device) {
        return [
            new Sensor({
                client, store,
                name: 'Outside Air Temperature',
                stateTopic: `${deviceServer.deviceStateDomain}/oat`,
                deviceInfo: {
                    device_class: "temperature",
                    unit_of_measure: "°F",
                },
            }),
            new Sensor({
                client, store,
                name: 'Relative Humidity',
                stateTopic: `${deviceServer.deviceStateDomain}/rh`, 
                deviceInfo: {
                    device_class: "humidity",
                    unit_of_measure: "%",
                },
            }),
            new CommandableSensor({
                client, store,
                domain: 'number',
                name: 'Hold Seconds',
                stateTopic: 'thermocouple/holdTime',
                discoveryInfo: {
                    min: 1,
                    max: 12,
                    step: .25,
                    unit_of_measurement: 'hours',
                },
                transform: (value) => value ?? 0,
                commandTopic: async function(value) {
                    await store.postNow(
                        this.makeDeviceStorePath(this.stateTopic), 
                        parseFloat(value)
                    );
                }
            }),
            new CommandableSensor({
                client, store,
                name: 'Hold',
                stateTopic: `${deviceServer.deviceStateDomain}/zones/zone[0]/hold`,
                // transform: (value) => value ?? 0,
                commandTopic: async function(value) {
                    let otmr = 'na';

                    if (isOn(value)) {
                        const holdTime = (await store.get('thermocouple/holdTime') ?? 120);
                        const holdTill = new Date();
                        holdTill.getHours(holdTill.getHours() + holdTime);
                        otmr = `${holdTill.getHours()}:${holdTill.getMinutes()}`;
                    }

                    this.attributes.set('hold_until', otmr);

                    await store.postNow(
                        this.makeDeviceStorePath(`${deviceServer.systemConfigDomain}/config/zones/zone[0]/otmr`),
                        otmr,
                    );
                    await store.postNow(
                        this.makeDeviceStorePath(`${deviceServer.systemConfigDomain}/config/zones/zone[0]/hold`), 
                        value.toLowerCase(),
                    );
                }
            }),
            // new CommandableSensor({
            //     client, store,
            //     name: 'Hold',
            //     stateTopic: `${deviceServer.deviceStateDomain}/zones/zone[0]/hold`,
            //     commandTopic: (value) => setConfig()
            // }),
            // new Climate({
            //     client, store,
            //     name: 'Climate Control',
            // })
        ];
    }

    function setHoldTemperature(value) {

    }

    async function setConfigHasChanges() {
        await store.set('config-status/timestamp', getTimestamp());
        await store.set('config-status')
    }

    function getTimestamp(date) {
        return (date ?? new Date()).toISOString();
    } 

    function devicePath(deviceId, ...args) {
        strict
        if (!args.length < 1) {
            return '/devices/' + deviceId;
        }

        if (args[0] && args[0].startsWith('/devices')) {
            let targetPath = `/devices/${deviceId}`;
            if (!args[0].startsWith(targetPath)) {
                throw new Error(`${args.join('/')} cannot be used for ${deviceId}`)
            } else {
                
            }
        }

        if (path.startsWith('/devices')) return path;
        if (path.startsWith('/')) path = path.slice(1);
        return `/devices/${deviceId}/${args.join('')}`
    }

    const devices = await store.get('/devices');

    await Promise.all(Object.entries(devices).map(async ([id, device]) => {
        log(`Registering known device ${id}`);
        entities.push(...await initEntities(id, device));
    }));

    return entities;
}