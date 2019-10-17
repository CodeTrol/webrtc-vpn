
const util = require('util');
const sleep = util.promisify(setTimeout);

async function waittill(object, event, timeout) {
    var _resolve, timer;
    await new Promise((resolve, reject) => {
        _resolve = resolve;
        object.once(event, resolve);
        timer = setTimeout(resolve, timeout);
    });
    clearTimeout(timer);
    object.off(event, _resolve);
}

module.exports = {
    sleep,
    waittill
};
