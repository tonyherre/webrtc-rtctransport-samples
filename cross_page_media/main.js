// Configuration
const CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  video: {
    width: 1280,
    height: 720,
    bitrate: 2_000_000,
    framerate: 30,
  },
  codec: "vp8",
  maxPacketSize: 1200,
};

// DOM Elements
const statusEl = document.getElementById("status");
const sendButton = document.getElementById("send1");
const input = document.getElementById("input1");
const candidateInput = document.getElementById("candidate");
const candidateButton = document.getElementById("candidateButton");
const candidateList = document.getElementById("candidateList");
const parametersEl = document.getElementById("parameters");
const copyParamsButton = document.getElementById("copyParameters");
const framerateEl = document.getElementById("framerates");
const wireProtocolEl = document.getElementById("wireprotocol");

// TextEncoder/Decoder
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// Transport
let transport;
let controllingTransport, controlledTransport;

const tiebreaker = Math.random();

/**
 * Updates the status element with a new message.
 * @param {string} message - The message to display.
 */
function updateStatus(message) {
  statusEl.innerText += message + "\n";
}

let candidates = {
  controlling: [],
  controlled: [],
};

/**
 * Polls the transport until it becomes writable.
 * @param {RtcTransport} transport - The transport to poll.
 * @param {string} transportName - The name of the transport.
 * @param {HTMLButtonElement} sendButton - The send button associated with the transport.
 */
async function pollWritable(transport, transportName, sendButton) {
  while (!await transport.writable()) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  updateStatus(`${transportName} is now writable`);
  candidateButton.disabled = true;
  candidateInput.disabled = true;
  copyParamsButton.disabled = true;


  setupMedia();
}

// Video processing
let decoder;
let mediaTrack;
let streamVersion = 0;
let frameId = 0;
const reassemblyBuffer = new Map();
let pendingPackets = [];
let renderedFrames = 0;
let sentFrameCounter = 0;
let droppedFrames = 0;
let startTime;
let assembledFrameCounter = 0;

/**
 * Polls the transport for received packets.
 * @param {RtcTransport} transport - The transport to poll.
 * @param {string} transportName - The name of the transport.
 */
async function pollReceivedPackets(transport, transportName) {
  while (true) {
    const packets = transport.getReceivedPackets();
    if (packets.length > 0) {
      packets.forEach(packet => pendingPackets.push(packet.data));
      decodeAvailableFrames();
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/**
 * Initializes the RtcTransport instance.
 */
function initializeTransport() {
  const params = new URLSearchParams(document.location.search);
  controlledTransport = new RtcTransport({
    name: "myTransport1",
    iceServers: CONFIG.iceServers,
    iceControlling: false,
    wireProtocol: wireProtocolEl.value,
  });
  controllingTransport = new RtcTransport({
    name: "myTransport1",
    iceServers: CONFIG.iceServers,
    iceControlling: true,
    wireProtocol: wireProtocolEl.value,
  });

  controlledTransport.onicecandidate = (event) => {
    if (event.candidate) {
      candidates.controlled.push(event.candidate);
    }
  };

  controllingTransport.onicecandidate = (event) => {
    if (event.candidate) {
      candidates.controlling.push(event.candidate);
    }
  };

  const dtlsParameters = {
    controlling: {
      sslRole: "client",
      fingerprintDigestAlgorithm: controllingTransport.fingerprintDigestAlgorithm,
      fingerprint: Array.from(new Uint8Array(controllingTransport.fingerprint)),
    },
    controlled: {
      sslRole: "server",
      fingerprintDigestAlgorithm: controlledTransport.fingerprintDigestAlgorithm,
      fingerprint: Array.from(new Uint8Array(controlledTransport.fingerprint)),
    },
  };
  
  copyParamsButton.onclick = () => {
    const negotiationData = {
      dtls: dtlsParameters,
      candidates,
      tiebreaker,
    };
    navigator.clipboard.writeText(JSON.stringify(negotiationData));
    updateStatus("Negotiation data copied to clipboard.");
  };
}

/**
 * Sets up the event listeners for the UI elements.
 */
function setupUI() {
  candidateInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      candidateButton.click();
      e.preventDefault();
    }
  });

  candidateButton.onclick = () => {
    try {
      const remoteData = JSON.parse(candidateInput.value);
      let dtls, candidates;
      if (tiebreaker > remoteData.tiebreaker) {
        // We're controlling.
        transport = controllingTransport;
        dtls = remoteData.dtls.controlled;
        candidates = remoteData.candidates.controlled;
        updateStatus(`Acting as controller`);
      } else {
        // We're controlled.
        transport = controlledTransport;
        dtls = remoteData.dtls.controlling;
        candidates = remoteData.candidates.controlling;
        updateStatus(`Acting as controlled`);
      }

      pollWritable(transport, "transport", sendButton);
      pollReceivedPackets(transport, "transport");

      dtls.fingerprint = new Uint8Array(dtls.fingerprint).buffer;
      transport.setRemoteDtlsParameters(dtls);
      candidates.forEach(candidate => transport.addRemoteCandidate(candidate));
      updateStatus(`Added remote parameters`);
      candidateInput.value = "";
    } catch (error) {
      updateStatus("Error parsing candidate. Please check the format.");
      console.error("Error parsing candidate:", error);
    }
  };
}


/**
 * Handles an encoded video chunk.
 * @param {EncodedVideoChunk} chunk - The encoded video chunk.
 */
function handleEncodedChunk(chunk, version) {
  frameId++;
  const chunkData = new Uint8Array(chunk.byteLength);
  chunk.copyTo(chunkData);

  const packets = [];
  const maxPayloadSize = CONFIG.maxPacketSize - 6; // 6 bytes for header
  const numPackets = Math.ceil(chunkData.byteLength / maxPayloadSize);

  for (let i = 0, packetSeq = 0; i < chunkData.byteLength; i += maxPayloadSize, packetSeq++) {
    const end = Math.min(i + maxPayloadSize, chunkData.byteLength);
    const packet = new ArrayBuffer(end - i + 6);
    const packetView = new DataView(packet);
    packetView.setUint8(0, version);
    packetView.setUint8(1, chunk.type === "key" ? 1 : 0);
    packetView.setUint16(2, frameId, false); // big-endian
    packetView.setUint8(4, packetSeq);
    packetView.setUint8(5, numPackets);
    new Uint8Array(packet, 6).set(chunkData.slice(i, end));
    packets.push({ data: packet });
  }

  transport.sendPackets(packets);
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

let lastDecodedFrameId = -1;

/**
 * Decodes available frames from the pending packets.
 */
function decodeAvailableFrames() {
  while (pendingPackets.length > 0) {
    
    const packet = pendingPackets.shift();
    const packetView = new DataView(packet);
    const version = packetView.getUint8(0);


    const isKeyFrame = packetView.getUint8(1) === 1;
    const frameId = packetView.getUint16(2, false);
    const packetSeq = packetView.getUint8(4);
    const numPackets = packetView.getUint8(5);
    const data = new Uint8Array(packet, 6);

    if (!reassemblyBuffer.get(frameId)) {
      reassemblyBuffer.set(frameId, {
        packets: new Array(numPackets),
        numPackets: numPackets,
        isKeyFrame: isKeyFrame,
        receivedCount: 0,
      });
    }

    if (!reassemblyBuffer.get(frameId).packets[packetSeq]) {
      reassemblyBuffer.get(frameId).receivedCount++;
    }
    reassemblyBuffer.get(frameId).packets[packetSeq] = data;
    if (reassemblyBuffer.get(frameId).receivedCount == reassemblyBuffer.get(frameId).numPackets && reassemblyBuffer.get(frameId).isKeyFrame) {
      lastDecodedFrameId = frameId - 1;
      for (const [frameId, _] of reassemblyBuffer) {
        if (frameId <= lastDecodedFrameId) {
          reassemblyBuffer.delete(frameId);
        }
      }
    }
  }

  // Decode fully assembled frames in order.
  const sortedFrameIds = new Map([...reassemblyBuffer.entries()].sort());

  for (const [frameId, _] of sortedFrameIds) {
    if (frameId != lastDecodedFrameId+1 && !reassemblyBuffer.get(frameId).isKeyFrame) {
      break;
    }

    if (reassemblyBuffer.get(frameId).receivedCount === reassemblyBuffer.get(frameId).numPackets) {
      // We have a full frame, let's assemble and decode
      const framePackets = reassemblyBuffer.get(frameId).packets;
      const totalSize = framePackets.reduce((acc, p) => acc + p.byteLength, 0);
      const encodedFrame = new Uint8Array(totalSize);
      let offset = 0;
      for (const p of framePackets) {
        encodedFrame.set(p, offset);
        offset += p.length;
      }
      assembledFrameCounter++;
      const chunk = new EncodedVideoChunk({
        timestamp: frameId,
        type: reassemblyBuffer.get(frameId).isKeyFrame ? "key" : "delta",
        data: encodedFrame,
      });
      decoder.decode(chunk);
      lastDecodedFrameId = frameId;

      reassemblyBuffer.delete(frameId);
    }
  }
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
        sentFrameCounter++;
        const keyFrame = isFirstFrame || (sentFrameCounter % 150 === 0);
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
  const framerate = Math.round(sentFrameCounter / elapsedTime);
  const renderFramerate = Math.round(renderedFrames / elapsedTime);
  framerateEl.innerText = `Frames sent: ${sentFrameCounter}, Frames assembled: ${assembledFrameCounter} Dropped: ${droppedFrames}, Framerate: ${framerate}, Render Framerate: ${renderFramerate}`;
}


/**
 * Initializes the application.
 */
function main() {
  initializeTransport();
  setupUI();

  canvas.width = CONFIG.video.width;
  canvas.height = CONFIG.video.height;
  decoder = createDecoder();
}

main();
