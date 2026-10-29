// Tests must explicitly mock provider I/O. A missing mock must fail closed,
// even on a developer machine that has working production credentials.
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

const blocked = () => { throw new Error('NETWORK_DISABLED_FOR_OFFLINE_TESTS'); };
globalThis.fetch = blocked;
globalThis.WebSocket = class { constructor() { blocked(); } };
for (const module of [http, https]) { module.request = blocked; module.get = blocked; }
http2.connect = blocked;
net.connect = blocked;
net.createConnection = blocked;
net.Socket.prototype.connect = blocked;
tls.connect = blocked;
syncBuiltinESMExports();
