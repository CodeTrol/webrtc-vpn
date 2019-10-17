
function readMessageFromStream(socket, eventEmitterInstance, event) {
    var buf = '';
    socket.on('data', (data) => {
        var messages = (buf+data.toString()).split('\n');
        buf = '';
        while (messages.length) {
            var msg = messages[0];
            try {
                msg = JSON.parse(msg);
            } catch (e) {
                if (messages.length > 1) {
                    messages.splice(0, 1);
                    continue;
                }
                buf += msg;
                return;
            }
            messages.splice(0, 1);
            if (msg && msg.constructor === Object) {
                eventEmitterInstance.emit(event, msg);
            }
        }
    });
}

module.exports = readMessageFromStream;
