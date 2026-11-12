import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import net from 'node:net';
import {parseProcTcp,processSocketsLinux} from '../linux-sockets.mjs';
test('Linux TCP parser includes only socket inodes owned by the process',()=>{const text='header\n 0: 5B03A8C0:4723 2258BD2D:1F90 01 0:0 00:0 0 1000 0 333\n 1: 5B03A8C0:4724 01010101:01BB 01 0:0 00:0 0 1000 0 444';assert.deepEqual(parseProcTcp(text,new Set(['333'])),[{LocalAddress:'192.168.3.91',LocalPort:18211,RemoteAddress:'45.189.88.34',RemotePort:8080}]);});
test('IPv4 mapped IPv6 socket addresses retain a comparable address',()=>{const text='header\n 0: 0000000000000000FFFF00005B03A8C0:4723 0000000000000000FFFF00002258BD2D:1F90 01 0:0 00:0 0 1000 0 333';assert.equal(parseProcTcp(text,new Set(['333']),true)[0].LocalAddress,'::ffff:192.168.3.91');});
test('live Linux inspection observes the actual local port of a TCP connection',{skip:process.platform!=='linux'},async()=>{const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const socket=net.connect(server.address().port,'127.0.0.1');await new Promise(resolve=>socket.once('connect',resolve));try{const rows=await processSocketsLinux(process.pid);assert.ok(rows.some(r=>r.LocalPort===socket.localPort&&r.RemotePort===server.address().port&&r.RemoteAddress==='127.0.0.1'));}finally{socket.destroy();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}});
