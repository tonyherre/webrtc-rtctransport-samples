let t1, t2;
let statusEl = document.getElementById("status");
let sendButton1 = document.getElementById("send1");
let sendButton2 = document.getElementById("send2");
let input1 = document.getElementById("input1");
let input2 = document.getElementById("input2");


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