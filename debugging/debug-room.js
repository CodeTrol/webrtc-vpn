const Client = require('../lib/client')
const net = require('net');
const getUUID = require('../lib/fake-uuid');

global.debugRoom = async () => {
    var socket = net.connect(5555, '127.0.0.1');
    
    var client = new Client(socket);
    client.setUUID(getUUID());
    client.on('message', (msg) => console.log(msg));
    client.send({
        type: 'register',
        uuid: client.getUUID()
    });
};