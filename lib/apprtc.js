const {EventEmitter} = require('events');
const {RoomFullError} = require('./errors');
const Connection = require('./connection');
const DHCPServer = require('./dhcp');
const Client = require('./client');
const Router = require('./router');
const {RTCSocket, AppSocket} = require('./sockets');
const WebSocket = require('ws');
const request = require('request-promise-native');

const userAgent = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:69.0) Gecko/20100101 Firefox/69.0';
/**
 * AppRtc
 * @private @property {String} passphrase
 */
class AppRtc extends EventEmitter {
    constructor({roomId, passphrase, uuid, dhcp, iceTimeout}) {
        super();

        this.uuid = uuid;
        this.roomId = roomId;
        this.passphrase = passphrase;
        this.dhcpOptions = Object.assign({
            keepUUIDs: true
        }, dhcp || {});
        this.iceTimeout = iceTimeout || null;
        this.rtcConnection = null;
        this.ws = null;
        this.isHost = null;
        this.roomData = null;
        this.socket = null;

        this.rtcData = null;

        this.router = null;

        this.dhcpServer = new DHCPServer(this.dhcpOptions);
    }

    /**
     * fetchRoomDetails -> reads room info from appr.tc
     */
    async fetchRoomDetails() {
        if (this.roomData) {
            return this.roomData;
        }

        var roomData = JSON.parse(await request(`https://appr.tc/join/${this.roomId}`, {
            method: 'POST',
            headers: {
                'User-Agent': 'curl'
            }
        }));

        if (roomData.result === 'FULL') {
            throw new RoomFullError('The server is busy. Maybe try another room.');
        }

        this.roomData = roomData;

        return roomData;
    }

    /**
     * updateIceServers -> reads and updates peer config for webrtc connections
     */
    async updateIceServers() {
        var roomData = await this.fetchRoomDetails();
        var iceServerRequestUrl = roomData.params.ice_server_url;

        var apiResponse = JSON.parse(await request(iceServerRequestUrl, {
            method: 'POST',
            headers: {
                'User-Agent': userAgent,
                'Referer': 'https://appr.tc/'
            }
        }));

        global.peerConnectionConfig = Object.assign(JSON.parse(roomData.params.pc_config), apiResponse);
    }

    /**
     * connect -> joins the room and creates vpn with participants
     * @returns string containing an ip address this client has assigned to
     */
    async connect() {
        this.emit('state', 'fetch-room-details');
        var roomData = global.roomData = await this.fetchRoomDetails();

        //await this.updateIceServers();

        var wssUrl = roomData.params.wss_url;

        this.isHost = JSON.parse(roomData.params.is_initiator);

        this.emit('state', 'connect-websocket');
        this.ws = new WebSocket(wssUrl, {
            headers: {
                'User-Agent': userAgent,
                'Origin': 'https://appr.tc'
            }
        });

        this.ws.on('message', (data) => {
            var msg = JSON.parse(JSON.parse(data).msg);
            if (typeof(msg) === 'string') {
                msg = JSON.parse(msg);
            }
            switch (msg.type) {
                case 'bye':
                    if (this.isHost && !this.rtcConnection) {
                        this.setupRTC(); // create new peer connection for next client
                    }
                    break;
                case 'answer':
                    if (this.rtcReceivedData.sdp) break;
                    this.rtcReceivedData.sdp = msg;
                case 'offer':
                    this.rtcConnection.processMessageFromServer({
                        sdp: msg
                    });
                    break;
                case 'candidate':
                    this.rtcReceivedData.candidates.push(JSON.parse(msg.candidate));
                    this.rtcConnection && this.rtcConnection.processMessageFromServer({
                        ice: JSON.parse(msg.candidate)
                    });
                    break;
            }
            this.emit('ws-message', msg);
        });
        this.ws.on('error', err => {
            process.stderr.write(err.stack + '\n');
        });

        try {
            await new Promise((resolve, reject) => {
                this.ws.once('open', resolve);
                this.ws.once('error', reject);
            });
        } catch (err) {
            err.stack = err.stack.replace(/^[^\:]+/, 'WebSocketError');
            throw err;
        }

        this.ws.send(JSON.stringify({
            cmd: "register",
            roomid: this.roomId,
            clientid: roomData.params.client_id
        }));

        this.emit('state', 'spawn-webrtc');

        await this.setupRTC();

        if (roomData.params.messages) {
            roomData.params.messages.forEach((msg) => {
                this.ws.emit('message', JSON.stringify({msg}));
            });
        }

        this.emit('state', 'await-for-connections');

        await new Promise((resolve, reject) => {
            this.rtcConnection.once('connected', resolve);
            this.rtcConnection.once('disconnected failed closed', () => reject(new Error('Failed to establish RTC connection')));
        });

        await new Promise((resolve, reject) => {
            if (this.rtcConnection.hasRemoteDataChannel('control')) {
                resolve();
            } else {
                this.rtcConnection.once('create-datachannel-control', resolve);
                setTimeout(() => reject(new Error('Invalid peer connected, use different room')), 4000);
            }
        });

        this.emit('state', 'handle-socket');

        if (this.isHost) {
            // create mutual socket
            this.socket = new AppSocket();
            this.dhcpServer.process(new AppSocket(this.socket));
        } else {
            // detach websocket (leave the room for new users), go p2p with the host
            this.socket = new RTCSocket(this.rtcConnection, this.passphrase);
            this.socket.on('close', () => {
                this.destroy();
                this.emit('close');
            });
            this.ws.send(JSON.stringify({
                cmd: 'send',
                msg: JSON.stringify({
                    type: 'bye',
                    error: ''
                })
            }));
            await this.closeWebSocket();
        }

        this.emit('state', 'configure-router');

        this.router = new Router(this.uuid);
        this.router.on('join', ({ipaddr, uuid}) => {
            !this.isHost && this.dhcpServer.updateReservations(uuid, ipaddr);
        });
        this.router.on('reservations', (reservations) => {
            if (!this.isHost) {
                Object.keys(reservations).forEach((uuid) => {
                    this.dhcpServer.updateReservations(uuid, reservations[uuid]);
                });
            }
        });
        this.router.process(new Client(this.socket));
        this.router.register(this.isHost ? undefined : {
            reservations: this.dhcpServer.getReservations()
        });

        this.emit('state', 'standby-router');

        return await new Promise((resolve, reject) => {
            this.router.once('registered', resolve);
            this.rtcConnection && this.rtcConnection.once('disconnected failed closed', () => reject(new Error('Disconnected.')));
        });
    }

    /**
     * destroy -> gracefully clears this instance
     */
    destroy() {
        this.isHost = null;
        if (this.rtcConnection) {
            this.rtcConnection.destroy();
            this.rtcConnection = null;
        }
        if (this.dhcpServer) {
            this.dhcpServer.destroy();
            this.dhcpServer = null;
        }
        if (this.router) {
            this.router.destroy();
            this.router = null;
        }
        this.closeWebSocket();
    }

    /**
     * setupRTC -> handles webrtc connection to setup p2p sockets
     */
    async setupRTC() {
        if (this.rtcConnection) {
            throw new Error('RTCConnection is already created!');
        }
        if (!this.ws) {
            return;
        }

        var data = this.rtcData = {
            sdp: null,
            candidates: [],
            gotAllCandidates: false
        };
        this.rtcReceivedData = {
            sdp: null,
            candidates: []
        };
        var sentRtcData = false;
        this.rtcConnection = new Connection();
        this.rtcConnection.on('sdp', (sdp) => {
            data.sdp = sdp;
            if (data.gotAllCandidates) {
                if (!sentRtcData) {
                    sentRtcData = true;
                    this.rtcSendData(data);
                }
            }
        });
        this.rtcConnection.on('ice', (ice) => {
            if (ice) {
                let routerIp = this.router ? this.router.getIp() : null;
                if (routerIp && routerIp === ice.address) return;
                data.candidates.push(ice);
            } else {
                data.gotAllCandidates = true;
                if (data.sdp) {
                    if (!sentRtcData) {
                        sentRtcData = true;
                        this.rtcSendData(data);
                    }
                }
            }
        });
        this.rtcConnection.once('create-datachannel-control', () => {
            if (this.isHost) {
                this.dhcpServer.process(new RTCSocket(this.rtcConnection, this.passphrase));
                this.rtcConnection = null;
            }
        });

        this.rtcConnection.createDataChannel('control', {
            ordered: true
        });

        if (this.isHost) {
            this.rtcConnection.start(true);
        } else {
            this.rtcConnection.start();
        }

        if (this.iceTimeout > 0) {
            setTimeout(() => {
                if (data.sdp && data.candidates.length) {
                    if (!sentRtcData) {
                        sentRtcData = true;
                        this.rtcSendData(data);
                    }
                }
            }, this.iceTimeout);
        }

    }

    /**
     * closeWebSocket -> gracefully leaves the room and closes the socket
     */
    async closeWebSocket() {
        if (this.ws) {
            this.ws.send(JSON.stringify({
                cmd: 'send',
                msg: JSON.stringify({
                    type: 'bye',
                    error: ''
                })
            }));
            this.ws.close();
            this.ws = null;

            await request(`https://appr.tc/leave/${this.roomId}/${this.roomData.params.client_id}`, {
                method: 'POST',
                headers: {
                    'User-Agent': userAgent
                }
            });

            await request(`${roomData.params.wss_post_url}/${this.roomId}/${this.roomData.params.client_id}`, {
                method: 'DELETE',
                headers: {
                    'User-Agent': userAgent,
                    'Origin': 'https://appr.tc'
                }
            });
        }
    }

    /**
     * @protected rtcSendData -> sends data (sdp and ice candidates) to another recipient through appr.tc or websocket
     * @param {Object} data - a payload to send
     */
    async rtcSendData(data) {
        if (!this.ws) return;
        if (this.isHost) {
            var response = await request(`https://appr.tc/message/${this.roomId}/${this.roomData.params.client_id}`, {
                method: 'POST',
                json: true,
                body: data.sdp,
                headers: {
                    'User-Agent': userAgent,
                    'Content-Type': 'text/plain;charset=utf-8',
                    'Referer': 'https://appr.tc/'
                }
            });

            if (response.result !== 'SUCCESS') {
                throw new Error('Failed to send session descriptor');
            }
        } else {
            // send through websocket
            this.ws.send(JSON.stringify({
                cmd: 'send',
                msg: JSON.stringify(data.sdp)
            }))
        }

        for (var i = 0; i < data.candidates.length; i++) {
            var ice = data.candidates[i];
            
            if (this.isHost) {
                var response = await request(`https://appr.tc/message/${this.roomId}/${this.roomData.params.client_id}`, {
                    method: 'POST',
                    json: true,
                    body: {
                        candidate: JSON.stringify(ice),
                        id: "0",
                        label: 0,
                        type: "candidate"
                    },
                    headers: {
                        'User-Agent': userAgent,
                        'Content-Type': 'text/plain;charset=utf-8',
                        'Referer': 'https://appr.tc/'
                    }
                });
    
                if (response.result !== 'SUCCESS') {
                    throw new Error('Failed to send ice candidate');
                }
            } else {
                // send through websocket
                this.ws.send(JSON.stringify({
                    cmd: 'send',
                    msg: JSON.stringify({
                        candidate: JSON.stringify(ice),
                        id: "0",
                        label: 0,
                        type: "candidate"
                    })
                }));
            }
        }
        this.emit('sent-rtc-data');
    }

    /**
     * ping -> sends a dummy message, so the server knows the connection is still alive
     */
    ping() {
        if (this.router) {
            this.router.ping();
        }
    }
}

module.exports = AppRtc;

