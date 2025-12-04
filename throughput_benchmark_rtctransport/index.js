let transport1PromiseResolver;
let transport1Promise = new Promise((resolve) => {
  transport1PromiseResolver = resolve;
});

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

  waitForFirstWritable(transport1, "transport1", () => transport1PromiseResolver());
  waitForFirstWritable(transport2, "transport2");
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
    pollReceivedPackets(transport2, (receivedPackets) => {
        receivedPackets.forEach(packet => {
            completed += packet.data.byteLength;
        });
        const percentageCompleted = Math.floor(totalSentPackets / totalPacketCount * 100);
        if (percentageCompleted > lastPercentageCompleted) {
            const duration = (performance.now() - startTimestamp) / 1000;
            const speed = completed / 1_000_000 / duration * 8;
            progressBar.style = `width: ${percentageCompleted}%`;
            progressBar.innerText = `${percentageCompleted}%`;
            speedElem.innerText = speed.toFixed(1);
        }
        lastPercentageCompleted = percentageCompleted;

        if (receivedPackets.length === totalPacketCount) {
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

if (!window['RtcTransport']) {
  updateError("RtcTransport not supported on this browser. Be sure to run a recent Chromium Canary with --enable-blink-features=RTCRtpTransport.");
}
