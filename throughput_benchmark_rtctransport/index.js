function exchangeIceCandidates(pc1, pc2) {
  function doExchange(localPc, remotePc) {
    localPc.addEventListener('icecandidate', event => {
      const {candidate} = event;
      if (candidate && remotePc.signalingState !== 'closed') {
        remotePc.addIceCandidate(candidate);
      }
    });
  }
  doExchange(pc1, pc2);
  doExchange(pc2, pc1);
}

async function connect(pc1, pc2) {
  exchangeIceCandidates(pc1, pc2);
  exchangeIceCandidates(pc2, pc1);

  const offer = await pc1.createOffer();
  await pc1.setLocalDescription(offer);
  await pc2.setRemoteDescription(pc1.localDescription);
  await pc2.setLocalDescription();
  await pc1.setRemoteDescription(pc2.localDescription);
}
const statusEl = document.getElementById("status");

/**
 * Updates the status element with a new message.
 * @param {string} message - The message to display.
 */
function updateStatus(message) {
  statusEl.innerText += message + "\n";
}

/**
 * Sends an ICE candidate to the peer transport.
 * @param {RtcTransport} peerTransport - The peer transport.
 * @param {string} peerTransportName - The name of the peer transport.
 * @param {Event} event - The ICE candidate event.
 */
function sendCandidateToPeer(peerTransport, peerTransportName, event) {
  if (event.candidate) {
    console.log(`Sending candidate to ${peerTransportName}:`, event.candidate);
    peerTransport.addRemoteCandidate(event.candidate);
    updateStatus(`Sent candidate to ${peerTransportName}`);
  }
}
let transport1PromiseResolver;
let transport1Promise = new Promise((resolve) => {
  transport1PromiseResolver = resolve;
});
/**
 * Polls a transport until it becomes writable.
 * @param {RtcTransport} transport - The transport to poll.
 * @param {string} transportName - The name of the transport.
 * @param {HTMLButtonElement} sendButton - The send button associated with the transport.
 */
async function pollWritable(transport, transportName) {
  while (!await transport.writable()) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  updateStatus(`${transportName} is now writable`);
  if (transportName === "transport1") {
    transport1PromiseResolver();
  }
}

/**
 * Polls a transport for received packets.
 * @param {RtcTransport} transport - The transport to poll.
 */
async function pollReceivedPackets(transport, callback) {
  let buffer = new ArrayBuffer(2000);
  while (true) {
    const packets = transport.getReceivedPackets();
    if (packets.length > 0) {
      packets.forEach(packet => {
        callback(packet.data);
      });
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
// Configuration
const CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

/**
 * Creates and configures an RtcTransport instance.
 * @param {string} name - The name of the transport.
 * @param {boolean} isControlling - Whether the transport is controlling.
 * @returns {RtcTransport} The configured RtcTransport instance.
 */
function createTransport(name, isControlling) {
  let protocol = new URLSearchParams(document.location.search).get("protocol");
  if (!protocol) {
    protocol = "dtls";
  }
  return new RtcTransport({
    name,
    iceServers: CONFIG.iceServers,
    iceControlling: isControlling,
    wireProtocol: protocol,
  });
}

// Transports
let transport1, transport2;
/**
 * Initializes the two RtcTransport instances and sets up their communication.
 */
function initializeTransports() {
  transport1 = createTransport("myTransport1", true);
  transport2 = createTransport("myTransport2", false);

  transport1.onicecandidate = (event) => sendCandidateToPeer(transport2, "transport2", event);
  transport2.onicecandidate = (event) => sendCandidateToPeer(transport1, "transport1", event);

  transport2.setRemoteDtlsParameters({
    sslRole: "server",
    fingerprintDigestAlgorithm: transport1.fingerprintDigestAlgorithm,
    fingerprint: transport1.fingerprint,
  });
  transport1.setRemoteDtlsParameters({
    sslRole: "client",
    fingerprintDigestAlgorithm: transport2.fingerprintDigestAlgorithm,
    fingerprint: transport2.fingerprint,
  });

  pollWritable(transport1, "transport1");
  pollWritable(transport2, "transport2");
}

function readConfig() {
  return {
    totalToTransferBytes: +document.getElementById('totalToTransferMB').value * 1_000_000,
    packetSizeBytes: +document.getElementById('packetSizeBytes').value,
    targetSpeedMBps: +document.getElementById('targetSpeedMBps').value,
    sendInterval: +document.getElementById('sendInterval').value,
  };
}

async function benchmark() {
  const progressBar = document.getElementById('progress');
  const speedElem = document.getElementById('speed');
  const startBtn = document.getElementById('start');
  startBtn.toggleAttribute('disabled');
  let handle = null;
  const toClose = [];

  try {
    progressBar.style = 'width: 0%';
    progressBar.innerText = '0%';
    speedElem.innerText = '0.0';

    await new Promise(res => setTimeout(res, 500));

    const config = readConfig();

    const {totalToTransferBytes, targetSpeedMBps} = config;
    const totalPacketCount = Math.ceil(totalToTransferBytes / (config.packetSizeBytes));
    const targetPacketsPerSecond = targetSpeedMBps * 1_000_000 / config.packetSizeBytes;
    const packetsToSendPerBatch = targetPacketsPerSecond / 1000 * config.sendInterval;
    
    const packets = [];
    for (let i = 0; i < packetsToSendPerBatch; i++) {
      const buffer = new ArrayBuffer(config.packetSizeBytes);
      new Uint32Array(buffer)[0] = i;
      packets.push({data: buffer});
    }

    const firstPayload = new Uint32Array(packets[0].data);
    firstPayload[0] = 0;
    let completed = 0;

    initializeTransports();

    let totalSentPackets = 0;
    transport1Promise.then(async () => {
      startTimestamp = performance.now();
      for (let i = 0; i < totalPacketCount; i += packetsToSendPerBatch) {
        await new Promise(resolve => setTimeout(resolve, config.sendInterval));
        transport1.sendPackets(packets);
        firstPayload[0]++;
        totalSentPackets+= packets.length;
      }
    });

    let startTimestamp;
    let receivedPackets = 0;

    let lastPercentageCompleted = 0;

    let resolve;
    const promise = new Promise(res => {
      resolve = res;
    });
    pollReceivedPackets(transport2, receivedBuff => {
      receivedPackets++;
      completed += receivedBuff.byteLength;

      const percentageCompleted = Math.floor(totalSentPackets / totalPacketCount * 100);
      if (percentageCompleted > lastPercentageCompleted) {
        const duration = (performance.now() - startTimestamp) / 1000;
        const speed = completed / 1_000_000 / duration * 8;
        progressBar.style = `width: ${percentageCompleted}%`;
        progressBar.innerText = `${percentageCompleted}%`;
        speedElem.innerText = speed.toFixed(1);
      }
      lastPercentageCompleted = percentageCompleted;

      if (receivedPackets === totalPacketCount) {
        const duration = (performance.now() - startTimestamp) / 1000;
        const speed = completed / 1_000_000 / duration * 8;
        console.log(
            `Transfer complete(${duration}s, ${totalToTransferBytes / 1_000_000} MB): ${speed} MB/s`);
        resolve({
          duration,
          speed,
          speedFormatted: `${speed} Mb/s`,
        });
      }
    });

    console.log('Starting benchmark with:', config);

    return await promise;
  } finally {
    if (handle) {
      clearInterval(handle);
    }

    await new Promise(r => setTimeout(r, 1000));
    startBtn.toggleAttribute('disabled');
  }
}