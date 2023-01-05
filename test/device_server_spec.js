
const { expect } = require("chai").use(require('sinon-chai'));
const Sinon = require("sinon");

const DeviceServer = require("../src/device-server");
const Store = require("../src/store");

function makeConfig(changes, ) {
    return {
        app: {
            use: Sinon.spy(),
            post: Sinon.spy(),
            get: Sinon.spy(),
        },
        store: {
            postNow: Sinon.spy(() => Promise.resolve()),
            get: Sinon.spy(),
        }
    };
}

describe('DeviceServer', function() {
    it('should initialize', function() {
        let config = makeConfig();

        let deviceServer = new DeviceServer(config);
    });

    it('should create a device', async function() {
        let config = makeConfig();
        let deviceServer = new DeviceServer(config);

        const sn = 'abc', data = {
            value: 'test',
        };
        
        await findCallForPath(config.app.post, '/systems/:sn/status')
        .callback(...makePostArgs({sn, data}));


        expect(config.store.postNow)
        .to.have.been.calledWithMatch(true, 
            makePath(deviceServer, sn, deviceServer.deviceStateDomain), 
            {value: 'test'}
        )
        .and.to.have.been.calledWithMatch(true,
            makePath(deviceServer, sn, deviceServer.configStateDomain),
            {configHasChanges: 'off'}
        );
    });
})

function makePath(deviceServer, sn, path) {
    return `${deviceServer.devicesStorePath}/${sn}/${path}`;
}

function findCallForPath(spy, path) {
    let call = spy.getCalls().find(call => call.args[0] === path);
    expect(call).to.exist;

    return call;
}

function makePostArgs({sn, configKey, data}) {
    const req = { 
        params: {sn, configKey},
        body: { data },
    };
    const res = {
        sendXml: Sinon.spy()
    };
    return [
        req,
        res
    ]
}