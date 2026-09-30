import { chunk } from "../src/index.js";

const text = `Beam is a peer-to-peer file transfer tool for your local network.
It finds peers automatically and asks before sending anything.

Beam moves data over BTP, a custom reliable protocol built on UDP.
BTP handles packet loss, reordering and corruption on its own.

Every transfer ends with a SHA-256 verification on both sides.`;

for (const c of chunk(text, { maxSize: 80, overlap: 20 })) {
  console.log(`chunk ${c.index} [${c.start}-${c.end}]`);
  console.log(c.text);
  console.log();
}
