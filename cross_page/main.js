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

// TextEncoder/Decoder
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// Transport
let transport;

/**
 * Updates the status element with a new message.
 * @param {string} message - The message to display.
 */
function updateStatus(message) {
  statusEl.innerText += message + "\n";
}

/**
 * Displays a new ICE candidate in the UI.
 * @param {RTCIceCandidate} candidate - The ICE candidate.
 */
function displayCandidate(candidate) {
  const candidateString = JSON.stringify(candidate);
  const newEl = document.createElement("p");
  newEl.innerText = candidateString;
  newEl.onclick = () => {
    navigator.clipboard.writeText(candidateString).then(() => {
      updateStatus("Candidate copied to clipboard.");
    }, () => {
      updateStatus("Failed to copy candidate to clipboard.");
    });
  };
  candidateList.appendChild(newEl);
}

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
  const isControlling = params.get("iceControlling") === 'true';

  transport = new RtcTransport({
    name: "myTransport1",
    iceServers: CONFIG.iceServers,
    iceControlling: isControlling,
  });

  transport.onicecandidate = (event) => {
    if (event.candidate) {
      displayCandidate(event.candidate);
    }
  };

  pollWritable(transport, "transport", sendButton);
  pollReceivedPackets(transport, "transport");
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

  candidateButton.onclick = () => {
    try {
      const candidate = JSON.parse(candidateInput.value);
      transport.addRemoteCandidate(candidate);
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
