const fs = require('fs');
const util = require('util');
const Client = require('./client');
const {AbstractSocket} = require('./sockets');
const {Socket} = require('net');
const {EventEmitter} = require('events');
const wait = util.promisify(setTimeout);
const writeFile = util.promisify(fs.writeFile);

/**
 * DHCPServer class acts as a mini administrator which provides unique IP addresses to clients so they can communicate with each other
 */
class DHCPServer extends EventEmitter {
    constructor(options) {
        super();
        options = options || {};
        this.clientsByIp = Object.create(null);
        this.clientsByUUID = Object.create(null);

        this.keepUUIDs = !!options.keepUUIDs;
        this.acceptReservations = !!options.acceptReservations;

        this.session = {
            number: 0,
            prefix: '10.16.',
            mask: '255.255.0.0',
            maxNumber: 64768,
            reservations: {}
        };

        this.writingData = null;

        if (options.sessionPath) {
            this.on('session-updated', async () => {
                await writeFile(`${options.sessionPath}/dhcp.json`, JSON.stringify(this.session));
            });

            if (!fs.existsSync(options.sessionPath)) {
                fs.mkdirSync(options.sessionPath);
            } else if (fs.existsSync(`${options.sessionPath}/dhcp.json`)) {
                this.session = JSON.parse(fs.readFileSync(`${options.sessionPath}/dhcp.json`));
            }
        }

    }

    /**
     * allocateIpAddress -> allocates an IP address for UUID user and notifies other clients about arrival of this new client
     * @param {String} uuid 
     * @returns {String} ip address for UUID user
     */
    allocateIpAddress(uuid) {
        if (this.clientsByUUID[uuid]) return null;

        var keys = Object.keys(this.clientsByIp);
        var freeIp = this.session.reservations.hasOwnProperty(uuid) ? this.reservations[uuid] : null;

        if (!freeIp) {
            while (this.session.number < this.session.maxNumber) {
                freeIp = this.session.prefix + (this.session.number / 253 | 0) + '.' + ((this.session.number % 253) + 1);
                if (!this.session.reservations.hasOwnProperty(freeIp)) break;
                this.session.number++;    
            }
            if (this.session.number >= this.session.maxNumber) return null;
            this.session.number++;
            this.session.reservations[uuid] = freeIp;
            this.emit('session-updated');
        }

        for (var i = 0; i < keys.length; i++) {
            if (this.clientsByIp[keys[i]]) {
                this.clientsByIp[keys[i]].send({
                    type: 'join',
                    uuid: this.keepUUIDs ? uuid : undefined,
                    ipaddr: freeIp
                });
            }
        }

        return freeIp;
    }

    /**
     * dealocateIpAddress -> sets this client away and notifies other clients about it
     * @param {Client} client 
     */
    dealocateIpAddress(client) {
        var uuid = client.getUUID();
        var ipaddr = client.getIp();

        if (!ipaddr) return;

        var keys = Object.keys(this.clientsByIp);

        for (var i = 0; i < keys.length; i++) {
            var participant = this.clientsByIp[keys[i]];
            if (participant && participant !== client) {
                participant.send({
                    type: 'leave',
                    ipaddr
                });
            }
        }

        delete this.clientsByIp[ipaddr];
        delete this.clientsByUUID[uuid];
    }

    /**
     * updateReservations -> locks the UUID user to the ipaddr to assign next time
     * @param {String} uuid 
     * @param {String} ipaddr 
     */
    updateReservations(uuid, ipaddr) {
        if (this.session.reservations.hasOwnProperty(uuid) && this.session.reservations[uuid] !== ipaddr) {
            process.stderr.write(`DHCPServer.updateReservations(): Duplicate uuid with different ipaddr detected ${uuid} : ${ipaddr}\n`);
            return;
        }
        this.session.reservations[uuid] = ipaddr;
        if (this.writingData != null) return;
        this.writingData = setTimeout(() => {
            this.writingData = null;
            this.emit('session-updated');
        });
    }

    /**
     * getReservations
     * @returns {Object} current session reservations
     */
    getReservations() {
        return this.session.reservations;
    }

    /**
     * process -> handles a client socket 
     * @param {AbstractSocket|Socket} socket 
     */
    process(socket) {
        var client = new Client(socket);

        client.on('close', () => {
            if (client.getIp()) {
                this.dealocateIpAddress(client);
            }
        });

        client.on('message', async (msg) => {
            var ipaddr = msg.ipaddr;
            var msgtype = msg.type;
            var uuid = client.getUUID() || msg.uuid;
            if (!this.keepUUIDs) {
                delete msg.uuid;
            }
            switch(msgtype) {
                case 'register':
                    if (client.getIp()) {
                        client.send({
                            type: 'error',
                            error: 'already_registered'
                        });
                        break;
                    }
                    if (this.acceptReservations) {
                        let reservations = msg.reservations || {};
                        let clientReservationsKeys = Object.keys(reservations);
                        if (!clientReservationsKeys.length) {
                            this.emit('client', {
                                uuid, type: msg.type
                            });
                            await new Promise(resolve => {
                                this.once('client', resolve);
                                if (this.session.number > 0) resolve();
                            });
                        } else {
                            // merge reservations here
                            for (let i = 0; i < clientReservationsKeys.length; i++) {
                                let uuidKey = clientReservationsKeys[i];
                                if (this.session.reservations.hasOwnProperty(uuidKey) && reservations[uuidKey] !== this.session.reservations[uuidKey]) {
                                    client.send({
                                        type: 'error',
                                        error: 'merge_mismatch'
                                    });
                                    client.destroy();
                                    return;
                                }
                            }
                            for (let i = 0; i < clientReservationsKeys.length; i++) {
                                let uuidKey = clientReservationsKeys[i];
                                this.updateReservations(uuidKey, reservations[uuidKey]);
                            }
                            this.emit('client', {
                                uuid, type: msg.type
                            });
                            await wait(50);
                        }
                    }
                    ipaddr = this.allocateIpAddress(uuid);
                    if (ipaddr) {
                        client.setIp(ipaddr);
                        client.setUUID(uuid);
                        this.clientsByIp[ipaddr] = client;
                        this.clientsByUUID[uuid] = client;
                        client.send({
                            type: 'registration',
                            mask: this.session.mask,
                            reservations: this.keepUUIDs ? this.session.reservations : undefined,
                            uuid, ipaddr
                        });
                    } else {
                        client.send({
                            type: 'error',
                            error: 'out_of_ipaddreses'
                        });
                        client.destroy();
                    }
                    break;
                case 'offer':
                case 'answer':
                case 'ice':
                    if (this.clientsByIp[ipaddr] && client.getIp() !== ipaddr) {
                        this.clientsByIp[ipaddr].send(msg);
                    }
                    break;
            }
        });

    }

    /**
     * destroy -> gracefully clears this instance
     */
    destroy() {
        var keys = Object.keys(this.clientsByUUID);

        for (var i = 0; i < keys.length; i++) {
            this.dealocateIpAddress(this.clientsByUUID[keys[i]]);
        }
    }
}

module.exports = DHCPServer;
