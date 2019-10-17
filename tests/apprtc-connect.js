require('wtfnode');
const path = require('path');
const {EventEmitter} = require('events');
const os = require('os');
// Mockup TunTap //
require('../lib/tuntap');

class TuntapMockup extends EventEmitter {
    constructor(params) {
        super();
    }

    write(data) {
        //
    }

    close() {
        //
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
////////////////////
const {expect} = require('chai');
const {sleep} = require('../lib/timers');
const AppRtc = require('../lib/apprtc');
const getUUID = require('../lib/fake-uuid');
const WebSocket = require('ws');

describe('Test AppRTC as control sockets', () => {
    var clients = [];

    it('should get working properties', async () => {
        const roomId = Array.apply(null, {length: 50}).map(() => parseInt(Math.random()*10)).join('');
        const passphrase = Array.apply(null, {length: 30}).map(() => parseInt(Math.random()*10)).join('');

        var client = new AppRtc({roomId, passphrase, uuid:getUUID()});

        var roomData = await client.fetchRoomDetails();

        var wssUrl = roomData.params.wss_url;

        expect(typeof wssUrl).to.equal('string', 'params.wss_url is not defined');
        expect(typeof roomData.params.wss_post_url).to.equal('string', 'params.wss_post_url is not defined');

        var ws = new WebSocket(wssUrl, {
            headers: {
                'User-Agent': 'curl',
                'Origin': 'https://appr.tc'
            }
        });

        await new Promise((resolve, reject) => {
            ws.once('open', resolve);
            ws.once('error', reject);
        });

        ws.close();

    });

    it('should connect 2 clients', async () => {
        const roomId = Array.apply(null, {length: 50}).map(() => parseInt(Math.random()*10)).join('');
        const passphrase = Array.apply(null, {length: 30}).map(() => parseInt(Math.random()*10)).join('');

        var clientA = new AppRtc({
            roomId, 
            passphrase, 
            uuid:getUUID(),
            iceTimeout: 4000
        });
        var clientB = new AppRtc({
            roomId,
            passphrase,
            uuid:getUUID(),
            iceTimeout: 4000
        });

        var clientAConnectPromise = clientA.connect();

        await new Promise(resolve => clientA.once('sent-rtc-data', resolve));

        clients.splice(0, 0, clientA, clientB);

        await Promise.all([clientAConnectPromise, clientB.connect()]);
    });

    it('should disconnect all clients', async () => {
        await Promise.all(clients.map(c => c.destroy()));
    });

    after(() => {
        process._getActiveHandles().forEach(handle => {
            if (handle.unref) {
                handle.unref();
            }
        });
        process._getActiveRequests().forEach(request => {
            if (request.abort) {
                request.abort();
            }
            if (request.destroy) {
                request.destroy();
            }
        });
    })
});

