
const express = require('express');
const fs = require('fs');
const bodyParser = require('body-parser');
const http = require('http');
const morgan = require('morgan');
const { Parser, Builder } = require('xml2js');
const log = require('debug')('carrier:hub');
const WebSocket = require('ws');

const app = express()
const server = http.Server(app);
const wss = new WebSocket.Server({ server });

const Store = require('./store');
const { version } = require('os');
const Translator = require('./translator');
const { kMaxLength } = require('buffer');
const { fail } = require('assert');
const { isObject } = require('util');



const store = new Store();

const ALLOWED_CONFIG_KEYS = [
    'status',
    'system',
    'profile',
    'dealer_config',
    'system_profile',
    'equipment_events',
    'dealer',
    'idu_config',
    'odu_config',
    'odu_faults',
    'idu_faults',
    'idu_status',
    'odu_status',
];

const CONFIG_STATUS_CHANGE_MAP = {
    system: 'configHasChanges',
    dealer_config: 'dealerConfigHasChanges',
    dealer: 'dealerHasChanges',
    odu_config: 'oduConfigHasChanges',
    idu_config: 'iduConfigHasChanges',
};
// utilityEventsHasChanges

const translate = new Translator();

(async function() {
    try {
        store.load('store.db');

        await store.postNow(true, '/hub', {
            version: "1.0.0",
            status: {
                version: "1.9",
                timestamp: new Date(0).toISOString(),
                pingRate: 2,
                dealerConfigPingRate: 0,
                weatherPingRate: 20, //14400,
                equipEventsPingRate: 20, //86400,
                historyEventsPingRate: 20, //86400,
                iduEventsPingRate: 20, //86400,
                oduEventsPingRate: 20, //86400,
                configHasChanges: "off",
                dealerConfigHasChanges: "off",
                dealerHasChanges: "off",
                oduConfigHasChanges: "off",
                iduConfigHasChanges: "off",
                utilityEventsHasChanges: "off",
            }
        });
    }
    catch(err) {
        log(err);
        process.exit(-1);
    }
})();

async function post(path, data) {
    let changes = await store.postNow(true, path, data);
    await store.postNow('/hub/status/timestamp', new Date().toISOString())

    if (changes.length) {
        log('Updated path: %s with changes: %o', path, changes);
    }
    
    return changes;
}

function sendAsXml(res, data) {
    let xml = new Builder().buildObject(data);
    res.set('Content-Type', 'application/xml').send(xml);
}

function parseXml(xml) {
    if(!xml) return Promise.resolve();
    return new Parser().parseStringPromise(xml);
}

function asyncHandler(fn) {
    return function(...args) {
        let next = args[args.length - 1];
        return Promise.resolve(fn(...args)).catch(next);
    }
}

async function isAllowed(sn) {
    return (await store.get(`hub/known_devices/${sn}`) )?? false;
}

async function updateDevice(sn, config, data) {
    if (ALLOWED_CONFIG_KEYS.indexOf(config) === -1) {
        throw new Error(`Config entry [${config}] is not supported.`);
    }
        
    let changes = await post(`/devices/${sn}`, data);

    if (changes.length) {
        broadcast({
            type: 'event',
            deviceId: sn,
            detail: config,
            data: changes,
        });
    }
        

    return changes;
}

async function setStatus(sn, path, value) {
   return await post(`/devices/${sn}/status/${path}`, value);
}

async function updateStatus(sn, data) {
    let changes = await updateDevice(sn, 'status', data);

    console.log(changes);

    if (changes[0] && changes[0].type == 'missing' && changes[0].path === `/devices/${sn}/status`) {
        broadcast({
            type: 'event',
            deviceId: sn,
            detail: 'ready',
        })
    }

    return changes;
}

async function registerDevice(sn, ignored) {
    await store.postNow('hub/known_devices/' + sn, !ignored);

    broadcast({
        type: 'event',
        deviceId: sn,
        detail: 'registered'
    });

    return true;
}

function send(client, data) {
    let json = JSON.stringify(data);
    return new Promise((res, rej) => {
        client.send(json, function sendFinished(err) {
            if (err) rej(err);
            res(msg);
        })
    })
}

async function broadcast(data) {
    let sendPromises = [];
    wss.clients.forEach(client => sendPromises.push(send(client, data)));

    return Promise.all(sendPromises);
}

const subscriptions = {

}

function failResult(result, message) {
    result.status = 'falied';
    result.reason = message;

    return false;
}

const commands = {
    async version(ws, message, result) {
        
    },

    async deviceDetail(ws, message, result) {
        if (!message.deviceId) return failResult(result, 'deviceId is require');
        let path = `/devices/${message.deviceId}${message.detail? '/' + message.detail: ''}`;
        message.result = await store.get(path);

        return true;
    },

    async devices(ws, message, result) {
        let devices = store.get('/devices');

        result.result = Object.keys(devices);
        return true;
    },

    async subscribe(ws, message, result) {
        let clients;
        result.path = message.path;

        if (message.path in subscriptions) {
            clients = subscriptions[message.path];
        } else {
            clients = subscriptions[message.paht] = [];
        }

        clients.push(ws);

        if (!ws.subscriptions) ws.subscriptions = [message.path];
        else ws.subscriptions.push(message.path);

        return true;
    },

    async unsubscribe(ws, message, result) {
        result.path = message.path;
        result.wasSubscribed = false;

        if (!ws.subscriptions) 
            return true;

        let index = ws.subscriptions.indexOf(message.path);
        if (index !== -1) ws.subscriptions.splice(index, 1);

        index = subscriptions[message.path]?.indexOf(ws) ?? -1;
        if (index !== -1) subscriptions[message.path].splice(index, 1);

        result.wasSubscribed = index !== -1;

        return true;
    },

    async unsubscribeAll(ws, message, result) {0
        result.unsubscribedFrom = ws.subscriptions;

        for(let subscription of ws.subscriptions) {
            let index = subscriptions[subscription]?.indexOf(ws) ?? -1;
            if (index !== -1) subscriptions[subscription].splice(index, 1);
        }

        delete ws.subscriptions;
        
        return true;
    }
}

wss.on('connection', function connection(ws) {
    ws.isAlive = true;

    log('client connected %s', ws);
    ws.on('pong', _ => ws.isAlive = true);


    ws.on('message', async function processClientMessage(message) {
        message = JSON.parse(message);
        let result = {
            type: 'result',
            messageId: message.messageId,
            command: message.command,
            message: message,
        };

        if (message.command in commands) {
            log(`Executing ws command (${message.command})`);

            try {
                if (await commands[message.command](ws, message, result)) {
                    if (!result.status) {
                        result.status = 'ok';
                    }
                }
            }
            catch(err) {
                result.status = 'falied';
                result.reason = err.message;
            }
            
        }
        else {
            result.status = 'failed';
            result.reason = 'Command not supported';
        }

        ws.send(JSON.stringify(result));
    });

})

wss.noop = function() {}

wss.pulseInterval = setInterval(function ping() {
    wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping(wss.noop);
    });
}, 10000)

wss.on('close', function close() {
    clearInterval(interval);
})

function postStatus(req, res, next) {
    store.get('hub/status')
    .then(async currentStatus => {
        if (req.body.data) {
            let current = new Date(currentStatus.timestamp);
            let incoming = new Date(req.body.data.timestamp);

            console.log(current);
            console.log(incoming);
            console.log(currentStatus);
            await updateStatus(req.params.sn, req.body.data);
        }

        currentStatus.timestamp = new Date().toISOString();

        sendAsXml(res, currentStatus);

    }, next);
}

function postConfig(req, res, next) {
    if (typeof req == 'string') {
        return (request, res, next) => {
            request.params.configKey = req;
            postConfig(request, res, next);
        }
    }

    let configKey = req.params.configKey;

    if (!req.body.data) {
        next(new Error(`Expected ${configKey} xml configuration in POST for ${req.params.sn}.`));
    }

    updateDevice(req.params.sn, configKey, req.body.data)
    .then(_ => res.sendStatus(200), next);
}

app.use(morgan('common'));
app.use(bodyParser.urlencoded({extended: true}));

app.get('/Alive', asyncHandler(async function (req, res, next) {
    let path = `/hub/known_devices/${req.query.sn}`;
    let status = await store.get(path);

    if (status === false) {
        res.sendStatus(401);
        return;

    } else if (status === undefined) {
        log('registering new device %s', req.query.sn);
        await registerDevice(req.query.sn);
    }
    res.send('alive');
}));
app.get('/time', function(req, res) {
    sendAsXml(res, {
        time: {
            version: '1.9',
            utc: new Date().toISOString()
        }
    });
});

app.use((req, res, next) => {
    let name = `logs/headers_${Date.now()}`;

    fs.writeFile(`${name}_headers.json`, JSON.stringify(req.headers), (err) => {
        if (err) console.log(err);
    });

    fs.writeFile(`${name}_body.xml`, req.body.data, (err) => {
        if (err) console.log(err);
    });

    next();
});

app.use('/systems/:sn', function(req, res, next) {
    isAllowed(req.params.sn).then(allowed => {
        if (!allowed) {
            res.sendStatus(401);
        } else {
            parseXml(req.body.data).then(xml => {
                req.body.data = xml;
                next();
            }, next)
        }
    })
});

app.post('/systems/:sn', postConfig('system'));
app.post('/systems/:sn/status', postStatus);
app.post('/systems/:sn/:configKey', postConfig);

app.set('views', __dirname + '/views');
app.set('view engine', 'pug');
app.get('/system-status', async (req, res) => {
    try {
        let hub = await store.get('hub');
        let devices = await store.get('devices');

        res.render('system-status', {hub, devices});
    }
    catch(e) {
        res.sendStatus(500);
    }
});

app.get('/thermostat/:deviceId/:command?', async (req, res) => {
    let command = req.params.command;
    let id = req.params.deviceId;

    let {success, message} = await executeCommand(command, {
        command,
        deviceId: id,
    });

    let params = {
        command,
        deviceId: id,
        oat: await store.get(`devices/${id}/status/oat[0]`),
        iat: await store.get(`devices/${id}/status/zones[0]/zone[0]/rt[0]`),
        sp: await store.get(`devices/${id}/status/zones[0]/zone[0]/htsp[0]`),
        hold: 'on' === await store.get(`devices/${id}/status/zones[0]/zone[0]/hold[0]`),
        success,
        message
    };

    res.render('thermostat', params)
});

async function executeCommand(command, params) {
    if (command in thermostatCommands) {
        return thermostatCommands[command](params);
    }

    return Promise.resolve({message: 'Command not present.'});
}

let thermostatCommands = {
    toggleHold,
    tempUp: bumpTemp,
    tempDown: bumpTemp,
};

async function toggleHold(params) {
    let hold = store.get(`devices/${params.deviceId}/status/zones[0]/zone[0]/hold[0]`);

    let newHold = hold === "on"? "off": "on";

    let changes = await setStatus(params.deviceId, 'zones[0]/zone[0]/hold[0]', newHold);

    console.log(changes);

    return {success: true};
}

function bumpTemp(params) {
    var increase = params.command === "tempUp";
    
    return Promise.resolve({success: true});
}


// app.all('*', function(req, res, next) {
//     log(
//     next(new Error(`No handler for ${req.method} at ${req.path}`));
// });


module.exports = server;