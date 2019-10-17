
const fs = require('fs');

fs.readdirSync('./debugging').forEach((filename) => require('./debugging/' + filename));

setInterval(() => {}, 60000);

