
const mock = require('mock-require');

const Sinon = require('sinon');
const Hub = require('../src/hub.js');

mock('./entity_definitions.js', {});

const data = {
    devices: {
        '123': {
            profile: {
                name: 'test entry',
                serial: '123',
            }
        }
    }
};

describe('hub', function() {
    it('should allow subscribing to changes', function() {
        let hub = new Hub({store: data});

        let callbackSpy = Sinon.fake();
        
        hub.subscribe('/devices/123/profile/name', callbackSpy);

        hub.setConfig('123', 'profile/test_entry', 'test_value');
        callbackSpy.should.have.been.calledOnce();
        callbackSpy.should.have.been.calledWith({newValue: 'test_value'});
    });
});