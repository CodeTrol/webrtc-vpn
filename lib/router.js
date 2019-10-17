const {EventEmitter} = require('events');
const Connection = require('./connection');
const Client = require('./client');
const adapter = require('./adapter');

/**
 * Router class responsible for handling I/O packets of tap adapter
 */
class Router extends EventEmitter {
    /**
     * @param {String} uuid a unique string representing this client
     */
    constructor(uuid) {
        super();

        this.uuid = uuid;
        this.adapter = null;
        this.client = null;
        this.members = Object.create(null);
        this.broadcastMac = Buffer.from([255,255,255,255,255,255]);
    }

    /**
     * process -> links this router with a given client
     * @param {Client} client a referrence to an instance of "./client.js"
     */
    process(client) {
        this.client = client;
        client.on('message', msg => {
            switch (msg.type) {
                case 'registration':
                    if (this.adapter) break;
                    console.log(`spawning tun client  ${msg.ipaddr}`);
                    this.adapter = new adapter.AdapterInterface('tun', msg.ipaddr, msg.mask);
                    this.adapter.on('packet', (buf, saddr, daddr) => {
                        if (this.broadcastMac.equals(buf.slice(0, 6))) {
                            let strbuf = buf.toString('base64');
                            Object.keys(this.members).forEach(daddr => {
                                this.members[daddr].sendMessage('vpn', strbuf);
                            });
                        }
                        else if (this.members[daddr]) {
                            this.members[daddr].sendMessage('vpn', buf.toString('base64'));
                        }
                    });
                    this.adapter.on('arp', request => {
                        if (this.members[request.daddr]) {
                            request.replyArp();
                        }
                    });
                    msg.reservations && this.emit('reservations', msg.reservations);
                    this.emit('registered', msg.ipaddr);
                    break;
                case 'join':
                    if (!this.members[msg.ipaddr]) {
                        let conn = this.members[msg.ipaddr] = new Connection();
                        this.configureConnection(conn, msg.ipaddr);
                        conn.start(true);
                        this.emit('join', msg);
                    }
                    break;
                case 'leave':
                    if (this.members[msg.ipaddr]) {
                        this.members[msg.ipaddr].destroy();
                        delete this.members[msg.ipaddr];
                    }
                    break;
                case 'offer':
                    if (!this.members[msg.ipaddrs]) {
                        let conn = this.members[msg.ipaddrs] = new Connection();
                        this.configureConnection(conn, msg.ipaddrs);
                        conn.start();
                        conn.processMessageFromServer(msg);
                        this.emit('join', {
                            type: 'join',
                            ipaddr: msg.ipaddrs,
                            uuid: msg.uuid
                        });
                    }
                    break;
                case 'answer':
                    if (this.members[msg.ipaddrs]) {
                        let conn = this.members[msg.ipaddrs];
                        conn.processMessageFromServer(msg);
                    }
                    break;
                case 'ice':
                    if (this.members[msg.ipaddrs]) {
                        let conn = this.members[msg.ipaddrs];
                        conn.processMessageFromServer(msg);
                    }
                    break;
            }
        });
    }

    /**
     * register -> tries to receive data from "./dhcp.js"
     * @param {Object} parameters to send to dhcp server
     */
    register(parameters) {
        if (!this.client) {
            throw new Error('No client assigned. Call "process" before this call to fix it!');
        }
        var payload = {
            uuid: this.uuid,
            type: 'register'
        };
        if (parameters && parameters.constructor === Object) {
            payload = Object.assign(payload, parameters);
        }
        this.client.send(payload);
    }

    /**
     * ping -> sends a dummy message, so the server knows the connection is still alive
     */
    ping() {
        if (this.client) {
            this.client.ping();
        }
    }

    /**
     * getIp -> returns an assigned ip address if the network adapter is up
     */
    getIp() {
        return this.adapter ? this.adapter.getIp() : null;
    }

    /**
     * destroy -> gracefully clear all data.
     */
    destroy() {
        if (this.client) {
            this.client.destroy();
            this.client = null;
        }

        if (this.adapter) {
            this.adapter.destroy();
            this.adapter = null;
        }
    }

    /**
     * configureConnection -> builds a peer-to-peer connection with new participant
     * @param {Connection} conn to apply binding to
     * @param {String} ipaddr a remote address `conn` is assigned to
     */
    configureConnection(conn, ipaddr) {
        conn.createDataChannel('vpn', {
            ordered: false
        });
        conn.on('sdp', sdp => {
            this.client.send({
                type: conn.isCaller ? 'offer' : 'answer',
                sdp, uuid: this.uuid,
                ipaddr: ipaddr,
                ipaddrs: this.adapter.getIp()
            });
        });
        conn.on('ice', ice => {
            this.client.send({
                type: 'ice',
                ice, uuid: this.uuid,
                ipaddr: ipaddr,
                ipaddrs: this.adapter.getIp()
            });
        });
        conn.on('message-vpn', event => {
            var data = Buffer.from(event.data, 'base64');
            var packet = {
                ignore: false,
                data
            };
            this.emit('firewall', packet);
            if (!packet.ignore) {
                let mac = this.adapter.getMac();
                mac.copy(data, 0, 0); // replace dmac
                mac.copy(data, 6, 0); // replace smac

                this.adapter.write(data);
            }
        });
    }

}

module.exports = Router;