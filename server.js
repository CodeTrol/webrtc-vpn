
const net = require('net');
const DHCPServer = require('./lib/dhcp');
const parseArgs = require('./lib/args');

const dhcp = new DHCPServer();
const server = net.createServer((socket) => {
    dhcp.process(socket);
});

const config = parseArgs({
    host: {
        name: 'host',
        shortname: 'h',
        value: '0.0.0.0',
        type: String
    },
    port: {
        name: 'port',
        shortname: 'p',
        value: 5555,
        type: Number
    }
});

server.listen(config.port, config.host);

server.on('listening', () => console.log('listening on', server.address().address, server.address().port));
