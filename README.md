
A basic VPN over WebRTC client
==============================

## Before getting started
Try more stable alternatives like [n2n](https://github.com/ntop/n2n). This project is just for fun.

## Getting started
### Installation
Run `npm install` to get all dependencies

### Run with own server
1. Run `nodejs server -p $PORT` on server to accept tcp connections
2. Run `sudo nodejs client -h $HOST -p $PORT` on each client, so they can find each other.

### Run using [https://appr.tc](https://appr.tc) as a server
Run `sudo nodejs client -r $ROOM_NUMBER -rp $ROOM_PASSPHRASE` on each client (quite unstable solution with it's limitations by design)

## Testing
Run `npm test`

## Debugging
Run `npm run debug` and use Chrome DevTools to connect to this node. Follow [the code](./debugging) to see what can be inpected there.