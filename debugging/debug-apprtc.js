process.on('uncaughtException', (err) => console.log(err));
const path = require('path');
const {EventEmitter} = require('events');
const os = require('os');

require('../lib/tuntap');

class TuntapMockup extends EventEmitter {
    constructor() {
        super();
    }

    write(data) {
        //
    }

    close() {

    }
};

require.cache[path.resolve('./lib/tuntap.js')].exports = TuntapMockup;

os.networkInterfaces = () => {
    return {
        tun: [{
            ip: '10.16.0.0',
            mac: '00:11:22:33:44:55'
        }]
    };
};

const {expect} = require('chai');
const {sleep} = require('../lib/timers');
const AppRtc = require('../lib/apprtc');
const getUUID = require('../lib/fake-uuid');
const WebSocket = require('ws');

class AppRtcDebug extends AppRtc {
    constructor(options) {
        super(options);

        this.debugName = options.name;

        this.on('ws-message', msg => console.log(this.debugName, 'got socket message: ', msg));
    }

    async setupRTC() {
        await super.setupRTC();
        ['connected', 'disconnected', 'failed', 'closed'].forEach(eventName => {
            this.rtcConnection.on(eventName, () => console.log(`${this.debugName} connection state: ${eventName}`));
        });
    }
}

global.debugAppRtc = async () => {
    const roomId = Array.apply(null, {length: 30}).map(() => parseInt(Math.random()*10)).join('');
    const passphrase = Array.apply(null, {length: 30}).map(() => parseInt(Math.random()*10)).join('');

    console.log(roomId, passphrase);
    var clients = global.clients = [];
    var clientA = new AppRtcDebug({
        name: 'A',
        roomId,
        passphrase,
        uuid:getUUID(),
        iceTimeout: 4000
    });
    var clientB = new AppRtcDebug({
        name: 'B',
        roomId,
        passphrase,
        uuid:getUUID(),
        iceTimeout: 4000
    });
    var clientC = new AppRtcDebug({
        name: 'C',
        roomId,
        passphrase,
        uuid:getUUID(),
        iceTimeout: 4000
    });

    var clientAConnectPromise = clientA.connect();

    await new Promise(resolve => clientA.once('sent-rtc-data', resolve));

    clients.splice(0, 0, clientA, clientB, clientC);

    await Promise.all([clientAConnectPromise, clientB.connect()]);

    console.log('connected A+B')

    await sleep(5000);

    await clientC.connect();

    console.log('connected C');

    global.active = true;

    console.log('ping cycle');
    while (global.active) {
        clients.forEach(client => client.ping());
        await sleep(10000);
    }

};