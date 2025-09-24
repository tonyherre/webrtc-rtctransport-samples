// Configuration
const CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  video: {
    width: 640,
    height: 480,
    bitrate: 2_000_000,
    framerate: 30,
  },
  codec: "vp8",
  maxPacketSize: 1200,
};

// DOM Elements
const statusEl = document.getElementById("status");
const framerateEl = document.getElementById("framerates");
const canvas = document.getElementById("canvas");
const resolutionSelect = document.getElementById("resolution");

// Transports
let transport1, transport2;

// Video processing
let decoder;
let mediaTrack;
let streamVersion = 0;
let pendingPackets = [];
let renderedFrames = 0;
let frameCounter = 0;
let droppedFrames = 0;
let startTime;

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
    setupMedia();
  }
}

/**
 * Polls a transport for received packets.
 * @param {RtcTransport} transport - The transport to poll.
 */
async function pollReceivedPackets(transport) {
  while (true) {
    const packets = transport.getReceivedPackets();
    if (packets.length > 0) {
      packets.forEach(packet => pendingPackets.push(packet.data));
      decodeAvailableFrames();
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

/**
 * Creates and configures an RtcTransport instance.
 * @param {string} name - The name of the transport.
 * @param {boolean} isControlling - Whether the transport is controlling.
 * @returns {RtcTransport} The configured RtcTransport instance.
 */
function createTransport(name, isControlling) {
  const protocol = new URLSearchParams(document.location.search).get("protocol");
  return new RtcTransport({
    name,
    iceServers: CONFIG.iceServers,
    iceControlling: isControlling,
    wireProtocol: protocol,
  });
}

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

  pollReceivedPackets(transport1);
  pollReceivedPackets(transport2);
}

/**
 * Handles an encoded video chunk.
 * @param {EncodedVideoChunk} chunk - The encoded video chunk.
 */
function handleEncodedChunk(chunk, version) {
  const chunkData = new Uint8Array(chunk.byteLength);
  chunk.copyTo(chunkData);

  const packets = [];
  for (let i = 0; i < chunkData.byteLength; i += CONFIG.maxPacketSize) {
    const end = Math.min(i + CONFIG.maxPacketSize, chunkData.byteLength);
    const packet = new ArrayBuffer(end - i + 3);
    const packetView = new Uint8Array(packet);
    packetView[0] = end === chunkData.byteLength ? 1 : 0;
    packetView[1] = chunk.type === "key" ? 1 : 0;
    packetView[2] = version;
    packetView.set(chunkData.slice(i, end), 3);
    packets.push({ data: packet });
  }

  transport1.sendPackets(packets);
}

/**
 * Creates a new VideoEncoder.
 * @returns {VideoEncoder} The configured VideoEncoder.
 */
function createEncoder(version) {
  const encoder = new VideoEncoder({
    output: (chunk) => handleEncodedChunk(chunk, version),
    error: (e) => console.error(e.message),
  });
  encoder.configure({
    codec: CONFIG.codec,
    width: CONFIG.video.width,
    height: CONFIG.video.height,
    bitrate: CONFIG.video.bitrate,
    framerate: CONFIG.video.framerate,
  });
  return encoder;
}

/**
 * Handles a decoded video frame.
 * @param {VideoFrame} frame - The decoded video frame.
 */
function handleDecodedFrame(frame) {
  renderedFrames++;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(frame, 0, 0);
  frame.close();
}

/**
 * Creates a new VideoDecoder.
 * @returns {VideoDecoder} The configured VideoDecoder.
 */
function createDecoder() {
  const decoder = new VideoDecoder({
    output: handleDecodedFrame,
    error: (e) => console.error(e.message),
  });
  decoder.configure({
    codec: CONFIG.codec,
    codedWidth: CONFIG.video.width,
    codedHeight: CONFIG.video.height,
  });
  return decoder;
}

/**
 * Decodes available frames from the pending packets.
 */
function decodeAvailableFrames() {
  let framePackets = [];
  let encodedFrameSize = 0;
  let timestamp = 0;

  while (pendingPackets.length > 0) {
    const packet = new Uint8Array(pendingPackets.shift());
    framePackets.push(packet);
    encodedFrameSize += packet.byteLength - 3;

    if (packet[0] === 1) {
      const packetVersion = packet[2];
      if (packetVersion !== streamVersion) {
        // This frame is from an old stream, discard it
        framePackets = [];
        encodedFrameSize = 0;
        continue;
      }

      const encodedFrame = new Uint8Array(encodedFrameSize);
      let offset = 0;
      const isKeyFrame = packet[1] === 1;

      framePackets.forEach((p) => {
        encodedFrame.set(p.slice(3), offset);
        offset += p.length - 3;
      });

      const chunk = new EncodedVideoChunk({
        timestamp: timestamp++,
        type: isKeyFrame ? "key" : "delta",
        data: encodedFrame,
      });
      decoder.decode(chunk);

      framePackets = [];
      encodedFrameSize = 0;
    }
  }
  pendingPackets = framePackets;
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
      video: { width: CONFIG.video.width, height: CONFIG.video.height },
    });

    mediaTrack = stream.getTracks()[0];
    const processor = new MediaStreamTrackProcessor(mediaTrack);
    const encoder = createEncoder(streamVersion);
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
  canvas.width = CONFIG.video.width;
  canvas.height = CONFIG.video.height;
  decoder = createDecoder();
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
    decoder = createDecoder();

    // Reset counters
    frameCounter = 0;
    renderedFrames = 0;
    droppedFrames = 0;
    pendingPackets = [];

    // Restart media with new resolution
    // Note: This will request camera access again.
    setupMedia();
  };
}

main();
