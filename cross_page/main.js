let transport;
let statusEl = document.getElementById("status");
let sendButton = document.getElementById("send1");
let input = document.getElementById("input1");

let candidateInput = document.getElementById("candidate");
let candidateButton = document.getElementById("candidateButton");


let enc = new TextEncoder();
let dec = new TextDecoder();

function propagateCandidate(event) {
  console.log(`Candidate ${event.candidate.candidate}, username ${event.candidate.usernameFragment}`);
  let candidate = event.candidate.candidate;
  let candidateParts = candidate.split(" ");
  let address = candidate.slice(0, candidateParts[0].lastIndexOf(':'));
  let port = parseInt(candidate.slice(candidateParts[0].lastIndexOf(':')+1));
  let type = candidateParts[1];
  let usernamePassword = event.candidate.usernameFragment.split(" ");
  let candidateDict = {address, port, usernameFragment: usernamePassword[0], password: usernamePassword[1], type};
  console.log(`Progate remote candidate: `, candidateDict);
  statusEl.innerText += `Progate remote candidate ${JSON.stringify(candidateDict)}\n`;
}

async function pollWritable(transport, name, sendButton) {
  if (await transport.writable()) {
    statusEl.innerText += name + " is now writable\n";
    sendButton.disabled = false;
  } else {
    setTimeout(() => pollWritable(transport, name, sendButton), 100);
  }
}
/*
                         Cand[:189006332:1:udp:1685987071:104.135.186.62:16101:srflx:192.0.0.2:49447:HDbC8tFe4mMxjVsN:rWdfBXFYq3zVi766ABxs74Ij:1:10:0]
Adding remote candidate: Cand[::1:udp:0:104.135.186.62:33852:srflx::0:/pdYpz7qDLrl3uGF:BW894qZPkN+RWdKFKwIe+wx9:0:0:0]
*/
async function pollReceivedPackets(transport, name) {
  let packets = transport.getReceivedPackets();
  if (packets.length > 0) {
    statusEl.innerText += name + " received a packet. Value: " + dec.decode(packets[0].data) + "\n";
  }
  setTimeout(() => pollReceivedPackets(transport, name), 100);
}

let params = new URLSearchParams(document.location.search);

console.log("Ice controlling: ", params.get("iceControlling") || "true");
transport = new RtcTransport({name:"myTransport1", iceServers: [{urls: "stun:stun.l.google.com:19302"}], iceControlling: params.get("iceControlling") || true});

transport.onicecandidate = (event) => {
  propagateCandidate(event);
};

pollWritable(transport, "transport", sendButton);

sendButton.onclick = async () => {
  transport.sendPackets([{data: enc.encode(input.value).buffer}]);
};
input.addEventListener("keypress", e => { if (e.key === "Enter") {sendButton.click(); e.preventDefault();}});

candidateButton.onclick = async () => {
  let candidate = candidateInput.value;
  transport.addRemoteCandidate(JSON.parse(candidate));
}

pollReceivedPackets(transport, "transport");