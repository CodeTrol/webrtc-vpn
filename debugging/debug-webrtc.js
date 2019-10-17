
const wrtc = require('wrtc');

class Connection {
    constructor (ipaddr) {
        this.peerConnection = null;
        this.dataChannel = null;
        this.remoteDataChannel = null;
        this.isCaller = null;
        this.ipaddr = ipaddr;
        //this.remoteDataChannel = null;
    }

    start(isCaller) {
        this.isCaller = isCaller;
	    var peerConnection = this.peerConnection = new wrtc.RTCPeerConnection(peerConnectionConfig);
	    peerConnection.onicecandidate = this.gotIceCandidate.bind(this);
	    peerConnection.onaddstream = this.gotRemoteStream.bind(this);
	    //peerConnection.addStream(localStream);
	    peerConnection.ondatachannel = this.onReceiveDataChannel.bind(this);
	    peerConnection.onconnectionstatechange = (event) => {
		    process.stderr.write('connection state: ' + peerConnection.connectionState + '\n');
		    switch (peerConnection.connectionState) {
		        case "connected":
                    // The connection has become fully connected

			    break;
		        case "disconnected":
		        case "failed":
                    // One or more transports has terminated unexpectedly or in an error
                    this.destroy();
                break;
		        case "closed":
                    // The connection has been closed
                    this.destroy();
			    break;
		    }
	    };
    

	    var dataChannel = this.dataChannel = peerConnection.createDataChannel("vpn", {
            ordered: false
            //ordererd: true, // todo try false for vpn
            //maxPacketLifeTime: null,
            //maxRetransmits: null
        });

        dataChannel.onopen =
	    dataChannel.onclose = () => {
		    var readyState = dataChannel.readyState;
		    process.stderr.write('channel state is: ' + readyState + '\n');
	    };

        //console.log(dataChannel.__proto__);
	    dataChannel.addEventListener('message', this.onMessage.bind(this));

	    if (isCaller) {
		    peerConnection.createOffer().then(this.createdDescription.bind(this)).catch (this.errorHandler.bind(this));
	    }
    }

    end() {
        process.stderr.write('Closing connection\n');
        this.remoteDataChannel && this.remoteDataChannel.close();
	    this.dataChannel && this.dataChannel.close();
	    this.peerConnection && this.peerConnection.close();
	    this.dataChannel = null;
	    this.peerConnection == null;
    }

    gotMessageFromServer(message) {
        var peerConnection = this.peerConnection;
	    if (!peerConnection)
		    return;

	    var signal = typeof message === 'string' ? JSON.parse(message) : message;


	    if (signal.sdp) {
		    peerConnection.setRemoteDescription(new wrtc.RTCSessionDescription(signal.sdp)).then(() => {
			    // Only create answers in response to offers
			    if (signal.sdp.type == 'offer') {
				    peerConnection.createAnswer().then(this.createdDescription.bind(this)).catch (this.errorHandler.bind(this));
			    }
		    }).catch (this.errorHandler.bind(this));
	    } else if (signal.ice) {
		    peerConnection.addIceCandidate(new wrtc.RTCIceCandidate(signal.ice)).catch (this.errorHandler.bind(this));
	    }
    }

    onMessage(event) {
        //console.log('Received Message: ' + event.data);
        //process.stdout.write(event.data);
        console.log(event);
    }

    gotIceCandidate(event) {
	    if (event.candidate) {
		    //serverConnection.send(JSON.stringify({'ice': event.candidate, 'uuid': uuid}));
		    console.log({
				'ice': event.candidate
            });
            /*remoteSocket.write(JSON.stringify({
                'type': 'ice',
                'ice': event.candidate,
                'hwaddr': uuid,
                'ipaddr': this.ipaddr,
                'ipaddrs': tt.ipaddr
            }) + '\n');*/
	    }
    }

    validateDescription(desc) {
        var config = desc.sdp.split('\r\n');
        config = config.filter(x => !/^a\=candidate/.test(x));
        desc.sdp = config.join('\r\n');
    }

    createdDescription(description) {
        var peerConnection = this.peerConnection;
	    process.stderr.write('got description\n');

	    peerConnection.setLocalDescription(description).then(() => {
            var desc = JSON.parse(JSON.stringify(peerConnection.localDescription));
            this.validateDescription(desc);
		    //serverConnection.send(JSON.stringify({'sdp': peerConnection.localDescription, 'uuid': uuid}));
		    console.log({
				'sdp': desc
            });
	    }).catch (this.errorHandler.bind(this));
    }

    gotRemoteStream(event) {
        process.stderr.write('Error got unwanted stream\n');
    }

    onReceiveDataChannel(event) {
        //console.log(event);
        if (this.remoteDataChannel) {
            process.stderr.write('Error: has a data channel already\n');
            return;
        }
        this.remoteDataChannel = event.channel;
        this.remoteDataChannel.addEventListener('message', this.onMessage.bind(this));
    }

    errorHandler(error) {
	    process.stderr.write(error.stack + '\n');
    }
}

global.Connection = Connection;