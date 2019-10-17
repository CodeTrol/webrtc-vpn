const os = require('os');
const TunTap = require('./tuntap');
const {EventEmitter} = require('events');

const ETH_P_ARP = 0x0806 // Address Resolution packet
const ETH_P_IP = 0x0800 // Internet Protocol packet

const ARP_ETHERNET = 0x0001
const ARP_IPV4 = 0x0800
const ARP_REQUEST = 0x0001
const ARP_REPLY = 0x0002

const IP_TCP = 0x06

const IP_PACKET_IPV4 = 0b0100
const IP_PACKET_IPV6 = 0b0110

const ethNameDefault = 'tun';

/**
 * AdapterInterface class that handles network communications
 */
class AdapterInterface extends EventEmitter {
    /**
     * @param {String} ethName 
     * @param {String} addr 
     * @param {String} mask 
     */
    constructor(ethName, addr, mask) {
        super();

        this.tuntap = new TunTap({
            type: 'tap',
            name: ethName || ethNameDefault,
            mtu: 1000,
            addr: addr,
            dest: '0.0.0.0',
            mask: mask || '255.255.255.0',
            persist: false,
            up: true,
            running: true,
        });
    
        this.ipaddr = addr;

        var networkInterfaces = os.networkInterfaces();
        this.config = networkInterfaces[ethName];
        this.mac = Buffer.from(this.config[0].mac.replace(/\:/g, ''), 'hex');

        this.members = Object.create(null);

        this.tuntap.on('data', this.processPacket.bind(this));
    }

    /**
     * destroy -> gracefully clears this instance
     */
    destroy() {
        this.tuntap.close();
    }

    /**
     * getMac -> returns a mac address assigned to this interface
     * @returns {String}
     */
    getMac() {
        return this.mac;
    }

    /**
     * getIp -> returns an IP address assigned to this interface
     * @returns {String}
     */
    getIp() {
        return this.ipaddr;
    }

    /**
     * write -> sends data to OS to process it
     * @param {Buffer} data 
     */
    write(data) {
        this.tuntap.write(data);
    }

    /**
     * processPacket -> accepts data which is coming from OS
     * @param {Buffer} data 
     */
    processPacket(data) {
        if (data.length >= 14) {
            var ethtype = data[12] * 256 + data[13];
            //var ethtype_text = null;
            var dmac = this.bufferToMac(data.slice(0, 6));
            var smac = this.bufferToMac(data.slice(6, 12));
            switch (ethtype) {
                case ETH_P_ARP:
                    processArpPacket(data);
                    //ethtype_text = 'ARP';
                    break;
                case ETH_P_IP:
                    processIpPacket(data);
                    //ethtype_text = 'IP';
                    break;
            }
        }
    }

    /**
     * processArpPacket -> handles packets of type ARP
     * @param {Buffer} data 
     */
    processArpPacket(data) {
        var arphdr = data.slice(14);
        var hwtype = arphdr[0] * 256 + arphdr[1];
        var protype = arphdr[2] * 256 + arphdr[3];
        var opcode = arphdr[6] * 256 + arphdr[7];
        if (hwtype !== ARP_ETHERNET || protype != ARP_IPV4) {
            return;
        }
    
        var arpipv4Sip = this.bufferToIp(arphdr.slice(14));
        var arpipv4Dip = this.bufferToIp(arphdr.slice(24));
        if (opcode === ARP_REQUEST) {
            this.emit('arp', {
                saddr: arpipv4Sip,
                daddr: arpipv4Dip,
                replyArp: () => {
                    opcode = ARP_REPLY;
                    arphdr[6] = opcode / 256 | 0;
                    arphdr[7] = opcode % 256;
                    data[0 + 0] = data[6 + 0];
                    data[0 + 1] = data[6 + 1];
                    data[0 + 2] = data[6 + 2];
                    data[0 + 3] = data[6 + 3];
                    data[0 + 4] = data[6 + 4];
                    data[0 + 5] = data[6 + 5];
                    for (var i = 0; i < 10; i++) {
                        var b = arphdr[8 + i];
                        arphdr[8 + i] = i < 6 ? arphdr[8 + i] : arphdr[18 + i];
                        arphdr[18 + i] = b;
                    }
                    this.tuntap.write(data);
                }
            });
        }
    }

    /**
     * processIpPacket -> handles packets of type IP (tcp, udp, etc)
     * @param {Buffer} data 
     */
    processIpPacket(data) {
        var iphdr = data.slice(14);
        switch (iphdr[0] >> 4) {
            case IP_PACKET_IPV4:
                var saddr = this.bufferToIp(iphdr.slice(12));
                var daddr = this.bufferToIp(iphdr.slice(16));
            
                this.emit('packet', data, saddr, daddr);
                break;
            case IP_PACKET_IPV6:
            default:
                return; // Not supported
        }
    }

    /**
     * bufferToMac -> converts binary representing a mac address into human readable string
     * @param {Buffer} buf
     * @returns {String}
     */
    bufferToMac(buf) {
        return Array.prototype.map.call(buf.slice(0, 6), (x) => Buffer.from([x]).toString('hex')).join(':')
    }

    /**
     * bufferToIp -> converts binary representing an IP address into human readable string
     * @param {Buffer} buf
     * @returns {String}
     */
    bufferToIp(buf) {
        return Array.prototype.map.call(buf.slice(0, 4), (x) => x).join('.')
    }
}

module.exports = {
    AdapterInterface,
    ETH_P_ARP,
    ETH_P_IP,
    ARP_ETHERNET,
    ARP_IPV4,
    ARP_REQUEST,
    ARP_REPLY,
    IP_TCP
};

