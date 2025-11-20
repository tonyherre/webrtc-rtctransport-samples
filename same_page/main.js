// DOM Elements
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

  waitForFirstWritable(transport1, "transport1", () => sendButton1.disabled = false);
  waitForFirstWritable(transport2, "transport2", () => sendButton2.disabled = false);

  pollReceivedPackets(transport1, (packets) => {
    const message = textDecoder.decode(packets[0].data);
    updateStatus(`transport1 received a packet: ${message}`);
  });
  pollReceivedPackets(transport2, (packets) => {
    const message = textDecoder.decode(packets[0].data);
    updateStatus(`transport2 received a packet: ${message}`);
  });
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
  if (!window['RtcTransport']) {
    updateError("RtcTransport not supported on this browser. Be sure to run a recent Chromium Canary with --enable-blink-features=RTCRtpTransport.");
    return;
  }
  initializeTransports();
  setupUI();
}

main();