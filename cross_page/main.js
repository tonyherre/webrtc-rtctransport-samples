// Configuration
const CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
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
  sendButton.disabled = false;
  candidateButton.disabled = true;
  candidateInput.disabled = true;
  copyParamsButton.disabled = true;
}

/**
 * Polls the transport for received packets.
 * @param {RtcTransport} transport - The transport to poll.
 * @param {string} transportName - The name of the transport.
 */
async function pollReceivedPackets(transport, transportName) {
  while (true) {
    const packets = transport.getReceivedPackets();
    if (packets.length > 0) {
      const message = textDecoder.decode(packets[0].data);
      updateStatus(`${transportName} received a packet: ${message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
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
    wireProtocol: 'dtls-srtp',
  });
  controllingTransport = new RtcTransport({
    name: "myTransport1",
    iceServers: CONFIG.iceServers,
    iceControlling: true,
    wireProtocol: 'dtls-srtp',
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
  sendButton.onclick = () => {
    transport.sendPackets([{ data: textEncoder.encode(input.value).buffer }]);
    input.value = "";
  };
  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      sendButton.click();
      e.preventDefault();
    }
  });

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
 * Initializes the application.
 */
function main() {
  initializeTransport();
  setupUI();
}

main();
