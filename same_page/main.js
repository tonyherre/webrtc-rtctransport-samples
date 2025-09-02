let t1, t2;
let statusEl = document.getElementById("status");
let sendButton1 = document.getElementById("send1");
let sendButton2 = document.getElementById("send2");
let input1 = document.getElementById("input1");
let input2 = document.getElementById("input2");


let enc = new TextEncoder();
let dec = new TextDecoder();

function propagateCandidate(otherTransport, otherTransportName, event) {
  console.log(`Candidate ${event.candidate.candidate}, username ${event.candidate.usernameFragment}`);
  let candidate = event.candidate.candidate;
  let candidateParts = candidate.split(" ");
  let address = candidate.slice(0, candidateParts[0].lastIndexOf(':'));
  let port = parseInt(candidate.slice(candidateParts[0].lastIndexOf(':')+1));
  let type = candidateParts[1];
  let foundation = candidateParts[2];
  let relatedAddress = candidateParts[3] ? candidateParts[3].slice(0, candidateParts[3].lastIndexOf(':')) : "127.0.0.1";
  let relatedAddressPort = candidateParts[3] ? parseInt(candidateParts[3].slice(candidateParts[3].lastIndexOf(':')+1)) : "0";
  let networkId = candidateParts[4];
  let usernamePassword = event.candidate.usernameFragment.split(" ");
  let candidateDict = {address, port, usernameFragment: usernamePassword[0], password: usernamePassword[1], type, foundation, relatedAddress, relatedAddressPort, networkId};

  console.log(`Adding remote candidate`, candidateDict);
  otherTransport.addRemoteCandidate(candidateDict);
    statusEl.innerText += `propagated candidate ${event.candidate.candidate} to ${otherTransportName}\n`;
}

async function pollWritable(transport, name, sendButton) {
  if (await transport.writable()) {
    statusEl.innerText += name + " is now writable\n";
    sendButton.disabled = false;
  } else {
    setTimeout(() => pollWritable(transport, name, sendButton), 100);
  }
}

async function pollReceivedPackets(transport, name) {
  let packets = transport.getReceivedPackets();
  if (packets.length > 0) {
    statusEl.innerText += name + " received a packet. Value: " + dec.decode(packets[0].data) + "\n";
  }
  setTimeout(() => pollReceivedPackets(transport, name), 100);
}

t1 = new RtcTransport({name:"myTransport1", iceServers: [{urls: "stun:stun.l.google.com:19302"}], iceControlling: true});
t2 = new RtcTransport({name:"myTransport2", iceServers: [{urls: "stun:stun.l.google.com:19302"}], iceControlling: false});

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