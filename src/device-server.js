// const Hub = require('./hub.js');

const log = require('debug')('thermocouple:deviceServer');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const xmlBodyParser = require('./xml-body-parser.js');

const { strict } = require('node:assert/strict');
const EventEmitter = require('node:events');

const defaultConfigStatus = {
    $: { version: "1.9" },
    timestamp: new Date(0).toISOString(),
    pingRate: 20,
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
};


class DeviceServer extends EventEmitter {
    constructor({
        store,
        app,
        systemConfigDomain = 'system',
        deviceStateDomain = 'device-status',
        configStateDomain = 'config-status',
        devicesStorePath = '/devices',
    }) {
        super();

        //ensure store looks like a store
        strict(typeof store?.postNow === 'function');
        strict(typeof store?.get === 'function');

        //ensure app looks like an app
        strict(typeof app?.use === 'function');
        strict(typeof app?.get === 'function');
        strict(typeof app?.post === 'function');

        strict.ok(store);
        strict.ok(app);

        this.store = store;

        this.systemConfigDomain = systemConfigDomain;
        this.deviceStateDomain = deviceStateDomain;
        this.configStateDomain = configStateDomain;
        this.devicesStorePath = devicesStorePath;

        this._initApp(app);
    }

    sendMessageEvent(deviceId, domain, data) {
        this.emit('message', {
            sender: this,
            deviceId,
            domain,
            data
        });
    }

    _initApp(app) {

        log('initializing application');
        let postConfig = (req, res, next) => {
            let domain = req.params.configKey ?? this.systemConfigDomain;

            this.sendMessageEvent(
                req.params.sn, 
                domain, 
                req.body.data
            );

            return this
            .postData(
                req.params.sn, 
                domain, 
                req.body.data
            )
            .then(_ => res.sendStatus(200), next);
        }

        let postStatus = (req, res, next) => {
            this.sendMessageEvent(
                req.params.sn, 
                this.deviceStateDomain, 
                req.body.data
            );
            return this
            .postData(req.params.sn, this.deviceStateDomain, req.body.data)
            .then(_ => this.getData(req.params.sn, this.configStateDomain), next)
            .then(status => status? status: this.initDevice(req.params.sn), next)
            .then(res.sendXml, next);
        }

        let getAlive = (req, res, next) => {
            return this
            .getData(req.query.sn, this.configStateDomain)
            .then(status => {
                if (status === false) return res.sendStatus(401);
                res.send('alive');
            }, next)
        } 

        let getTime = (_, res) => {
            res.sendXml({
                time: {
                    version: '1.9',
                    utc: new Date().toISOString(),
                }
            });
        }

        app.use(morgan('common'));
        app.use(bodyParser.urlencoded({extended: true}));
        app.use(xmlBodyParser({
            alwaysAttemptParse: true, 
            failOnParseError: true,
            parseOptions: {
                explicitRoot: false,
                explicitArray: false,
                trim: true,
            }
        }));

        app.get('/Alive', getAlive);
        app.get('/time', getTime);

        // app.use('/systems/:sn', async (req, _, next) => {
        //     if (req.body.data) {
        //         req.body.data = await xmlBodyParser.parseXml(req.body.data);
        //     }
        //     next();
        // })

        app.post('/systems/:sn', postConfig);
        app.post('/systems/:sn/status', postStatus);
        app.post('/systems/:sn/:configKey', postConfig);

        app.get('/systems/:sn/config', async (req, res, next) => {
            // let status = this.store.get(`/`)
        })
    }

    async initDevice(sn) {
        await this.postData(sn, this.configStateDomain, {...defaultConfigStatus});
        return await this.getData(sn, this.configStateDomain);
    }

    getData(...args) {
        return this.store.get(
            `${this.devicesStorePath}/${args.join('/')}`
        );
    }

    postData(deviceId, domain, data) {
        if (!data) return Promise.resolve();

        if (!data.timestamp) {
            data.timestamp = this.getTimestamp();
        }

        return this.store.postNow(true, `${this.devicesStorePath}/${deviceId}/${domain}`, data);
    }

    getTimestamp() { return new Date().toISOString(); }
}


module.exports = DeviceServer;