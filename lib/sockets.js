const {EventEmitter} = require('events');
const crypto = require('crypto');
const Connection = require('./connection');

/**
 * AbstractSocket for sending and receiving messages
 */
class AbstractSocket extends EventEmitter {
    constructor() {
        super();
    }

    /**
     * write -> sends data to remote recipient
     * @param {String} data 
     */
    write(data) {
        process.stderr.write('AbstractSocket.write() not implemented!\n');
    }

    /**
     * destroy -> gracefully clears this instance
     */
    destroy() {
        process.stderr.write('AbstractSocket.destroy() not implemented!\n');
    }
}

/**
 * RTCSocket represents a socket which uses WebRTC aka p2p behind the scenes
 */
class RTCSocket extends AbstractSocket {
    /**
     * @param {Connection} rtcConnection - a p2p connection to use
     * @param {String} passphrase - an encryption key to encode/decode messages
     */
    constructor(rtcConnection, passphrase) {
        super();
        this.passphrase = passphrase;
        this.rtcConnection = rtcConnection;
        this.rtcConnection.on('message-control', (event) => {
            try {
                var buf = [];
                var decipher = crypto.createDecipher('aes256', passphrase);
                buf.push(decipher.update(Buffer.from(event.data, 'base64')));
                buf.push(decipher.final());
                this.emit('data', Buffer.concat(buf));
            } catch (err) {
                this.destroy();
                process.stderr.write(err.stack + '\n');
            }
        });
        this.rtcConnection.on('disconnected failed closed', () => {
            this.destroy();
        });
    }

    /**
     * write -> sends data to remote recipient
     * @param {String} data 
     */
    write(data) {
        var buf = [];
        var cipher = crypto.createCipher('aes256', this.passphrase);
        buf.push(cipher.update(data));
        buf.push(cipher.final());
        this.rtcConnection.sendMessage('control', Buffer.concat(buf).toString('base64'));
    }

    /**
     * destroy -> gracefully clears this instance
     */
    destroy() {
        if (this.rtcConnection) {
            this.rtcConnection.destroy();
            this.rtcConnection = null;

            process.nextTick(() => this.emit('close'));
        }
    }
}

/**
 * AppSocket represents a pseudo socket with no real I/O activities, used for internal purposes within this app.
 */
class AppSocket extends AbstractSocket {
    /**
     * @param {AppSocket} otherSocket - an AppSocket instance to attach to as a recipient
     */
    constructor(otherSocket) {
        super();
        if (otherSocket) {
            if (!(otherSocket instanceof AppSocket)) {
                throw new Error('An instance of AppSocket should be passed here!');
            }
            this.otherSocket = otherSocket;
            otherSocket.otherSocket = this;
            this.opened = otherSocket.opened = true;
        } else {
            this.otherSocket = null;
            this.opened = false;
        }
    }

    /**
     * write -> sends data to remote recipient
     * @param {String} data 
     */
    write(data) {
        process.nextTick(() => {
            if (this.opened) {
                this.otherSocket.emit('data', data);
            }
        });
    }

    /**
     * destroy -> gracefully clears this instance
     */
    destroy() {
        if (this.opened) {
            var otherSocket = this.otherSocket;
            otherSocket.opened = this.opened = false;
            otherSocket.otherSocket = null;
            this.otherSocket = null;
            process.nextTick(() => {
                otherSocket.emit('close');
                this.emit('close');
            });
        }
    }
}

module.exports = {
    AbstractSocket,
    RTCSocket,
    AppSocket
};

