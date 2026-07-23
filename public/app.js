let pc, dc, micStream, videoContext = '';
const $ = id => document.getElementById(id);
const start = $('start'), stop = $('stop'), status = $('status'), orb = $('orb');

function setLive(live){status.textContent=live?'Live conversation':'Offline';status.classList.toggle('live',live);orb.classList.toggle('live',live);start.disabled=live;stop.disabled=!live;$('prompt').textContent=live?'Fale em português':'Ready for São Paulo?';$('subprompt').textContent=live?'Listen, respond, and keep the conversation moving.':'Start a live conversation, or prepare one from a Brazilian YouTube video.'}

start.onclick = async () => {
  try{
    pc = new RTCPeerConnection();
    pc.ontrack = e => $('remoteAudio').srcObject = e.streams[0];
    micStream = await navigator.mediaDevices.getUserMedia({audio:true});
    pc.addTrack(micStream.getTracks()[0]);
    dc = pc.createDataChannel('oai-events');
    dc.onopen=()=>{setLive(true);dc.send(JSON.stringify({type:'response.create',response:{instructions:'Comece a sessão agora em português brasileiro.'}}));};
    dc.onmessage=e=>{try{const ev=JSON.parse(e.data);if(ev.type==='error')console.error(ev)}catch{}};
    const offer=await pc.createOffer(); await pc.setLocalDescription(offer);
    const r=await fetch('/session?context='+encodeURIComponent(videoContext),{method:'POST',headers:{'Content-Type':'application/sdp'},body:offer.sdp});
    if(!r.ok) throw new Error(await r.text());
    await pc.setRemoteDescription({type:'answer',sdp:await r.text()});
  }catch(err){alert('Could not start voice: '+err.message);end();}
};
function end(){micStream?.getTracks().forEach(t=>t.stop());dc?.close();pc?.close();pc=dc=micStream=null;setLive(false)}
stop.onclick=end;

$('videoForm').onsubmit=async e=>{
  e.preventDefault(); const box=$('videoResult'); box.innerHTML='<p>Reading captions and preparing practice…</p>';
  try{
    const r=await fetch('/api/youtube',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:$('youtubeUrl').value})});
    const data=await r.json(); if(!r.ok)throw new Error(data.error);
    const l=data.lesson; videoContext=[l.summary_pt,l.context,'Expressões: '+l.phrases.map(p=>`${p.pt} (${p.en})`).join('; '),'Perguntas: '+l.questions.join(' | ')].join('\n');
    $('phrases').innerHTML=l.phrases.map(p=>`<span title="${escapeHtml(p.en)}">${escapeHtml(p.pt)}</span>`).join('');
    box.innerHTML=`<div class="lesson"><strong>Ready to discuss</strong><p>${escapeHtml(l.summary_pt)}</p><button id="videoStart" class="primary">Start video conversation</button></div>`;
    $('videoStart').onclick=()=>start.click();
  }catch(err){box.innerHTML=`<p class="error">${escapeHtml(err.message)}</p>`}
};
function escapeHtml(s=''){return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
