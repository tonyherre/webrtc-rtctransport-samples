// Configuration
const CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// DOM Elements
const statusEl = document.getElementById("status");
const sendButton1 = document.getElementById("send1");
const sendButton2 = document.getElementById("send2");
const input1 = document.getElementById("input1");
const input2 = document.getElementById("input2");

// TextEncoder/Decoder
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// Transports
let transport1, transport2;

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
async function pollWritable(transport, transportName, sendButton) {
  while (!await transport.writable()) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  updateStatus(`${transportName} is now writable`);
  sendButton.disabled = false;
}

/**
 * Polls a transport for received packets.
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

  pollWritable(transport1, "transport1", sendButton1);
  pollWritable(transport2, "transport2", sendButton2);

  pollReceivedPackets(transport1, "transport1");
  pollReceivedPackets(transport2, "transport2");
}

/**
 * Sets up the event listeners for the send buttons and input fields.
 */
function setupUI() {
  sendButton1.onclick = () => {
    transport1.sendPackets([{ data: textEncoder.encode(input1.value).buffer }]);
    input1.value = "";
  };
  input1.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      sendButton1.click();
      e.preventDefault();
    }
  });

  sendButton2.onclick = () => {
    transport2.sendPackets([{ data: textEncoder.encode(input2.value).buffer }]);
    input2.value = "";
  };
  input2.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      sendButton2.click();
      e.preventDefault();
    }
  });
}

/**
 * Initializes the application.
 */
function main() {
  initializeTransports();
  setupUI();
}

main();
