let t1, t2;
let statusEl = document.getElementById("status");
let sendButton1 = document.getElementById("send1");
let sendButton2 = document.getElementById("send2");
let input1 = document.getElementById("input1");
let input2 = document.getElementById("input2");

let framerateEl = document.getElementById("framerates");


let enc = new TextEncoder();
let dec = new TextDecoder();

function propagateCandidate(otherTransport, otherTransportName, event) {
  console.log(`Candidate ${event.candidate}, username ${event.candidate.ufrag}`);
  let candidate = event.candidate;
  let address = candidate.address
  let port = candidate.port
  let type = candidate.type;
  let foundation = "0";
  let relatedAddress = "";
  let relatedAddressPort = "";
  let networkId = "0";
  let candidateDict = {address, port, usernameFragment: candidate.usernameFragment, password: candidate.password, type, foundation, relatedAddress, relatedAddressPort, networkId};

  console.log(`Adding remote candidate`, candidateDict);
  otherTransport.addRemoteCandidate(candidateDict);
    statusEl.innerText += `propagated candidate ${JSON.stringify(event.candidate)} to ${otherTransportName}\n`;
}

async function pollWritable(transport, name, sendButton) {
  if (await transport.writable()) {
    statusEl.innerText += name + " is now writable\n";
    sendButton.disabled = false;
    if (name == "t1") setupMedia();
  } else {
    setTimeout(() => pollWritable(transport, name, sendButton), 100);
  }
}

let pendingPackets = [];

async function pollReceivedPackets(transport, name) {
  let packets = transport.getReceivedPackets();
  packets.forEach((packet) => {
    pendingPackets.push(packet.data);
  });
  if (packets.length > 0) {
    decodeAvailableFrames();
  }
  setTimeout(() => pollReceivedPackets(transport, name), 5);
}


let params = new URLSearchParams(document.location.search);
let protocol = params.get("protocol");
t1 = new RtcTransport({name:"myTransport1", iceServers: [{urls: "stun:stun.l.google.com:19302"}], iceControlling: true, wireProtocol: protocol, });
t2 = new RtcTransport({name:"myTransport2", iceServers: [{urls: "stun:stun.l.google.com:19302"}], iceControlling: false, wireProtocol: protocol, });

t2.setRemoteDtlsParameters({sslRole:"server", fingerprintDigestAlgorithm: t1.fingerprintDigestAlgorithm, fingerprint:t1.fingerprint});
t1.setRemoteDtlsParameters({sslRole:"client", fingerprintDigestAlgorithm: t2.fingerprintDigestAlgorithm, fingerprint:t2.fingerprint});

t1.onicecandidate = (event) => {
  propagateCandidate(t2, "t2", event);
};
t2.onicecandidate = (event) => {
  propagateCandidate(t1, "t1", event);
};

pollWritable(t1, "t1", sendButton1);
pollWritable(t2, "t2", sendButton2);

sendButton1.onclick = async () => {
  t1.sendPackets([{data: enc.encode(input1.value).buffer}]);
};
input1.addEventListener("keypress", e => { if (e.key === "Enter") {sendButton1.click(); e.preventDefault();}});

sendButton2.onclick = async () => {
  t2.sendPackets([{data: enc.encode(input2.value).buffer}]);
};
input2.addEventListener("keypress", e => { if (e.key === "Enter") {sendButton2.click();  e.preventDefault();}});


pollReceivedPackets(t1, "t1");
pollReceivedPackets(t2, "t2");


function handleEncodedChunk(chunk, metadata) {
  // actual bytes of encoded data
  const chunkData = new Uint8Array(chunk.byteLength);
  chunk.copyTo(chunkData);

  let packets = [];

  // Split chunk until individual 1200 byte array buffers
  const maxPacketSize = 1200; // A common MTU for WebRTC is 1200 bytes
  for (let i = 0; i < chunkData.byteLength; i += maxPacketSize) {
    const end = Math.min(i + maxPacketSize, chunkData.byteLength);
    let packet = new ArrayBuffer(end - i + 2);
    new Uint8Array(packet)[0] = end == chunkData.byteLength ? 1 : 0;
    new Uint8Array(packet)[1] = chunk.type == "key" ? 1 : 0;
    new Uint8Array(packet).set(chunkData.slice(i, end), 2);

    packets.push({ data: packet });
  }

  t1.sendPackets(packets);
}

function createEncoder() {
  const init = {
    output: handleEncodedChunk,
    error: (e) => {
      console.log(e.message);
    },
  };

  const config = {
    codec: "vp8",
    width: 1280,
    height: 960,
    bitrate: 4_000_000, // 1 Mbps
    framerate: 30,
  };

  const encoder = new VideoEncoder(init);
  encoder.configure(config);
  return encoder;
}

const canvas = document.getElementById("canvas");
canvas.width = 1280;
canvas.height = 960;
const ctx = canvas.getContext("2d");

let renderedFrames = 0;
function handleDecodedFrame(frame) {
  renderedFrames++;
  ctx.drawImage(frame, 0, 0);
  frame.close();
}

function createDecoder() {
  const init = {
    output: handleDecodedFrame,
    error: (e) => {
      console.log(e.message);
    },
  };

  const config = {
    codec: "vp8",
    codedWidth: 1280,
    codedHeight: 960,
  };

  const decoder = new VideoDecoder(init);
  decoder.configure(config);
  return decoder;
}

let decoder = createDecoder();

let timestamp = 0;
function decodeAvailableFrames() {
  let framePackets = [];
  let encodedFrameSize = 0;
  while (pendingPackets.length > 0) {
    let packet = new Uint8Array(pendingPackets.shift());
    framePackets.push(packet);
    encodedFrameSize += packet.byteLength;
    if (packet[0] == 1) {
      // Assembled a full frame.
      let encodedFrame = new Uint8Array(encodedFrameSize);
      let offset = 0;
      let isKeyFrame = packet[1] == 1;
      framePackets.forEach((packet) => {
        // Remove the header bits.
        packet = packet.slice(2);
        encodedFrame.set(packet, offset);
        offset += packet.length;
      });

      const chunk = new EncodedVideoChunk({
        timestamp: timestamp++,
        type: isKeyFrame ? "key" : "delta",
        data: encodedFrame,
      });
      decoder.decode(chunk);

      framePackets = [];
    }
  }
  pendingPackets = framePackets;
}


let frameCounter = 0;
let droppedFrames = 0;
let start = performance.now();
async function setupMedia() {
  let track = (await navigator.mediaDevices.getUserMedia({ video: {width: 1280, height: 960}})).getTracks()[0];
  let video = document.getElementById("video");
  video.srcObject = new MediaStream([track]);
  video.play();

  let processor = new MediaStreamTrackProcessor(track);
  let encoder = createEncoder()
  for await (const frame of processor.readable) {
    if (encoder.encodeQueueSize > 2) {
      // Too many frames in flight, encoder is overwhelmed
      // let's drop this frame.
      frame.close();
      droppedFrames++;
    } else {
      frameCounter++;
      const keyFrame = frameCounter % 150 == 0;
      encoder.encode(frame, { keyFrame });
      frame.close();
    }
    framerateEl.innerText = `Frames: ${frameCounter} Dropped: ${droppedFrames}, framerate: ${ Math.round(frameCounter / ((performance.now() - start) / 1000))}, render framerate: ${Math.round(renderedFrames / ((performance.now() - start) / 1000))}`;

  }
}