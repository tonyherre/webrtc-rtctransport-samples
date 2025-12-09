// DOM Elements
const candidateInput = document.getElementById("candidate");
const candidateButton = document.getElementById("candidateButton");
const copyParamsButton = document.getElementById("copyParameters");
const framerateEl = document.getElementById("framerates");
const wireProtocolEl = document.getElementById("wireprotocol");

// Transport
let transport;
let controllingTransport, controlledTransport;

const tiebreaker = Math.random();

let candidates = {
  controlling: [],
  controlled: [],
};

// Video processing
let decoder;
let mediaTrack;
let streamVersion = 0;
const reassemblyBuffer = new Map();
const bufferPoolSize = 50;
let bufferPool = byob_support ? [...Array(bufferPoolSize)].map(() => {
  return new ArrayBuffer(CONFIG.maxPacketSize);
}) : [];
let pendingPackets = [];
let renderedFrames = 0;
let sentFrameCounter = 0;
let droppedFrames = 0;
let startTime;
let assembledFrameCounter = 0;

/**
 * Initializes the RtcTransport instance.
 */
function initializeTransport() {
  const params = new URLSearchParams(document.location.search);
  controlledTransport = createTransport("myTransport1", false);
  controllingTransport = createTransport("myTransport1", true);

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
  const turnUrlInput = document.getElementById("turn-url");
  const turnUsernameInput = document.getElementById("turn-username");
  const turnPasswordInput = document.getElementById("turn-password");
  const addTurnButton = document.getElementById("add-turn-button");

  addTurnButton.onclick = () => {
    const url = turnUrlInput.value;
    const username = turnUsernameInput.value;
    const credential = turnPasswordInput.value;

    if (url) {
      const iceServer = {
        urls: url,
      };
      if (username && credential) {
        iceServer.username = username;
        iceServer.credential = credential;
      }
      CONFIG.iceServers.push(iceServer);
      updateStatus(`Added TURN server: ${url}`);
      turnUrlInput.value = "";
      turnUsernameInput.value = "";
      turnPasswordInput.value = "";
    }
    initializeTransport();
  };

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

      waitForFirstWritable(transport, "transport", () => {
        candidateButton.disabled = true;
        candidateInput.disabled = true;
        copyParamsButton.disabled = true;
        setupMedia();
      });
      pollReceivedPackets(transport, (packets) => {
        packets.forEach(packet => {
          let buffer;
          if(byob_support) {
            let buffer = bufferPool.pop();
            if (!buffer) console.log("Buffer pool empty?");
            packet.copyPayloadTo(buffer);
            pendingPackets.push(new Uint8Array(buffer, 0, packet.payloadByteLength));
          } else {
            buffer = packet.data;
            pendingPackets.push(buffer);
          }
        });
        decodeAvailableFrames(pendingPackets, reassemblyBuffer, decoder, streamVersion);
      });

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
    const encoder = createEncoder(transport, streamVersion);
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
  if (!window['RtcTransport']) {
    updateError("RtcTransport not supported on this browser. Be sure to run a recent Chromium Canary with --enable-blink-features=RTCRtpTransport.");
    return;
  }

  initializeTransport();
  setupUI();

  const canvas = document.getElementById("canvas");
  canvas.width = CONFIG.video.width;
  canvas.height = CONFIG.video.height;
  decoder = createDecoder(canvas);
}

main();