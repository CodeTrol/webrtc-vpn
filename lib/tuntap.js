const {Duplex} = require('stream');
const tuntapBind = require('../build/Release/tuntap');

class TunTap extends Duplex {
    constructor(params, options) {
        super(options);

        if (params.name.length > 127) throw new Error(`Tap interface name is too long: "${params.name}"`);

        this.handle_ = new tuntapBind(params);
	
	    this.is_open = true;
	
	    this.handle_._on_read = (buffer) => {
		    if (!this.push(buffer))
			    this.handle_.stopRead();
	    };
	
	    this.handle_._on_error = (error) => {
		    this.emit('error', error);
	    };
    }

    _read(size) {
        this.handle_.startRead();
    }

    _write(buffer, encoding, callback) {
        if(this.is_open) {
            if(!Buffer.isBuffer(buffer)) {
                buffer = new Buffer(buffer, encoding);
            }
            
            try {
                this.handle_.writeBuffer(buffer);
            }
            catch(e) {
                this.emit('error', e);
            }
        }
        
        callback();
    }

    open(arg) {
        var ret;

        this.is_open = true;

	    try {
		    if (arg != undefined)
                ret = this.handle_.open(arg);
            else
                ret = this.handle_.open();
	    }
	    catch(e) {
		    this.emit('error', e);
	    }
	
	    if (typeof(ret) != 'object')
		    return ret;

	    return this;
    }

    close() {
        this.is_open = false;

        try {
            this.handle_.close();
        }
        catch(e) {
            this.emit('error', e);
        }

        return this;
    }

    set(params) {
        try {
            this.handle_.set(params);
        }
        catch(e) {
            this.emit('error', e);
        }
        
        return this;
    }
    
    unset(params) {
        try {
            this.handle_.unset(params);
        }
        catch(e) {
            this.emit('error', e);
        }
        
        return this;
    }
}

module.exports = TunTap;

