const wrtc = require('wrtc');
const {EventEmitter} = require('events');

global.peerConnectionConfig = {
	'iceServers': [{
			'urls': 'stun:stun.services.mozilla.com'
		}, {
			'urls': 'stun:stun.l.google.com:19302'
		},
	]
};

/**
 * Connection class handles a webrtc connection with a peer
 */
class Connection extends EventEmitter {
    constructor () {
        super();

        this.peerConnection = null;
        this.dataChannels = Object.create(null);
        this.remoteDataChannels = Object.create(null);
        this.isCaller = null;
    }

    /**
     * start -> builds a webrtc connection, creates an offer if "isCaller"
     * @param {Boolean} isCaller 
     */
    start(isCaller) {
        this.isCaller = isCaller;
	    var peerConnection = this.peerConnection = new wrtc.RTCPeerConnection(global.peerConnectionConfig);
	    peerConnection.onicecandidate = (event) => this.emit('ice', event.candidate);
	    peerConnection.onaddstream = (event) => {
            process.stderr.write('Stream are not supported yet.\n');
        };
	    //peerConnection.addStream(localStream);
	    peerConnection.ondatachannel = this.onReceiveDataChannel.bind(this);
	    peerConnection.onconnectionstatechange = (event) => {
            switch (peerConnection.connectionState) {
		        case "connected":
                    // The connection has become fully connected
		        case "disconnected":
		        case "failed":
                    // One or more transports has terminated unexpectedly or in an error
		        case "closed":
                    // The connection has been closed
                    this.emit(peerConnection.connectionState);
			        break;
		    }
        };
        
        Object.keys(this.dataChannels).forEach((name) => {
            this.createDataChannel(name, this.dataChannels[name]);
        });
	
	    if (isCaller) {
		    peerConnection.createOffer().then(this.onCreatedDescription.bind(this)).catch (this.errorHandler.bind(this));
	    }
    }

    /**
     * destroy -> closes webrtc connection
     */
    destroy() {
        Object.keys(this.dataChannels).forEach((channelName) => {
            this.dataChannels[channelName].close();
            delete this.dataChannels[channelName];
        });
        Object.keys(this.remoteDataChannels).forEach((channelName) => {
            this.remoteDataChannels[channelName].close();
            delete this.remoteDataChannels[channelName];
        });
	    this.peerConnection && this.peerConnection.close();
	    this.peerConnection == null;
    }

    /**
     * createDataChannel -> creates a unique channel to communicate through with the peer
     * @param {String} name 
     * @param {Object} options - data channel options passed to webrtc
     * @returns {wrtc.RTCDataChannel} data channel instance if "start" is initiated
     */
    createDataChannel(name, options) {
        if (!this.peerConnection) {
            this.dataChannels[name] = options;
            return;
        }

        if (this.dataChannels[name] instanceof wrtc.RTCDataChannel) {
            throw new Error('The channel already exists!');
        }

        var dataChannel = this.peerConnection.createDataChannel(name, options);
        this.dataChannels[name] = dataChannel;
        dataChannel.addEventListener('close', () => {
            delete this.dataChannels[name];
            this.emit('close-datachannel-' + name, dataChannel);
        });

        dataChannel.addEventListener('message', (event) => {
            this.emit('message-' + name, event);
        });

        return dataChannel;
    }

    /**
     * hasDataChannel -> tells wether a local data channel with such name exists
     * @param {String} name
     * @returns {Boolean} exists
     */
    hasDataChannel(name) {
        return this.dataChannels[name] ? true : false;
    }

    /**
     * hasRemoteDataChannel -> tells wether a remote data channel with such name exists
     * @param {String} name
     * @returns {Boolean} exists
     */
    hasRemoteDataChannel(name) {
        return this.remoteDataChannels[name] ? true : false;
    }

    /**
     * processMessageFromServer -> handles webrtc messages to establish the connection
     * @param {Object|String} message 
     */
    processMessageFromServer(message) {
        var peerConnection = this.peerConnection;
	    if (!peerConnection)
		    return;

	    var signal = typeof message === 'string' ? JSON.parse(message) : message;

	    if (signal.sdp) {
		    peerConnection.setRemoteDescription(new wrtc.RTCSessionDescription(signal.sdp)).then(() => {
			    // Only create answers in response to offers
			    if (signal.sdp.type == 'offer') {
				    peerConnection.createAnswer().then(this.onCreatedDescription.bind(this)).catch (this.errorHandler.bind(this));
			    }
		    }).catch (this.errorHandler.bind(this));
	    } else if (signal.ice) {
		    peerConnection.addIceCandidate(new wrtc.RTCIceCandidate(signal.ice)).catch (this.errorHandler.bind(this));
	    }
    }

    /**
     * sendMessage -> sends message through the channel with `channelName` if it's open
     * @param {String} channelName 
     * @param {String} message 
     */
    sendMessage(channelName, message) {
        let dataChannel = this.dataChannels[channelName];
        if (dataChannel && dataChannel.readyState === 'open') {
            dataChannel.send(message);
        }
    }

    /**
     * validateDescription -> removes all candidates so they are passed separately
     * @protected
     * @param {wrtc.RTCSessionDescription} desc 
     */
    validateDescription(desc) {
        var config = desc.sdp.split('\r\n');
        config = config.filter(x => !/^a\=candidate/.test(x));
        desc.sdp = config.join('\r\n');
    }

    /**
     * onCreatedDescription -> an internal function which handles locally created session description
     * @protected
     * @param {wrtc.RTCSessionDescription} description 
     */
    onCreatedDescription(description) {
        var peerConnection = this.peerConnection;

	    peerConnection.setLocalDescription(description).then(() => {
            var desc = JSON.parse(JSON.stringify(peerConnection.localDescription));
            this.validateDescription(desc);
            this.emit('sdp', desc);
	    }).catch (this.errorHandler.bind(this));
    }

    /**
     * onReceiveDataChannel -> internal
     * @protected
     * @param {wrtc.RTCDataChannelEvent} event 
     */
    onReceiveDataChannel(event) {
        var dataChannel = event.channel;
        if (dataChannel) {
            if (this.remoteDataChannels[dataChannel.label]) {
                process.stderr.write(`Error: remote channel "${dataChannel.label}" already exists\n`);
                dataChannel.close();
                return;
            }
            this.remoteDataChannels[dataChannel.label] = dataChannel;
            dataChannel.addEventListener('message', (event) => {
                this.emit('message-' + dataChannel.label, event);
            });
            dataChannel.addEventListener('close', () => {
                delete this.dataChannels[dataChannel.label];
                this.emit('close-datachannel-' + dataChannel.label, dataChannel);
            });
            this.emit('create-datachannel-' + dataChannel.label, dataChannel);
        }
    }

    /**
     * errorHandler -> internal
     * @protected
     * @param {Error} error 
     */
    errorHandler(error) {
	    process.stderr.write(error.stack + '\n');
    }
}

module.exports = Connection;
