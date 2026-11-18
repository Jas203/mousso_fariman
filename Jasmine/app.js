const $ = (selector) => document.querySelector(selector);

const TARGET_RATE = 16000;   // Whisper attend du 16 kHz mono
const MAX_SECONDS = 180;

let stream = null, context = null, node = null, sink = null;
let chunks = [], total = 0, recording = false;
let audioBlob = null, audioUrl = null;

// --- consentement ---
$('#consent').addEventListener('change', (e) => {
  $('#record-start').disabled = !e.target.checked;
  if (!e.target.checked) clearAudio();
});

// --- enregistrement ---
$('#record-start').addEventListener('click', async () => {
  clearAudio();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false }
    });
    context = new AudioContext();
    await context.audioWorklet.addModule('recorder-worklet.js');

    const source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, 'recorder-processor');
    sink = context.createGain();          // sortie muette : le worklet doit être relié à la sortie
    sink.gain.value = 0;

    chunks = []; total = 0; recording = true;
    node.port.onmessage = (event) => {
      if (!recording) return;
      chunks.push(event.data);
      total += event.data.length;
      if (total >= context.sampleRate * MAX_SECONDS) stopRecording();
    };

    source.connect(node);
    node.connect(sink);
    sink.connect(context.destination);

    $('#record-start').hidden = true;
    $('#record-stop').hidden = false;
    $('#record-stop').focus();
    $('#status').textContent = 'Enregistrement en cours…';
  } catch (error) {
    releaseAudio();
    $('#status').textContent = 'Micro refusé ou indisponible. Aucun audio enregistré.';
  }
});

$('#record-stop').addEventListener('click', stopRecording);

function stopRecording() {
  if (!recording) return;
  recording = false;

  // 1. assembler les morceaux
  const all = new Float32Array(total);
  let offset = 0;
  chunks.forEach((chunk) => { all.set(chunk, offset); offset += chunk.length; });
  const sourceRate = context.sampleRate;
  chunks = []; total = 0;
  releaseAudio();

  $('#record-start').hidden = false;
  $('#record-stop').hidden = true;
  if (!all.length) { $('#status').textContent = 'Aucun audio produit.'; return; }

  // 2. convertir en WAV 16 kHz mono et l'afficher dans le lecteur
  const pcm = resampleTo16k(all, sourceRate);
  audioBlob = new Blob([encodeWav(pcm)], { type: 'audio/wav' });
  audioUrl = URL.createObjectURL(audioBlob);
  $('#player').src = audioUrl;
  $('#player').hidden = false;
  $('#audio-delete').hidden = false;
  $('#status').textContent = 'Audio prêt · ' + Math.round(pcm.length / TARGET_RATE) + ' s · rien n’est envoyé.';
}

function releaseAudio() {
  if (node) { node.port.onmessage = null; node.disconnect(); node = null; }
  if (sink) { sink.disconnect(); sink = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }  // éteint le micro
  if (context) { context.close(); context = null; }
}

// --- conversion audio ---
// Moyenne sur des fenêtres : filtre simple qui évite le repliement (aliasing) quand on passe de 48 kHz à 16 kHz.
function resampleTo16k(input, sourceRate) {
  if (sourceRate === TARGET_RATE) return input;
  const ratio = sourceRate / TARGET_RATE;
  const count = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = sum / (end - start);
  }
  return output;
}

// En-tête WAV de 44 octets, puis échantillons 16 bits.
function encodeWav(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (pos, str) => { for (let i = 0; i < str.length; i++) view.setUint8(pos + i, str.charCodeAt(i)); };

  text(0, 'RIFF');  view.setUint32(4, 36 + samples.length * 2, true);  text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);                 // PCM
  view.setUint16(22, 1, true);                 // mono
  view.setUint32(24, TARGET_RATE, true);       // fréquence
  view.setUint32(28, TARGET_RATE * 2, true);   // octets par seconde
  view.setUint16(32, 2, true);                 // octets par échantillon
  view.setUint16(34, 16, true);                // bits
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return buffer;
}

// --- effacer ---
function clearAudio() {
  if (recording) { recording = false; chunks = []; total = 0; }
  releaseAudio();
  audioBlob = null;
  if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
  const player = $('#player');
  player.pause(); player.removeAttribute('src'); player.hidden = true;
  $('#audio-delete').hidden = true;
  $('#record-start').hidden = false;
  $('#record-stop').hidden = true;
  $('#status').textContent = 'Aucun audio enregistré.';
}
$('#audio-delete').addEventListener('click', clearAudio);

// --- note ---
$('#note-clear').addEventListener('click', () => { $('#note').value = ''; $('#note').focus(); });