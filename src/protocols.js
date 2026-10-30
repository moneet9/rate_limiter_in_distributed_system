const path = require('node:path');
const net = require('node:net');
const dgram = require('node:dgram');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const definition = protoLoader.loadSync(path.join(__dirname, '..', 'proto', 'rate_limiter.proto'), {
  keepCase: false, longs: Number, enums: String, defaults: true, oneofs: true
});
const { ratelimit } = grpc.loadPackageDefinition(definition);

function listenTcp(port, processRequest) {
  const server = net.createServer((socket) => {
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', async (chunk) => {
      data += chunk;
      if (data.length > 65536) { socket.end(JSON.stringify({ error: 'Request too large' }) + '\n'); return; }
      const newline = data.indexOf('\n');
      if (newline < 0) return;
      socket.pause();
      try {
        const result = await processRequest({ ...JSON.parse(data.slice(0, newline)), protocol: 'tcp' });
        socket.end(JSON.stringify(result) + '\n');
      } catch (error) { socket.end(JSON.stringify({ error: error.message }) + '\n'); }
    });
  });
  return new Promise((resolve, reject) => server.once('error', reject).listen(port, '0.0.0.0', () => resolve(server)));
}

function listenUdp(port, processRequest) {
  const server = dgram.createSocket('udp4');
  server.on('message', async (message, remote) => {
    try {
      const input = JSON.parse(message.toString('utf8'));
      const result = await processRequest({ ...input, protocol: 'udp' });
      server.send(Buffer.from(JSON.stringify(result)), remote.port, remote.address);
    } catch (error) { server.send(Buffer.from(JSON.stringify({ error: error.message })), remote.port, remote.address); }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.bind(port, '0.0.0.0', () => resolve(server));
  });
}

function grpcDecision(item) {
  return {
    requestId: item.id, protocol: item.protocol, identity: item.identity,
    targetInstance: item.targetInstance, endpoint: item.endpoint, method: item.method,
    algorithm: item.algorithm, allowed: item.allowed, decision: item.decision,
    status: item.status, latency: item.latency, remaining: item.remaining,
    retryAfter: item.retryAfter, delayedMs: item.delayedMs || 0, reason: item.reason
  };
}

async function startProtocolServers({ processRequest, tcpPort, udpPort, grpcPort }) {
  const grpcServer = new grpc.Server();
  grpcServer.addService(ratelimit.RateLimiter.service, {
    check: async (call, callback) => {
      try { callback(null, grpcDecision(await processRequest({ ...call.request, protocol: 'grpc' }))); }
      catch (error) { callback({ code: grpc.status.INTERNAL, message: error.message }); }
    }
  });
  const [tcpServer, udpServer] = await Promise.all([
    listenTcp(tcpPort, processRequest), listenUdp(udpPort, processRequest),
    new Promise((resolve, reject) => grpcServer.bindAsync(`0.0.0.0:${grpcPort}`, grpc.ServerCredentials.createInsecure(), (error) => error ? reject(error) : resolve()))
  ]);
  return {
    close() {
      tcpServer.close();
      udpServer.close();
      grpcServer.tryShutdown(() => {});
    }
  };
}

function tcpRequest(port, input) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let response = '';
    socket.setEncoding('utf8');
    socket.setTimeout(5000, () => socket.destroy(new Error('TCP request timed out')));
    socket.on('connect', () => socket.write(`${JSON.stringify(input)}\n`));
    socket.on('data', (chunk) => { response += chunk; if (response.includes('\n')) { socket.end(); try { const result = JSON.parse(response.slice(0, response.indexOf('\n'))); result.error ? reject(new Error(result.error)) : resolve(result); } catch (error) { reject(error); } } });
    socket.on('error', reject);
  });
}

function udpRequest(port, input) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timeout = setTimeout(() => { socket.close(); reject(new Error('UDP request timed out')); }, 5000);
    socket.once('message', (message) => {
      clearTimeout(timeout); socket.close();
      try { const result = JSON.parse(message.toString('utf8')); result.error ? reject(new Error(result.error)) : resolve(result); }
      catch (error) { reject(error); }
    });
    socket.once('error', (error) => { clearTimeout(timeout); socket.close(); reject(error); });
    socket.send(Buffer.from(JSON.stringify(input)), port, '127.0.0.1');
  });
}

function grpcRequest(port, input) {
  return new Promise((resolve, reject) => {
    const client = new ratelimit.RateLimiter(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
    client.check(input, (error, response) => {
      client.close();
      if (error) return reject(error);
      resolve({ ...response, id: response.requestId, retryAfter: response.retryAfter, delayedMs: response.delayedMs });
    });
  });
}

function requestOverProtocol(protocol, input, ports) {
  if (protocol === 'tcp') return tcpRequest(ports.tcp, input);
  if (protocol === 'udp') return udpRequest(ports.udp, input);
  if (protocol === 'grpc') return grpcRequest(ports.grpc, input);
  return Promise.reject(new Error('Unsupported protocol'));
}

module.exports = { startProtocolServers, requestOverProtocol };
