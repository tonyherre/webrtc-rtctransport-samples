// DOM Elements
const sendButton = document.getElementById("send1");
const input = document.getElementById("input1");
const candidateInput = document.getElementById("candidate");
const candidateButton = document.getElementById("candidateButton");
const copyParamsButton = document.getElementById("copyParameters");

// TextEncoder/Decoder
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// Transport
let transport;
let controllingTransport, controlledTransport;

const tiebreaker = Math.random();

let candidates = {
  controlling: [],
  controlled: [],
};

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

      pollWritable(transport, "transport", () => {
        sendButton.disabled = false;
        candidateButton.disabled = true;
        candidateInput.disabled = true;
        copyParamsButton.disabled = true;
      });
      pollReceivedPackets(transport, (packets) => {
        const message = textDecoder.decode(packets[0].data);
        updateStatus(`transport received a packet: ${message}`);
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
 * Initializes the application.
 */
function main() {
  if (!window['RtcTransport']) {
    updateError("RtcTransport not supported on this browser. Be sure to run a recent Chromium Canary with --enable-blink-features=RTCRtpTransport.");
    return;
  }
  initializeTransport();
  setupUI();
}

main();