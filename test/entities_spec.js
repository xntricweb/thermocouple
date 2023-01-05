
const {Entity} = require('../src/mqtt_entities.js');

const {EventEmitter} = require('events');
const {expect} = require('chai');
const Sinon = require('sinon');
require('should-sinon');


        
//changing test data below will require updating the unique id.
const uniqueId = "u-8MZdkF-vXubLkkNX038U56OX8";
const deviceName = 'a test entity';
const deviceDomain = 'climate';
function deviceData() {
    return {
        profile: {
            brand: 'My Brand',
            model: 'XYZ0932O',
            serial: '23388',
            firmware: 'v3.4',
            routerMac: '00:00:00:00:00:00',
        }
    };
}

function mockConfig({publishError = undefined} = {}) {

    var client = new EventEmitter();
    client.connected = false;
    client.publish = Sinon.fake((a, b, cb) => {
        setTimeout(cb, 40, publishError);
    });

    var store = {
        subscribe: Sinon.fake(),
    }

    let config = {
        domain: deviceDomain, 
        name: deviceName,
        test_connect() {
            client.connected = true;
            client.emit('connect');
        },
        client,
        topic: 'test',
        store: store,
    };

    return config;
}


function delay(ms) {
    return new Promise((res) => {
        setTimeout(res, ms);
    });
}


describe('Entity', function() {
    it('should initialize', function() {
        let entity = new Entity(mockConfig());
    });

    it('should configure a device', async function() {
        const devData = deviceData();
        const config = mockConfig();
        const entity = new Entity(config);

        await entity.configureDevice(devData.profile.serial, devData);
        
        expect(entity._discoveryInfo)
            .to.have.nested.property("device.identifiers", devData.profile.serial);

        expect(entity.id).to.equal(uniqueId);
        config.client.publish.should.not.be.called();

        config.test_connect();

        await delay(200);

        expect(entity.topicHandlers.availability).to.be.a('function');

        config.client.publish.should.be.calledThrice();
        config.client.publish.should.be.calledWithMatch('/climate/u-8MZdkF-vXubLkkNX038U56OX8/config');
    });

    it('should configure a device with additional config', async function() {
        const devData = deviceData();
        const config = mockConfig();
        
        //changing test data below will require updating the unique id.
        const uniqueId = "u-8MZdkF-vXubLkkNX038U56OX8";

        const extraConfigSpy = Sinon.fake(function() {
            this.pushDiscoveryInfo({
                testEntry: true,
            });

            this.pushTopics({
                test: Sinon.spy(),
            })
        });

        const entity = new Entity({
            ...config,
            extraConfigure: extraConfigSpy 
        });

        extraConfigSpy.should.not.have.been.called();

        await entity.configureDevice(devData.profile.serial, devData);

        extraConfigSpy.should.have.been.calledOnce();
        extraConfigSpy.should.have.been.calledOn(entity);
        extraConfigSpy.should.have.been.calledWith(devData.profile.serial, devData);
        
        expect(entity._discoveryInfo)
            .to.have.nested.property("device.identifiers", devData.profile.serial);

        expect(entity.id).to.equal(uniqueId);
        config.client.publish.should.not.be.called();

        config.test_connect();
        await delay(200);

        config.client.publish.should.be.calledThrice();
        config.client.publish.should.be.calledWithMatch('/climate/u-8MZdkF-vXubLkkNX038U56OX8/config');
    });

    it('should handle availability changes', async function() {    
        const devData = deviceData();
        const config = mockConfig();
        const entity = new Entity(config);

        // hub.mqtt.client.connected = true;
        config.test_connect();

        await entity.configureDevice(devData.profile.serial, devData);

        entity._available.value = true;

        config.client.publish.should.have.callCount(4);
        config.client.publish.should.be.calledWithMatch(
            entity.discoveryTopic, JSON.stringify(entity.discoveryInfo)
        );
        config.client.publish.should.be.calledWithMatch(
            entity.discoveryInfo.availability_topic, 'online'
        );
    });

    it('should handle attribute changes', async function() {    
        const devData = deviceData();
        const config = mockConfig();
        const entity = new Entity(config);

        config.test_connect();

        await entity.configureDevice(devData.profile.serial, devData);

        entity.attributes.set('glowing', true);

        config.client.publish.lastCall.should.be.calledWithMatch(
            entity.discoveryInfo.json_attributes_topic, JSON.stringify({
                glowing: true
            })
        );
    });

    it('should convert string topic handlers into store subscriber handlers', async function() {

        const devData = deviceData();
        const config = mockConfig();
        const entity = new Entity({
            ...config,
            extraConfigure: (id, device) => {
                entity.pushTopic('test', 'a/test/path');
            }
        });
        
        config.test_connect();
        
        await entity.configureDevice(devData.profile.serial, devData);
        Sinon.spy(entity.topicHandlers);

        config.client.publish.should.have.callCount(4);
        config.store.subscribe.should.have.been.calledOnce();
        await config.store.subscribe.lastCall.callback();
        config.client.publish.should.have.callCount(5);
        await entity.topicHandlers.test();
        config.client.publish.should.have.callCount(6);
    })

    it('should convert regex topic handlers into store subscriber handlers', async function() {

        const devData = deviceData();
        const config = mockConfig();
        const entity = new Entity({
            ...config,
            extraConfigure: (id, device) => {
                entity.pushTopic('test', /a\/test\/path/);
            }
        });
        
        config.test_connect();
        
        await entity.configureDevice(devData.profile.serial, devData);
        Sinon.spy(entity.topicHandlers);

        config.client.publish.should.have.callCount(4);
        config.store.subscribe.should.have.been.calledOnce();
        config.store.subscribe.should.have.been.calledWith(RegExp(`/devices/${entity.deviceId}/a/test/path`));

        await config.store.subscribe.lastCall.callback();
        config.client.publish.should.have.callCount(5);
        await entity.topicHandlers.test();
        config.client.publish.should.have.callCount(6);
    })

    it('should allow custom topic handlers', async function() {
        const devData = deviceData();
        const config = mockConfig();
        const entity = new Entity(config);

        config.test_connect();

        await entity.configureDevice(devData.profile.serial, devData);

        let updateSpy = Sinon.fake();

        let updater = entity.pushTopic('test', ({discoveryKey, stateTopic}) => {
            expect(discoveryKey).to.equal('test_topic');
            return updateSpy;
        });

        updateSpy.should.be.calledOnce();

        updater();
        updateSpy.should.be.calledTwice();
    });
})