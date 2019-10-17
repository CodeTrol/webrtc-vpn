
class RoomFullError extends Error {
    constructor (message) {
        super('RoomFullError: ' + message);
        this.stack = this.stack.replace(/^Error\: /, '');
    }
};

module.exports = {
    RoomFullError
};

