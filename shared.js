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

const byob_support = typeof RtcReceivedPacket !== 'undefined' && RtcReceivedPacket && 'copyPayloadTo' in RtcReceivedPacket.prototype;
const writable_change_event_support = 'onwritablechange' in RtcTransport.prototype;

// DOM Elements
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");

/**
 * Updates the status element with a new message.
 * @param {string} message - The message to display.
 */
function updateStatus(message) {
  statusEl.innerText += message + "\n";
}

/**
 * Updates the error element with a new message.
 * @param {string} message - The message to display.
 */
function updateError(message) {
  errorEl.innerText += message + "\n";
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
 * Invokes callback once the transport first becomes writable.
 * @param {RtcTransport} transport - The transport to poll.
 * @param {string} transportName - The name of the transport.
 * @param callback - The callback to invoke.
 */
async function waitForFirstWritable(transport, transportName, callback) {
  if (writable_change_event_support) {
    await new Promise((resolve) => {
      transport.onwritablechange = async () => {
        if (await transport.writable()) {
          resolve();
        }
      }
    });
    transport.onwritablechange = null;
  } else {
    // No event support, we'll have to poll.
    updateStatus(`No onwritablechange event, polling RtcTransport.writable().`);
    while (!await transport.writable()) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  updateStatus(`${transportName} is now writable`);
  if (callback) {
    callback();
  }
}

/**
 * Polls a transport for received packets.
 * @param {RtcTransport} transport - The transport to poll.
 */
async function pollReceivedPackets(transport, callback) {
  while (true) {
    const packets = transport.getReceivedPackets();
    if (packets.length > 0) {
      callback(packets);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
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
    wireProtocol: protocol || 'dtls-srtp',
  });
}

/**
 * Handles an encoded video chunk.
 * @param {EncodedVideoChunk} chunk - The encoded video chunk.
 */
function handleEncodedChunk(transport, chunk, version, frameId) {
  const chunkData = new Uint8Array(chunk.byteLength);
  chunk.copyTo(chunkData);

  const packets = [];
  const maxPayloadSize = CONFIG.maxPacketSize - 10; // 10 bytes for header
  const numPackets = Math.ceil(chunkData.byteLength / maxPayloadSize);

  for (let i = 0, packetSeq = 0; i < chunkData.byteLength; i += maxPayloadSize, packetSeq++) {
    const end = Math.min(i + maxPayloadSize, chunkData.byteLength);
    const packet_length = end - i + 10;
    let packet_buffer;
    if (byob_support) {
      packet_buffer = bufferPool.pop();
      if (!packet_buffer) console.error("Buffer pool empty");
    } else {
      packet_buffer = new ArrayBuffer(packet_length);
    }
    const packetView = new DataView(packet_buffer, 0, packet_length);
    packetView.setUint8(0, version);
    packetView.setUint8(1, chunk.type === "key" ? 1 : 0);
    packetView.setUint16(2, frameId, false); // big-endian
    packetView.setUint8(4, packetSeq);
    packetView.setUint8(5, numPackets);
    packetView.setUint32(6, chunk.timestamp);
    new Uint8Array(packet_buffer, 10).set(chunkData.slice(i, end));
    packets.push({ data: byob_support ? packetView : packet_buffer});
  }

  transport.sendPackets(packets);
  if (byob_support) {
    packets.forEach(packet => {
      bufferPool.push(packet.data.buffer);
    });
  }
}

/**
 * Creates a new VideoEncoder.
 * @returns {VideoEncoder} The configured VideoEncoder.
 */
function createEncoder(transport, version) {
  let frameId = 0;
  const encoder = new VideoEncoder({
    output: (chunk) => handleEncodedChunk(transport, chunk, version, frameId++),
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
function handleDecodedFrame(canvas, frame) {
  const ctx = canvas.getContext("2d");
  ctx.drawImage(frame, 0, 0);
  frame.close();
}

/**
 * Creates a new VideoDecoder.
 * @returns {VideoDecoder} The configured VideoDecoder.
 */
function createDecoder(canvas) {
  const decoder = new VideoDecoder({
    output: (frame) => handleDecodedFrame(canvas, frame),
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
function decodeAvailableFrames(pendingPackets, reassemblyBuffer, decoder, streamVersion) {
  while (pendingPackets.length > 0) {
    const packet = pendingPackets.shift();
    const packetView = new DataView(byob_support ? packet.buffer : packet);
    const version = packetView.getUint8(0);

    if (version !== streamVersion) {
      // Old packet from a previous stream, discard
      continue;
    }

    const isKeyFrame = packetView.getUint8(1) === 1;
    const frameId = packetView.getUint16(2, false);
    const packetSeq = packetView.getUint8(4);
    const numPackets = packetView.getUint8(5);
    const timestamp = packetView.getUint32(6, false);
    const data = new Uint8Array(byob_support ? packet.buffer : packet, 10, packet.byteLength - 10);

    if (!reassemblyBuffer[frameId]) {
      reassemblyBuffer[frameId] = {
        packets: new Array(numPackets),
        numPackets: numPackets,
        isKeyFrame: isKeyFrame,
        receivedCount: 0,
        timestamp,
      };
    }

    if (!reassemblyBuffer[frameId].packets[packetSeq]) {
      reassemblyBuffer[frameId].receivedCount++;
    }
    reassemblyBuffer[frameId].packets[packetSeq] = data;

    if (reassemblyBuffer[frameId].receivedCount === numPackets) {
      // We have a full frame, let's assemble and decode
      const framePackets = reassemblyBuffer[frameId].packets;
      const totalSize = framePackets.reduce((acc, p) => acc + p.byteLength, 0);
      const encodedFrame = new Uint8Array(totalSize);
      let offset = 0;
      for (const p of framePackets) {
        encodedFrame.set(p, offset);
        offset += p.length;
      }

      const chunk = new EncodedVideoChunk({
        timestamp: reassemblyBuffer[frameId].timestamp,
        type: reassemblyBuffer[frameId].isKeyFrame ? "key" : "delta",
        data: encodedFrame,
      });
      decoder.decode(chunk);

      if (byob_support) {
        reassemblyBuffer[frameId].packets.forEach((p) => {
          bufferPool.push(p.buffer);
        });
      }
      delete reassemblyBuffer[frameId];
    }
  }
}
