const DHCPServer = require('../lib/dhcp');
const path = require('path');
// Mockup DHCPServer //
class DHCPServerDebug extends DHCPServer {
    constructor(options) {
        super(options);
        global.dhcpServer = this;
    }
}

require.cache[path.resolve('./lib/dhcp.js')].exports = DHCPServerDebug;
///////////////////////
// Mockup Tcp Server //
const net = require('net');

(createServerFn => {
    net.createServer = function () {
        var server = createServerFn.apply(this, arguments);
        server.unref();
        global.server = server;
        return server;
    };
})(net.createServer);
///////////////////////
const {expect} = require('chai');
const {sleep} = require('../lib/timers');
const Client = require('../lib/client');
const getUUID = require('../lib/fake-uuid');


var server = null;
describe('Boot server', () => {
    it('should verify clean environment', async () => {
        var socket = net.connect({
            host: 'localhost',
            port: 5555
        });

        await new Promise((resolve, reject) => {
            socket.on('error', resolve);
            socket.on('connect', reject);
        });

        socket = net.connect({
            host: 'localhost',
            port: 6666
        });

        await new Promise((resolve, reject) => {
            socket.on('error', resolve);
            socket.on('connect', reject);
        });
    });
    it('should spawn server', async () => {
        require('../server');

        await sleep(3000);

        expect(global.dhcpServer).not.to.equal(null, 'alive');

        var socket = net.connect({
            host: 'localhost',
            port: 5555
        });

        await new Promise((resolve, reject) => {
            socket.on('error', reject);
            socket.on('connect', resolve);
        });

        socket.destroy();

    });
});

describe('Test clients', () => {
    var clients = [];
    it('should register a client', async () => {
        var socket = net.connect({
            host: 'localhost',
            port: 5555
        });

        await new Promise((resolve, reject) => {
            socket.on('error', reject);
            socket.on('connect', resolve);
        });

        var client = new Client(socket);

        client.setUUID(getUUID());

        client.send({
            type: 'register',
            uuid: client.getUUID()
        });

        var response = await new Promise((resolve, reject) => {
            client.once('message', (msg) => resolve(msg));
            client.once('close', reject);
        });

        expect(response.type).to.equal('registration');
        expect(response.ipaddr).to.equal('10.16.0.1');

        clients.push(client);

        client.setIp(response.ipaddr);
        client.connectedClients = {};
        client.on('msg-join', (msg) => {
            client.connectedClients[msg.ipaddr] = false;
            client.send({
                type: 'offer',
                ipaddr: msg.ipaddr,
                ipaddrs: client.getIp(),
                uuid: client.getUUID()
            });
        });

        client.on('msg-answer', (msg) => {
            if (client.connectedClients.hasOwnProperty(msg.ipaddrs)) {
                client.connectedClients[msg.ipaddrs] = true;
                client.send({
                    type: 'ice',
                    ipaddr: msg.ipaddrs,
                    ipaddrs: client.getIp(),
                    foo: 'bar',
                    uuid: client.getUUID()
                });
            }
        });

        client.on('msg-leave', (msg) => {
            if (client.connectedClients.hasOwnProperty(msg.ipaddr)) {
                client.connectedClients[msg.ipaddr] = false;
            }
        });
    });

    it('should register second client', async () => {
        var socket = net.connect({
            host: 'localhost',
            port: 5555
        });

        await new Promise((resolve, reject) => {
            socket.on('error', reject);
            socket.on('connect', resolve);
        });

        var client = new Client(socket);

        client.setUUID(getUUID());

        client.send({
            type: 'register',
            uuid: client.getUUID()
        });

        var response = await new Promise((resolve, reject) => {
            client.once('message', (msg) => resolve(msg));
            client.once('close', reject);
        });

        expect(response.type).to.equal('registration', 'expecting to receive registartion message');
        expect(response.ipaddr).to.equal('10.16.0.2');

        client.setIp(response.ipaddr);

        response = await new Promise((resolve) => {
            client.once('msg-offer', resolve);
        });

        expect(response.ipaddr).to.equal(client.getIp(), 'destination address must match the address of the client received the message');
        expect(response.ipaddrs).to.equal(clients[0].getIp(), 'source address must match the address of 1st client');

        client.send({
            type: 'answer',
            uuid: client.getUUID(),
            ipaddr: response.ipaddrs,
            ipaddrs: client.getIp(),
        });

        response = await new Promise((resolve) => {
            client.once('msg-ice', resolve);
        });

        expect(response.ipaddr).to.equal(client.getIp(), 'destination address must match the address of the client received the message');
        expect(response.ipaddrs).to.equal(clients[0].getIp(), 'source address must match the address of 1st client');
        expect(response.foo).to.equal('bar', 'arbitary data should be forwarded');

        client.destroy();

        await sleep(1000);

        expect(clients[0].connectedClients[client.getIp()]).to.equal(false, 'the client should leave the room');
    });

    it('should drop all clients', async () => {
        clients.forEach((client) => client.destroy());
        
        await sleep(1000);

        expect(Object.keys(global.dhcpServer.clientsByIp).length, 'List of connected clients').to.equal(0, 'must be empty');

        
    });
});

describe('Shutdown server', () => {
    it('close the server', async () => {
        global.server.close();

        await sleep(1000);

        var socket = net.connect({
            host: 'localhost',
            port: 5555
        });

        await new Promise((resolve, reject) => {
            socket.on('error', resolve);
            socket.on('connect', reject);
        });
    })
});

