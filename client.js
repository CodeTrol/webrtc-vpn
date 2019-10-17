const fs = require('fs');
const net = require('net');
const Router = require('./lib/router');
const Client = require('./lib/client');
const AppRtc = require('./lib/apprtc');
const getUUID = require('./lib/fake-uuid');
const parseArgs = require('./lib/args');
const {RoomFullError} = require('./lib/errors');
const {sleep, waittill} = require('./lib/timers');


const config = parseArgs({
    host: {
        name: 'host',
        shortname: 'h',
        value: null,
        type: String
    },
    port: {
        name: 'port',
        shortname: 'p',
        value: 5555,
        type: Number
    },
    room: {
        name: 'room',
        shortname: 'r',
        value: null,
        type: String
    },
    passphrase: {
        name: 'passphrase',
        shortname: 'rp',
        value: null,
        type: String
    },
    sessionPath: {
        name: 'session-path',
        shortname: 's',
        value: null,
        type: String
    }
});

init();

function init() {
    var uuid;

    if (config.sessionPath) {
        if (!fs.existsSync(config.sessionPath)) {
            fs.mkdirSync(config.sessionPath);
            uuid = getUUID();
            fs.writeFileSync(`${config.sessionPath}/uuid`, uuid);
        } else {
            uuid = fs.readFileSync(`${config.sessionPath}/uuid`).toString();
        }
    }

    if (config.host && config.port) {
        TcpSocketConnect(uuid);
    } else if (config.room && config.passphrase) {
        AppRTCConnect(uuid);
    }
}

async function TcpSocketConnect(uuid) {
    var remoteSocket = net.connect(config.port, config.host);
    var active = true;

    await new Promise((resolve, reject) => {
        remoteSocket.once('connect', resolve);
        remoteSocket.once('error', reject);
    });

    var router = new Router(uuid);
    router.process(new Client(remoteSocket));
    router.register();

    remoteSocket.on('error close', () => {
        active = false;
    });

    while (active) {
        await waittill(remoteSocket, 'error close', 15000);
        router.ping();
    }

    router.destroy();
}

async function AppRTCConnect(uuid) {
    while (1) {
        var apprtc = new AppRtc({
            roomId: config.room,
            passphrase: config.passphrase,
            uuid: uuid,
            dhcp: {
                keepUUIDs: true,
                acceptReservations: true,
                sessionPath: config.sessionPath
            },
            iceTimeout: 4000
        });

        apprtc.on('state', (state) => console.log(`RTC state ${state}`));

        var active = true;
        try {
            await apprtc.connect();
        } catch (err) {
            if (err instanceof RoomFullError) {
                console.log('the room is full...')
                await sleep(2000);
                continue;
            } else {
                process.nextTick(() => {
                    throw err;
                });
                break;
            }
        }

        apprtc.on('close', () => {
            active = false;
        });

        while (active) {
            await waittill(apprtc, 'close', 15000);
            apprtc.ping();
        }

        apprtc.destroy();
    }
}



