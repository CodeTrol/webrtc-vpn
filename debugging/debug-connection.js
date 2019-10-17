
const Connection = require('../lib/connection');

global.debugConnection = async () => {
    var connA = new Connection();
    var connB = new Connection();

    connA.on('sdp', sdp => {
        console.log('A', sdp);
        connB.processMessageFromServer({sdp:JSON.parse(JSON.stringify(sdp))});
    });
    connA.on('ice', ice => {
        console.log('A', ice);
        connB.processMessageFromServer({ice:JSON.parse(JSON.stringify(ice))});
    });

    connB.on('sdp', sdp => {
        console.log('B', sdp);
        connA.processMessageFromServer({sdp:JSON.parse(JSON.stringify(sdp))});
    });
    connB.on('ice', ice => {
        console.log('B', ice);
        connA.processMessageFromServer({ice:JSON.parse(JSON.stringify(ice))});
    });

    connA.createDataChannel('control', {
        ordered: true
    });

    connA.once('connected', () => {
        console.log('connected');
        connA.sendMessage('control', 'Hello, World!');
    });
    connA.on('disconnected', () => console.log('disconnected'));
    connA.on('failed', () => console.log('failed'));

    connB.on('message-control', msg => console.log(msg));

    connB.start();
    connA.start(true);

};
