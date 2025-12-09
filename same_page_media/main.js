// DOM Elements
const framerateEl = document.getElementById("framerates");
const canvas = document.getElementById("canvas");
const resolutionSelect = document.getElementById("resolution");

// Transports
let transport1, transport2;

// Video processing
let decoder;
let mediaTrack;
let streamVersion = 0;
const reassemblyBuffer = {};
const bufferPoolSize = 50;
let bufferPool = byob_support ? [...Array(bufferPoolSize)].map(() => {
  return new ArrayBuffer(CONFIG.maxPacketSize);
}) : [];
let pendingPackets = [];
let renderedFrames = 0;
let frameCounter = 0;
let droppedFrames = 0;
let startTime;

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

  waitForFirstWritable(transport1, "transport1", () => setupMedia());
  waitForFirstWritable(transport2, "transport2");

  pollReceivedPackets(transport1, (packets) => {
    packets.forEach(packet => {
      if (byob_support) {
        let buffer = bufferPool.pop();
        if (!buffer) console.log("Buffer pool empty?");
        packet.copyPayloadTo(buffer);
        pendingPackets.push(new Uint8Array(buffer, 0, packet.payloadByteLength));
      } else {
        pendingPackets.push(packet.data);
      }
    });
    decodeAvailableFrames(pendingPackets, reassemblyBuffer, decoder, streamVersion);
  });
  pollReceivedPackets(transport2, (packets) => {
    packets.forEach(packet => {
      if (byob_support) {
        let buffer = bufferPool.pop();
        if (!buffer) console.log("Buffer pool empty?");
        packet.copyPayloadTo(buffer);
        pendingPackets.push(new Uint8Array(buffer, 0, packet.payloadByteLength));
      } else {
        pendingPackets.push(packet.data);
      }
    });
    decodeAvailableFrames(pendingPackets, reassemblyBuffer, decoder, streamVersion);
  });
}

/**
 * Sets up the media stream and processing pipeline.
 */
async function setupMedia() {
  try {
    if (mediaTrack) {
      mediaTrack.stop();
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: {exact: CONFIG.video.width}, height: CONFIG.video.height },
    });

    mediaTrack = stream.getTracks()[0];
    const processor = new MediaStreamTrackProcessor(mediaTrack);
    const encoder = createEncoder(transport1, streamVersion);
    startTime = performance.now();

    let isFirstFrame = true;
    for await (const frame of processor.readable) {
      if (encoder.encodeQueueSize > 2) {
        frame.close();
        droppedFrames++;
      } else {
        frameCounter++;
        const keyFrame = isFirstFrame || (frameCounter % 150 === 0);
        isFirstFrame = false;
        encoder.encode(frame, { keyFrame });
        frame.close();
      }
      if (frameCounter %50 == 0)
        updateFramerate();
    }
  } catch (error) {
    console.error("Error setting up media:", error);
    updateStatus("Error setting up media. Check console for details.");
  }
}

/**
 * Updates the framerate display.
 */
function updateFramerate() {
  const elapsedTime = (performance.now() - startTime) / 1000;
  const framerate = Math.round(frameCounter / elapsedTime);
  const renderFramerate = Math.round(renderedFrames / elapsedTime);
  framerateEl.innerText = `Frames: ${frameCounter} Dropped: ${droppedFrames}, Framerate: ${framerate}, Render Framerate: ${renderFramerate}`;
}

/**
 * Initializes the application.
 */
function main() {
  if (!window['RtcTransport']) {
    updateError("RtcTransport not supported on this browser. Be sure to run a recent Chromium Canary with --enable-blink-features=RTCRtpTransport.");
    return;
  }

  updateStatus(byob_support ? "Using BYOB" : "BYOB Not supported");

  const canvas = document.getElementById("canvas");
  canvas.width = CONFIG.video.width;
  canvas.height = CONFIG.video.height;
  decoder = createDecoder(canvas);
  initializeTransports();
  resolutionSelect.onchange = () => {
    const [width, height] = resolutionSelect.value.split('x');
    CONFIG.video.width = parseInt(width, 10);
    CONFIG.video.height = parseInt(height, 10);
    streamVersion++;

    // Re-configure canvas and decoder for new resolution
    canvas.width = CONFIG.video.width;
    canvas.height = CONFIG.video.height;
    if (decoder) {
      decoder.close();
    }
    decoder = createDecoder(canvas);

    // Reset counters
    frameCounter = 0;
    renderedFrames = 0;
    droppedFrames = 0;
    pendingPackets = [];
    for (const key in reassemblyBuffer) {
      delete reassemblyBuffer[key];
    }

    // Restart media with new resolution
    // Note: This will request camera access again.
    setupMedia();
  };
}

main();