/**
 * parseArgs -> returns a set of properties defined by "options".
 * example:
 * {
 *  <property_name>: {
 *   name: <long-name>,
 *   shortname: <short-name>,
 *   type: String|Number|Boolean,
 *   value: <default value in it's type>
 *  },
 *  ...
 * }
 * @param {Object} options 
 */
function parseArgs(options) {
    var values = {};
    var i, j;
    var keys = Object.keys(options);
    var states = {
        '0': false,
        '1': true,
        'false': false,
        'true': true
    };

    for (i = 0; i < keys.length; i++) {
        values[keys[i]] = options[keys[i]].value;
    }

    for (i = 0; i < process.argv.length; i++) {
        keys.forEach((keyname, j) => {
            if (process.argv[i] === '--' + options[keyname].name || process.argv[i] === '-' + options[keyname].shortname) {
                switch (options[keyname].type) {
                    case Number:
                        values[keyname] = parseFloat(process.argv[++i]);
                        return;
                    case String:
                        values[keyname] = process.argv[++i];
                        return;
                    case Boolean:
                        if (states.hasOwnProperty(process.argv[++i])) {
                            values[keyname] = states[process.argv[i]];
                        }
                        return;
                }
            }
        });
    }

    return values;
}

module.exports = parseArgs;