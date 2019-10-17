
const {EventEmitter} = require('events');
const readMessageFromStream = require('./msg');
const {AbstractSocket} = require('./sockets');
const {Socket} = require('net');

/**
 * Client class represents a user which can send/receive JSON using a socket
 */
class Client extends EventEmitter {
    /**
     * @param {AbstractSocket|Socket} socket 
     */
    constructor(socket) {
        super();

        this.socket = socket;
        this.closed = false;
        this.ipaddr = null;
        this.uuid = null;

        readMessageFromStream(socket, this, 'message');

        socket.on('close', () => this.destroy());
        socket.on('error', () => this.destroy());
        this.on('message', (msg) => {
            this.socketExpire = Date.now() + 60000;    
            if (typeof(msg.type) === 'string') {
                this.emit('msg-' + msg.type, msg);
            }
        });

        this.socketExpire = Date.now() + 60000;

        this.pingInterval = setInterval(() => {
            var timestamp = Date.now();

            if (timestamp >= this.socketExpire) {
                this.destroy();
            }

            if (global.debug && global.debug instanceof Set && !global.debug.has(this)) {
                global.debug.add(this);
                console.log(this);
            }
        }, 5000);
    }

    /**
     * destroy -> gracefully clears this instance
     */
    destroy() {
        if (!this.closed) {
            clearInterval(this.pingInterval);
            this.closed = true;
            this.socket.destroy();
            this.emit('close');
        }
    }

    /**
     * setIp -> Assignes a given ip address to this instance
     * @param {String} ipaddr 
     */
    setIp(ipaddr) {
        this.ipaddr = ipaddr;
    }

    /**
     * getIp -> returns an assigned ip address of this instance
     * @returns {String} ip address
     */
    getIp() {
        return this.ipaddr;
    }

    /**
     * setUUID -> assignes an UUID to this instance only once
     * @param {String} uuid 
     */
    setUUID(uuid) {
        this.uuid = this.uuid || uuid;
    }

    /**
     * getUUID -> returns an assigned UUID of this instance
     * @returns {String} UUID
     */
    getUUID() {
        return this.uuid;
    }

    /**
     * send -> sends a JSON compatible object (msg) through the socket
     * @param {Object} msg 
     */
    send(msg) {
        this.socket.write(JSON.stringify(msg) + '\n');
        this.socketExpire = Date.now() + 60000;
    }

    /**
     * ping -> sends a dummy message to tell the server that this connection is still alive
     */
    ping() {
        this.send({});
    }
}


module.exports = Client;
