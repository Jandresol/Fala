const $ = id => document.getElementById(id);
const homeScreen = $('home'), liveScreen = $('live'), dashboardScreen = $('dashboard');
const tabHome = $('tabHome'), tabDashboard = $('tabDashboard');
const orb = $('orb'), liveState = $('liveState'), clarityNote = $('clarityNote');
const learnedChips = $('learnedChips'), liveError = $('liveError'), startError = $('startError');
const remoteAudio = $('remoteAudio');
const subtitleBox = $('subtitleBox'), subtitlePt = $('subtitlePt'), subtitleEn = $('subtitleEn');
const subtitlesToggle = $('subtitlesToggle');
const transcriptLog = $('transcriptLog');

let selectedTopic = null;
let selectedMode = 'topic';
let selectedVideoId = null;
let sessionId = null;
let mediaRecorder = null;
let recordedChunks = [];
let micStream = null;
let busy = false;
let subtitlesTouched = false;

subtitlesToggle.onchange = () => { subtitlesTouched = true; };

function escapeHtml(s = '') {
  return String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function playBase64Wav(base64) {
  return new Promise(resolve => {
    remoteAudio.src = `data:audio/wav;base64,${base64}`;
    remoteAudio.onended = resolve;
    remoteAudio.onerror = resolve;
    remoteAudio.play().catch(resolve);
  });
}

function showSubtitles(pt, en) {
  if (!subtitlesToggle.checked) { subtitleBox.classList.add('hidden'); return; }
  subtitlePt.textContent = pt || '';
  subtitleEn.textContent = en || '';
  subtitleBox.classList.remove('hidden');
}

function hideSubtitles() {
  subtitleBox.classList.add('hidden');
}

function addTranscriptEntry(speaker, pt, en) {
  const row = document.createElement('div');
  row.className = `transcript-row transcript-${speaker}`;

  const speakerEl = document.createElement('span');
  speakerEl.className = 'transcript-speaker';
  speakerEl.textContent = speaker === 'you' ? 'Você' : 'Fala';
  row.appendChild(speakerEl);

  const ptEl = document.createElement('span');
  ptEl.className = 'transcript-pt';
  ptEl.textContent = pt || '';
  row.appendChild(ptEl);

  if (en) {
    const enEl = document.createElement('span');
    enEl.className = 'transcript-en';
    enEl.textContent = en;
    row.appendChild(enEl);
  }

  transcriptLog.appendChild(row);
  transcriptLog.scrollTop = transcriptLog.scrollHeight;
}

function addLearnedPhrases(phrases) {
  for (const p of phrases || []) {
    const span = document.createElement('span');
    span.title = p.en || '';
    span.textContent = p.pt;
    learnedChips.appendChild(span);
  }
}

function clarityLabel(clarity) {
  if (typeof clarity !== 'number') return '';
  const pct = Math.round(clarity * 100);
  if (clarity >= 0.85) return `Pronúncia clara · ${pct}%`;
  if (clarity >= 0.65) return `Pronúncia ok · ${pct}%`;
  return `Um pouco difícil de entender · ${pct}%`;
}

// --- tab switching ---

function showTab(tab) {
  homeScreen.classList.toggle('hidden', tab !== 'home');
  dashboardScreen.classList.toggle('hidden', tab !== 'dashboard');
  liveScreen.classList.add('hidden');
  tabHome.classList.toggle('active', tab === 'home');
  tabDashboard.classList.toggle('active', tab === 'dashboard');
  if (tab === 'dashboard') loadDashboard();
}

tabHome.onclick = () => showTab('home');
tabDashboard.onclick = () => showTab('dashboard');

// --- home screen state ---

async function loadState() {
  try {
    const r = await fetch('/api/state');
    const data = await r.json();
    renderModes(data.modes);
    renderTopics(data.topics);
    renderReview(data.review);
    renderRecent(data.recentSessions);
    renderRecentVideos(data.recentVideos);
    if (typeof data.suggestedDifficulty === 'number') {
      $('difficulty').value = data.suggestedDifficulty;
      $('difficultyValue').textContent = data.suggestedDifficulty;
      $('adaptiveNote').textContent = '(sugerido pelo seu progresso)';
      if (!subtitlesTouched) subtitlesToggle.checked = data.suggestedDifficulty <= 2;
    }
  } catch (err) {
    startError.textContent = 'Could not load app state. Is the server running?';
  }
}

function renderModes(modes) {
  const box = $('modeChips');
  box.innerHTML = '';
  modes.forEach((m, i) => {
    const chip = document.createElement('button');
    chip.className = 'topic-chip' + (i === 0 ? ' selected' : '');
    chip.textContent = m.label;
    chip.title = m.desc;
    chip.type = 'button';
    chip.onclick = () => {
      box.querySelectorAll('.topic-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedMode = m.id;
    };
    box.appendChild(chip);
  });
  selectedMode = modes[0]?.id || 'topic';
}

function renderTopics(topics) {
  const box = $('topicChips');
  box.innerHTML = '';
  topics.forEach((t, i) => {
    const chip = document.createElement('button');
    chip.className = 'topic-chip' + (i === 0 ? ' selected' : '');
    chip.textContent = t.label;
    chip.type = 'button';
    chip.dataset.id = t.id;
    chip.onclick = () => {
      selectedVideoId = null;
      box.querySelectorAll('.topic-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedTopic = t.id;
    };
    box.appendChild(chip);
  });
  selectedTopic = topics[0]?.id || null;
}

function renderReview(review) {
  const box = $('reviewPhrases');
  if (!review || !review.length) {
    box.innerHTML = '<span class="muted-note">Nothing yet — have a conversation first.</span>';
    return;
  }
  box.innerHTML = review.map(p =>
    `<span title="mastery ${Math.round(p.mastery * 100)}%">${escapeHtml(p.pt)}</span>`
  ).join('');
}

function renderRecent(sessions) {
  const list = $('recentSessions');
  if (!sessions || !sessions.length) {
    list.innerHTML = '<li class="muted-note">No sessions yet.</li>';
    return;
  }
  list.innerHTML = sessions.map(s =>
    `<li>${escapeHtml(s.topic)} · nível ${s.difficulty} · ${s.turns} turnos${typeof s.avg_clarity === 'number' ? ` · clareza ${Math.round(s.avg_clarity * 100)}%` : ''}</li>`
  ).join('');
}

function renderRecentVideos(videos) {
  const box = $('recentVideosBox');
  if (!videos || !videos.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = '<div class="field-label" style="margin-top:22px">Vídeos preparados</div>' + videos.map(v =>
    `<div class="video-row"><span>${escapeHtml(v.title || v.url)}</span><button type="button" data-video-id="${v.id}" class="use-video">Usar</button></div>`
  ).join('');
  box.querySelectorAll('.use-video').forEach(btn => {
    btn.onclick = () => {
      selectedVideoId = Number(btn.dataset.videoId);
      startError.textContent = `Vídeo selecionado: ${btn.previousElementSibling ? btn.parentElement.querySelector('span').textContent : ''} — toque "Start talking" para conversar sobre ele.`;
    };
  });
}

$('difficulty').oninput = e => {
  const level = Number(e.target.value);
  $('difficultyValue').textContent = level;
  $('adaptiveNote').textContent = '';
  if (!subtitlesTouched) subtitlesToggle.checked = level <= 2;
};

$('videoForm').onsubmit = async e => {
  e.preventDefault();
  const url = $('youtubeUrl').value.trim();
  if (!url) return;
  const resultBox = $('videoResult');
  const submitBtn = e.target.querySelector('button');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Preparando…';
  resultBox.innerHTML = '<p class="muted-note">Baixando legendas e extraindo vocabulário… isso pode levar um minuto.</p>';
  try {
    const r = await fetch('/api/youtube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Could not prepare this video.');
    selectedVideoId = data.videoId;
    resultBox.innerHTML = `
      <div class="lesson">
        <strong>${escapeHtml(data.title || 'Vídeo')}</strong>
        <p>${escapeHtml(data.summary_pt)}</p>
        <div class="chips">${(data.phrases || []).map(p => `<span title="${escapeHtml(p.en)}">${escapeHtml(p.pt)}</span>`).join('')}</div>
        <p class="muted-note">Vídeo selecionado — toque "Start talking" acima para conversar sobre ele.</p>
      </div>`;
    $('youtubeUrl').value = '';
    loadState();
  } catch (err) {
    resultBox.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Prepare video';
  }
};

$('startBtn').onclick = async () => {
  if (busy || (!selectedTopic && !selectedVideoId)) return;
  busy = true;
  startError.textContent = '';
  $('startBtn').disabled = true;
  $('startBtn').textContent = 'Preparando…';
  try {
    const difficulty = Number($('difficulty').value);
    const body = selectedVideoId
      ? { videoId: selectedVideoId, difficulty }
      : { topic: selectedTopic, mode: selectedMode, difficulty };
    const r = await fetch('/api/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Could not start session.');
    sessionId = data.sessionId;
    learnedChips.innerHTML = '';
    addLearnedPhrases(data.newPhrases);
    transcriptLog.textContent = '';
    clarityNote.textContent = '';
    homeScreen.classList.add('hidden');
    dashboardScreen.classList.add('hidden');
    liveScreen.classList.remove('hidden');
    setOrbState('speaking');
    liveState.textContent = 'Fala está falando…';
    showSubtitles(data.replyText, data.translation);
    addTranscriptEntry('fala', data.replyText, data.translation);
    await playBase64Wav(data.audio);
    hideSubtitles();
    setOrbState('idle');
    liveState.textContent = 'Toque para falar';
  } catch (err) {
    startError.textContent = err.message;
  } finally {
    busy = false;
    $('startBtn').disabled = false;
    $('startBtn').textContent = 'Start talking';
  }
};

function setOrbState(state) {
  orb.classList.remove('listening', 'speaking', 'busy');
  if (state === 'listening') orb.classList.add('listening');
  if (state === 'speaking') orb.classList.add('speaking');
  if (state === 'busy') orb.classList.add('busy');
}

orb.onclick = async () => {
  if (busy) return;
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    await startRecording();
  } else {
    stopRecording();
  }
};

async function startRecording() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(micStream, { mimeType: 'audio/webm' });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.start();
    setOrbState('listening');
    liveState.textContent = 'Ouvindo… toque para parar';
    liveError.textContent = '';
  } catch (err) {
    liveError.textContent = 'Could not access microphone: ' + err.message;
  }
}

function stopRecording() {
  return new Promise(resolve => {
    mediaRecorder.onstop = async () => {
      micStream?.getTracks().forEach(t => t.stop());
      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      await sendTurn(blob);
      resolve();
    };
    mediaRecorder.stop();
    setOrbState('busy');
    liveState.textContent = 'Pensando…';
  });
}

async function sendTurn(blob) {
  busy = true;
  try {
    const buf = await blob.arrayBuffer();
    const r = await fetch(`/api/session/${sessionId}/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm' },
      body: buf,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Could not process your turn.');
    addTranscriptEntry('you', data.userText);
    clarityNote.textContent = clarityLabel(data.clarity);
    addLearnedPhrases(data.newPhrases);
    setOrbState('speaking');
    liveState.textContent = 'Fala está falando…';
    showSubtitles(data.replyText, data.translation);
    addTranscriptEntry('fala', data.replyText, data.translation);
    await playBase64Wav(data.audio);
    hideSubtitles();
    setOrbState('idle');
    liveState.textContent = 'Toque para falar';
  } catch (err) {
    liveError.textContent = err.message;
    setOrbState('idle');
    liveState.textContent = 'Toque para falar';
  } finally {
    busy = false;
  }
}

$('endBtn').onclick = async () => {
  if (sessionId) {
    await fetch(`/api/session/${sessionId}/end`, { method: 'POST' }).catch(() => {});
  }
  sessionId = null;
  selectedVideoId = null;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  micStream?.getTracks().forEach(t => t.stop());
  hideSubtitles();
  liveScreen.classList.add('hidden');
  showTab('home');
  loadState();
};

// --- dashboard ---

async function loadDashboard() {
  try {
    const r = await fetch('/api/dashboard');
    const data = await r.json();
    $('streakValue').textContent = `${data.streak} ${data.streak === 1 ? 'dia' : 'dias'}`;
    $('adaptiveValue').textContent = `${data.adaptiveDifficulty}/10`;
    renderClaritySpark(data.clarityTrend);
    renderMasteryBars(data.masteryBuckets);
    renderAllPhrases(data.phrases);
    renderDashboardSessions(data.sessions);
  } catch (err) {
    $('streakValue').textContent = '—';
  }
}

function renderClaritySpark(trend) {
  const box = $('claritySpark');
  if (!trend || !trend.length) {
    box.innerHTML = '<span class="muted-note">Sem dados ainda.</span>';
    return;
  }
  box.innerHTML = trend.map(t => {
    const pct = Math.max(6, Math.round((t.avg_clarity || 0) * 100));
    return `<span class="spark-bar" style="height:${pct}%" title="${pct}%"></span>`;
  }).join('');
}

function renderMasteryBars(buckets) {
  const box = $('masteryBars');
  if (!buckets) { box.innerHTML = ''; return; }
  const total = Math.max(1, buckets.new + buckets.learning + buckets.familiar + buckets.mastered);
  const rows = [
    ['Novas', buckets.new, 'new'],
    ['Aprendendo', buckets.learning, 'learning'],
    ['Familiares', buckets.familiar, 'familiar'],
    ['Dominadas', buckets.mastered, 'mastered'],
  ];
  box.innerHTML = rows.map(([label, count, cls]) => `
    <div class="mastery-row">
      <span class="mastery-label">${label} (${count})</span>
      <div class="mastery-track"><div class="mastery-fill ${cls}" style="width:${Math.round((count / total) * 100)}%"></div></div>
    </div>`).join('');
}

function renderAllPhrases(phrases) {
  const box = $('allPhrases');
  if (!phrases || !phrases.length) {
    box.innerHTML = '<p class="muted-note">Nenhuma frase ainda — comece uma conversa.</p>';
    return;
  }
  box.innerHTML = phrases.map(p => `
    <div class="phrase-row">
      <div><strong>${escapeHtml(p.pt)}</strong><span class="muted-note"> — ${escapeHtml(p.en || '')}</span></div>
      <span class="muted-note">${Math.round(p.mastery * 100)}%</span>
    </div>`).join('');
}

function renderDashboardSessions(sessions) {
  const list = $('dashboardSessions');
  if (!sessions || !sessions.length) {
    list.innerHTML = '<li class="muted-note">No sessions yet.</li>';
    return;
  }
  list.innerHTML = sessions.map(s => `
    <li>${escapeHtml(s.topic)} · ${s.mode} · nível ${s.difficulty} · ${s.turns} turnos${typeof s.avg_clarity === 'number' ? ` · clareza ${Math.round(s.avg_clarity * 100)}%` : ''}</li>
  `).join('');
}

loadState();
