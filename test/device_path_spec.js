
const { expect } = require('chai');
const { devicePath } = require('../src/device_path.js');

describe('devicePath', function() {
    it('should resolve to a device with no args', function() {
        expect(devicePath('abc'), '/devices/abc');
    });

    it('should resolve to a device with a argument', function() {
        expect(devicePath('abc', 'net'), '/devices/abc/net');
    });

    it('should resolve to a device with multiple arguments', function() {
        expect(devicePath('abc', 'net', 'poll'), '/devices/abc/net/poll');
    });

    it('should resolve to a device with a device and single argument', function() {
        expect(devicePath('abc', '/devices/abc/net'), '/devices/abc/net');
    });

    it('should resolve to a device with a device and multiple arguments', function() {
        expect(devicePath('abc', '/devices/abc', 'net'), '/devices/abc/net');
    });

    it('should resolve to a device with a device/path and multiple arguments', function() {
        expect(devicePath('abc', '/devices/abc/poll', 'net'), '/devices/abc/poll/net');
    });

    it('should remove a single extra slash from the beginning of args', function() {
        expect(
            devicePath('abc', 'blah', '/frank/', '/test','blah/', '//john', 'net'), 
            '/devices/abc/blah/frank/test/blah//join/net'
        );
    });

    it('should swap devices', function() {
        expect(
            devicePath('abc', '/devices/def/bork/', 'what'),
            '/devices/abc/bork/what'
        );
    })
})