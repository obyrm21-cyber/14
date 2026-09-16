const $=s=>document.querySelector(s);const stage=$('#stage'),ctx=stage.getContext('2d');const audio=$('#audio');
let media=[],cues=[],scenes=[],current=0,playing=false,raf,installPrompt,selectedStyle='off',audioCtx,audioSource,audioDestination,ffmpeg=null,ffmpegLoaded=false;
const motions=['zoomIn','zoomOut'];
const uid=()=>Math.random().toString(36).slice(2);function fmt(t){t=Math.max(0,t||0);return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`}
function timecode(s){s=s.trim().replace(',','.');let p=s.split(':');if(p.length===2)p=[0,...p];let [h,m,r]=p;let [sec,ms='0']=r.split('.');return +h*3600 + +m*60 + +sec + +(ms+'00').slice(0,3)/1000}
function parseSrt(text){return text.trim()?text.trim().split(/\n\s*\n/).map(b=>{let l=b.split(/\r?\n/),i=l.findIndex(x=>x.includes('-->'));if(i<0)return null;let [a,z]=l[i].split('-->');return{start:timecode(a),end:timecode(z),text:l.slice(i+1).join(' ').replace(/<[^>]+>/g,'').trim()}}).filter(Boolean):[]}
function sortFiles(a,b){return a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'})}
function initAudio(){if(!audioCtx){audioCtx=new (window.AudioContext||window.webkitAudioContext)();audioSource=audioCtx.createMediaElementSource(audio);audioDestination=audioCtx.createMediaStreamDestination();audioSource.connect(audioDestination);audioSource.connect(audioCtx.destination)}}
function updatePlayerRatio(){let o=$('#orientation').value,w=$('#stage').parentElement;w.classList.remove('ratio-portrait','ratio-landscape','ratio-square','ratio-4x5');w.classList.add(o==='portrait'?'ratio-portrait':o==='landscape'?'ratio-landscape':o==='square'?'ratio-square':'ratio-4x5')}
function setCanvasSize(){
  const res=$('#resolution').value==='720'?720:1080;
  const o=$('#orientation').value;
  let w=res,h=Math.round(res*16/9);
  if(o==='landscape'){w=Math.round(res*16/9);h=res}
  else if(o==='square'){w=res;h=res}
  else if(o==='portrait4x5'){w=res;h=Math.round(res*5/4)}
  if(stage.width!==w||stage.height!==h){stage.width=w;stage.height=h}
  updatePlayerRatio()
}
function totalDuration(){return audio.duration||cues.at(-1)?.end||Math.max(5,media.length*5)}
function buildScenes(){
  const total=totalDuration();
  const count=Math.max(1,media.length);
  if(cues.length){
    // Timeline her zaman görsel sayısı kadar sahneden oluşur. Fazla SRT
    // blokları görseli başa sarıp ilk görseli tekrar seçemez.
    const previousEnd=Array(count).fill(0);
    scenes=Array.from({length:count},(_,i)=>{
      const c=cues[i]||{};
      const start=i===0?0:Math.max(previousEnd[i-1],c.start||0);
      const end=Math.min(total,Math.max(start+.25,c.end||start+.25));
      previousEnd[i]=end;
      return{id:uid(),start,end,text:c.text||'',mediaIndex:i,motion:motions[i%motions.length]};
    });
    if(scenes.length)scenes[scenes.length-1].end=Math.max(scenes.at(-1).end,total);
  }else{
    const dur=Math.max(.25,total/count);
    scenes=Array.from({length:count},(_,i)=>({id:uid(),start:i*dur,end:i===count-1?Math.max(total,(i+1)*dur):(i+1)*dur,text:'',mediaIndex:i,motion:motions[i%motions.length]}));
  }
  $('#sceneCount').textContent=`${scenes.length} sahne`;
  renderScenes();$('#timeline').max=total;draw(current);
}
function sceneAt(t){
  if(!scenes.length)return -1;
  const inside=scenes.findIndex(s=>t>=s.start&&t<s.end);
  if(inside>=0)return inside;
  // SRT'de boşluk varsa ilk sahneye dönme; o ana kadar başlayan son
  // sahneyi koru. Böylece 1. görsel diğer sahnelerin üstüne binmez.
  let last=-1;
  scenes.forEach((s,i)=>{if(s.start<=t)last=i});
  return last>=0?last:0;
}
function motionFor(scene,idx){let m=$('#motion').value;return m==='mixed'?scene.motion:m}
function drawImageFit(obj,progress,motion,alpha=1){let iw=obj.videoWidth||obj.naturalWidth||stage.width,ih=obj.videoHeight||obj.naturalHeight||stage.height;if(!iw||!ih)return;let fit=$('#fit').value,r=fit==='contain'?Math.min(stage.width/iw,stage.height/ih):Math.max(stage.width/iw,stage.height/ih),scale=1,x=0,y=0;if(motion==='zoomIn')scale=1+progress*.10;else if(motion==='zoomOut')scale=1.10-progress*.10;else if(motion==='panLeft')x=-progress*55;else if(motion==='panRight')x=progress*55;else if(motion==='none'){}let w=iw*r*scale,h=ih*r*scale;ctx.save();ctx.globalAlpha=alpha;ctx.translate(stage.width/2+x,stage.height/2+y);ctx.drawImage(obj,-w/2,-h/2,w,h);ctx.restore()}
function drawScene(si,t,alpha=1){
  let s=scenes[si],item=media[s?.mediaIndex];
  if(!s||!item)return;
  let p=Math.min(1,Math.max(0,(t-s.start)/Math.max(.001,s.end-s.start))),m=motionFor(s,si),obj=item.el;
  if(obj.tagName==='VIDEO'){
    const target=Math.max(0,t-s.start);
    if(Number.isFinite(obj.duration)&&obj.duration>0){
      const seekTarget=Math.min(Math.max(0,target),Math.max(0,obj.duration-.001));
      const shouldPlay=playing && current>=s.start && current<s.end;
      if(shouldPlay){
        if(obj._sceneIndex!==si){
          media.forEach(x=>{if(x.el.tagName==='VIDEO'&&x.el!==obj){try{x.el.pause()}catch{}}});
          obj._sceneIndex=si;
          obj.currentTime=seekTarget;
          obj.play().catch(()=>{});
        }
      }else{
        if(obj._sceneIndex!==si){obj._sceneIndex=si;obj.currentTime=seekTarget}
        else if(Math.abs(obj.currentTime-seekTarget)>.35){
          obj.currentTime=seekTarget;
        }
        try{obj.pause()}catch{}
      }
    }
  }
  drawImageFit(obj,p,m,alpha)
}
function draw(t=0){
  setCanvasSize();
  ctx.clearRect(0,0,stage.width,stage.height);
  ctx.fillStyle='#050811';
  ctx.fillRect(0,0,stage.width,stage.height);
  if(!media.length){$('#emptyState').style.display='flex';updateLabels(t);return}
  $('#emptyState').style.display='none';
  const i=sceneAt(t), s=scenes[i];
  if(i<0||!s){updateLabels(t);return}
  // STRICT TIMELINE: exactly one scene is rendered for each timestamp.
  // The previous scene is never called when the next scene starts.
  const fadeDuration=Math.max(.05,Number($('#fadeDuration')?.value||0));
  const local=Math.max(0,t-s.start);
  const alpha=$('#transition')?.value==='fade'&&fadeDuration>0
    ?Math.min(1,local/fadeDuration):1;
  drawScene(i,t,alpha);
  applyEffect();
  if(s.text&&($('#embedSubtitles')?.checked??true))drawSubtitle(s.text);
  updateLabels(t);
  document.querySelectorAll('.scene').forEach((e,n)=>e.classList.toggle('active',n===i));
}
function applyEffect(){let e=$('#effect').value;if(e==='warm'){ctx.fillStyle='rgba(255,150,40,.12)';ctx.fillRect(0,0,stage.width,stage.height)}else if(e==='cinema'){ctx.fillStyle='rgba(10,14,26,.18)';ctx.fillRect(0,0,stage.width,stage.height)}else if(e==='mono'){let g=ctx.getImageData(0,0,stage.width,stage.height),d=g.data;for(let i=0;i<d.length;i+=4){let y=.299*d[i]+.587*d[i+1]+.114*d[i+2];d[i]=d[i+1]=d[i+2]=y}ctx.putImageData(g,0,0)}else if(e==='vignette'){let g=ctx.createRadialGradient(stage.width/2,stage.height/2,Math.min(stage.width,stage.height)*.15,stage.width/2,stage.height/2,Math.max(stage.width,stage.height)*.65);g.addColorStop(0,'transparent');g.addColorStop(1,'rgba(0,0,0,.72)');ctx.fillStyle=g;ctx.fillRect(0,0,stage.width,stage.height)}}
function drawSubtitle(text){let pos=$('#subPosition').value,size=$('#subSize').value,sf=stage.width/960,fs=(size==='large'?34:size==='small'?21:27)*sf,y=stage.height-70*sf;if(pos==='center')y=stage.height/2;if(pos==='top')y=75*sf;ctx.font=`800 ${fs}px Arial`;ctx.textAlign='center';let max=stage.width-110*sf,lines=[],line='';for(const w of text.split(/\s+/)){let test=line?line+' '+w:w;if(ctx.measureText(test).width>max&&line){lines.push(line);line=w}else line=test}if(line)lines.push(line);let lh=fs*1.25;if(['box','neon','lower'].includes(selectedStyle)){ctx.fillStyle=selectedStyle==='neon'?'rgba(100,20,190,.78)':'rgba(0,0,0,.78)';ctx.fillRect(55*sf,y-fs,stage.width-110*sf,lines.length*lh+fs*.55)}ctx.fillStyle=selectedStyle==='yellow'||selectedStyle==='karaoke'?'#ffe35e':'#fff';ctx.strokeStyle='rgba(0,0,0,.82)';ctx.lineWidth=5*sf;lines.forEach((l,n)=>{let yy=y+n*lh;ctx.strokeText(l,stage.width/2,yy);ctx.fillText(l,stage.width/2,yy)})}
function updateLabels(t){let d=totalDuration();$('#timeline').value=Math.min(t,d);$('#timeLabel').textContent=`${fmt(t)} / ${fmt(d)}`}
function renderScenes(){let box=$('#scenes');box.innerHTML='';scenes.forEach((s,i)=>{let d=document.createElement('div');d.className='scene';d.innerHTML=`<strong>SAHNE ${String(i+1).padStart(2,'0')}</strong><time>${fmt(s.start)} — ${fmt(s.end)}</time><p>${s.text||'Otomatik sahne'}</p><small class="motion-tag">${motionFor(s,i)}</small>`;d.onclick=()=>{current=s.start;audio.currentTime=current;draw(current)};box.append(d)})}
async function loadMedia(files){media.forEach(m=>URL.revokeObjectURL(m.url));media=[];for(const file of [...files].sort(sortFiles)){let el=file.type.startsWith('video/')?document.createElement('video'):new Image(),url=URL.createObjectURL(file);el.src=url;el.muted=true;el.playsInline=true;el.crossOrigin='anonymous';if(el.tagName==='VIDEO'){el.preload='auto';await new Promise(r=>{el.onloadedmetadata=()=>r();el.onerror=()=>r();el.load()})}else await new Promise(r=>{el.onload=()=>r();el.onerror=()=>r()});media.push({name:file.name,el,url})}$('#status').textContent=`${media.length} medya hazır`;buildScenes()}
$('#mediaInput').onchange=e=>loadMedia(e.target.files);$('#audioInput').onchange=e=>{let f=e.target.files[0];if(!f)return;audio.src=URL.createObjectURL(f);$('#audioLabel').textContent=f.name;initAudio();audio.onloadedmetadata=()=>buildScenes()};$('#srtInput').onchange=async e=>{let f=e.target.files[0];if(!f)return;cues=parseSrt(await f.text());$('#srtLabel').textContent=f.name;$('#status').textContent=`${cues.length} altyazı bloğu hazır`;buildScenes()};
let playbackClock=0,playbackStartedAt=0;
$('#playBtn').onclick=async()=>{
  if(audio.src){initAudio();if(audioCtx.state==='suspended')await audioCtx.resume()}
  playing=!playing;$('#playBtn').textContent=playing?'Ⅱ':'▶';
  if(playing){
    if(current>=totalDuration())current=0;
    playbackClock=current;playbackStartedAt=performance.now()-current*1000;
    if(audio.src){audio.currentTime=current;await audio.play().catch(()=>{})}
    tick();
  }else{
    if(audio.src)audio.pause();
    media.forEach(x=>{if(x.el.tagName==='VIDEO')try{x.el.pause()}catch{}});
    cancelAnimationFrame(raf);
  }
};
$('#timeline').oninput=e=>{
  current=+e.target.value;playbackClock=current;playbackStartedAt=performance.now()-current*1000;
  if(audio.src)audio.currentTime=current;
  media.forEach(x=>{if(x.el.tagName==='VIDEO'){x.el._sceneIndex=-1;try{x.el.pause()}catch{}}});
  draw(current);
};
function tick(){
  if(!playing)return;
  const d=totalDuration();
  current=audio.src&&Number.isFinite(audio.duration)?audio.currentTime:Math.min(d,(performance.now()-playbackStartedAt)/1000);
  draw(current);
  if(current>=d){playing=false;$('#playBtn').textContent='▶';if(audio.src)audio.pause();media.forEach(x=>{if(x.el.tagName==='VIDEO')try{x.el.pause()}catch{}});return}
  raf=requestAnimationFrame(tick);
}
document.querySelectorAll('.style').forEach(b=>b.onclick=()=>{document.querySelectorAll('.style').forEach(x=>x.classList.remove('active'));b.classList.add('active');selectedStyle=b.dataset.style;draw(current)});document.querySelectorAll('select').forEach(s=>s.onchange=()=>{if(['orientation','resolution'].includes(s.id))setCanvasSize();if(s.id==='motion')renderScenes();draw(current)});
const CORE_BASE='https://unpkg.com/@ffmpeg/core-st@0.11.1/dist';
async function ensureFFmpeg(){
  if(ffmpegLoaded)return;
  if(!window.FFmpeg || !window.FFmpeg.createFFmpeg)throw Error('MP4 motoru bu tarayıcıda kullanılamadı.');
  const {createFFmpeg}=window.FFmpeg;
  $('#status').textContent='MP4 motoru hazırlanıyor…';
  ffmpeg=createFFmpeg({
    log:false,
    corePath:`${CORE_BASE}/ffmpeg-core.js`,
    progress:({ratio})=>{$('#progressBar').style.width=Math.round(Math.max(0,Math.min(1,ratio||0))*100)+'%'}
  });
  await ffmpeg.load();
  ffmpegLoaded=true;
}
async function convertWebMtoMP4(blob){
  await ensureFFmpeg();
  const {fetchFile}=window.FFmpeg;
  ffmpeg.FS('writeFile','input.webm',await fetchFile(blob));
  await ffmpeg.run('-i','input.webm','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-movflags','+faststart','-c:a','aac','-b:a','192k','output.mp4');
  const out=ffmpeg.FS('readFile','output.mp4');
  try{ffmpeg.FS('unlink','input.webm');ffmpeg.FS('unlink','output.mp4')}catch{}
  return new Blob([out.buffer],{type:'video/mp4'});
}
function offerDownload(blob,ext,label){
  const url=URL.createObjectURL(blob),a=$('#download');
  const preview=$('#outputPreview');
  if(preview){preview.src=url;preview.hidden=false;preview.load()}

  a.href=url;a.download=`kurgu-canavari-${Date.now()}.${ext}`;
  a.textContent=`İndir: kurgu-canavari.${ext}`;a.hidden=false;
  $('#progressBar').style.width='100%';$('#status').textContent=label;
}
function nextAnimationFrame(){
  return new Promise(resolve=>requestAnimationFrame(resolve));
}

async function renderWebM(){
  setCanvasSize();
  const duration=Math.max(.05,totalDuration());
  const fps=Number($('#quality').value)||30;
  const frameCount=Math.max(1,Math.ceil(duration*fps));
  const videoStream=stage.captureStream(fps);
  let combinedStream=videoStream,hasAudio=false;
  try{
    initAudio();
    if(audio.src){
      const tracks=audioDestination.stream.getAudioTracks();
      if(tracks.length){combinedStream=new MediaStream([...videoStream.getVideoTracks(),...tracks]);hasAudio=true}
    }
  }catch(e){console.warn('Ses kaydı devre dışı:',e)}
  const types=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
  const mime=types.find(t=>window.MediaRecorder&&MediaRecorder.isTypeSupported(t));
  if(!mime)throw Error('Bu tarayıcı WebM video kaydını desteklemiyor.');
  const recorder=new MediaRecorder(combinedStream,{mimeType:mime,videoBitsPerSecond:6000000});
  const chunks=[];
  recorder.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
  const finished=new Promise((resolve,reject)=>{
    recorder.onerror=e=>reject(e.error||new Error('MediaRecorder hatası'));
    recorder.onstop=()=>resolve(new Blob(chunks,{type:'video/webm'}));
  });
  let stopped=false;
  const stop=()=>{
    if(stopped)return;
    stopped=true;
    if(recorder.state!=='inactive')recorder.stop();
    try{audio.pause()}catch{}
    videoStream.getTracks().forEach(t=>t.stop());
    if(combinedStream!==videoStream)combinedStream.getAudioTracks().forEach(t=>t.stop());
  };
  current=0;playing=false;
  media.forEach(x=>{if(x.el.tagName==='VIDEO'){x.el._sceneIndex=-1;try{x.el.pause()}catch{}}});
  // Sesli renderda audio.currentTime master clock'tur. Kaydı, ses gerçekten
  // başladıktan sonra açıyoruz; böylece ilk video karesi sesin 0. saniyesine
  // bağlanır. Ses yoksa performance.now() fallback'i kullanılır.
  if(hasAudio){
    audio.currentTime=0;
    try{await audio.play()}catch(e){throw Error('Ses oynatılamadı; senkron render başlatılamadı.')}
  }
  ctx.clearRect(0,0,stage.width,stage.height);ctx.fillStyle='#050811';ctx.fillRect(0,0,stage.width,stage.height);
  recorder.start(250);
  const started=performance.now();
  return new Promise((resolve,reject)=>{
    let frameNo=0;
    const next=()=>{
      if(stopped)return;
      const wallClock=(performance.now()-started)/1000;
      const masterClock=hasAudio&&Number.isFinite(audio.currentTime)?audio.currentTime:wallClock;
      const t=Math.min(Math.max(0,masterClock),Math.max(0,duration-.001));
      current=t;
      draw(t); // audio.currentTime -> SRT + görsel aynı master clock
      const pct=Math.round(Math.min(1,Math.max(0,t/duration))*100);
      $('#progressBar').style.width=pct+'%';
      $('#status').textContent=`WebM oluşturuluyor… ${pct}%`;
      frameNo++;
      const done=hasAudio?audio.currentTime>=duration-.001:frameNo>=frameCount;
      if(done){
        current=Math.max(0,duration-.001);
        draw(current);
        stop();
        finished.then(resolve).catch(reject);
      }else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  });
}
$('#format').onchange=()=>{$('#renderBtn').textContent=$('#format').value==='mp4'?'▶ MP4 olarak dışa aktar':'▶ WebM olarak dışa aktar'};$('#renderBtn').onclick=async()=>{if(!media.length){alert('Önce görsel veya video yükleyin.');return}$('#renderBtn').disabled=true;$('#download').hidden=true;$('#renderProgress').hidden=false;$('#progressBar').style.width='0%';try{const webm=await renderWebM();let ext=$('#format').value;if(ext==='mp4'){try{const blob=await convertWebMtoMP4(webm);offerDownload(blob,'mp4','MP4 hazır')}catch(err){console.warn('MP4 motoru kullanılamadı, WebM fallback:',err);offerDownload(webm,'webm','MP4 motoru bu tarayıcıda kullanılamadı; WebM hazır')}}else offerDownload(webm,'webm','WEBM hazır')}catch(err){console.error(err);alert('Dışa aktarma hatası: '+(err?.message||err));$('#status').textContent='Dışa aktarma başarısız'}finally{$('#renderBtn').disabled=false;setTimeout(()=>$('#renderProgress').hidden=true,1200)}};
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#installBtn').hidden=false});$('#installBtn').onclick=async()=>{if(installPrompt){installPrompt.prompt();installPrompt=null}};if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js');setCanvasSize();draw();      const shouldPlay=playing && current>=s.start && current<s.end;
      if(shouldPlay){
        if(obj._sceneIndex!==si){
          media.forEach(x=>{if(x.el.tagName==='VIDEO'&&x.el!==obj){try{x.el.pause()}catch{}}});
          obj._sceneIndex=si;
          obj.currentTime=seekTarget;
          obj.play().catch(()=>{});
        }
      }else{
        if(obj._sceneIndex!==si){obj._sceneIndex=si;obj.currentTime=seekTarget}
        else if(Math.abs(obj.currentTime-seekTarget)>.35){
          obj.currentTime=seekTarget;
        }
        try{obj.pause()}catch{}
      }
    }
  }
  drawImageFit(obj,p,m,alpha)
}
function draw(t=0){
  setCanvasSize();
  ctx.clearRect(0,0,stage.width,stage.height);
  ctx.fillStyle='#050811';
  ctx.fillRect(0,0,stage.width,stage.height);
  if(!media.length){$('#emptyState').style.display='flex';updateLabels(t);return}
  $('#emptyState').style.display='none';
  const i=sceneAt(t), s=scenes[i];
  if(i<0||!s){updateLabels(t);return}
  // STRICT TIMELINE: exactly one scene is rendered for each timestamp.
  // The previous scene is never called when the next scene starts.
  const fadeDuration=Math.max(.05,Number($('#fadeDuration')?.value||0));
  const local=Math.max(0,t-s.start);
  const alpha=$('#transition')?.value==='fade'&&fadeDuration>0
    ?Math.min(1,local/fadeDuration):1;
  drawScene(i,t,alpha);
  applyEffect();
  if(s.text&&($('#embedSubtitles')?.checked??true))drawSubtitle(s.text);
  updateLabels(t);
  document.querySelectorAll('.scene').forEach((e,n)=>e.classList.toggle('active',n===i));
}
function applyEffect(){let e=$('#effect').value;if(e==='warm'){ctx.fillStyle='rgba(255,150,40,.12)';ctx.fillRect(0,0,stage.width,stage.height)}else if(e==='cinema'){ctx.fillStyle='rgba(10,14,26,.18)';ctx.fillRect(0,0,stage.width,stage.height)}else if(e==='mono'){let g=ctx.getImageData(0,0,stage.width,stage.height),d=g.data;for(let i=0;i<d.length;i+=4){let y=.299*d[i]+.587*d[i+1]+.114*d[i+2];d[i]=d[i+1]=d[i+2]=y}ctx.putImageData(g,0,0)}else if(e==='vignette'){let g=ctx.createRadialGradient(stage.width/2,stage.height/2,Math.min(stage.width,stage.height)*.15,stage.width/2,stage.height/2,Math.max(stage.width,stage.height)*.65);g.addColorStop(0,'transparent');g.addColorStop(1,'rgba(0,0,0,.72)');ctx.fillStyle=g;ctx.fillRect(0,0,stage.width,stage.height)}}
function drawSubtitle(text){let pos=$('#subPosition').value,size=$('#subSize').value,sf=stage.width/960,fs=(size==='large'?34:size==='small'?21:27)*sf,y=stage.height-70*sf;if(pos==='center')y=stage.height/2;if(pos==='top')y=75*sf;ctx.font=`800 ${fs}px Arial`;ctx.textAlign='center';let max=stage.width-110*sf,lines=[],line='';for(const w of text.split(/\s+/)){let test=line?line+' '+w:w;if(ctx.measureText(test).width>max&&line){lines.push(line);line=w}else line=test}if(line)lines.push(line);let lh=fs*1.25;if(['box','neon','lower'].includes(selectedStyle)){ctx.fillStyle=selectedStyle==='neon'?'rgba(100,20,190,.78)':'rgba(0,0,0,.78)';ctx.fillRect(55*sf,y-fs,stage.width-110*sf,lines.length*lh+fs*.55)}ctx.fillStyle=selectedStyle==='yellow'||selectedStyle==='karaoke'?'#ffe35e':'#fff';ctx.strokeStyle='rgba(0,0,0,.82)';ctx.lineWidth=5*sf;lines.forEach((l,n)=>{let yy=y+n*lh;ctx.strokeText(l,stage.width/2,yy);ctx.fillText(l,stage.width/2,yy)})}
function updateLabels(t){let d=totalDuration();$('#timeline').value=Math.min(t,d);$('#timeLabel').textContent=`${fmt(t)} / ${fmt(d)}`}
function renderScenes(){let box=$('#scenes');box.innerHTML='';scenes.forEach((s,i)=>{let d=document.createElement('div');d.className='scene';d.innerHTML=`<strong>SAHNE ${String(i+1).padStart(2,'0')}</strong><time>${fmt(s.start)} — ${fmt(s.end)}</time><p>${s.text||'Otomatik sahne'}</p><small class="motion-tag">${motionFor(s,i)}</small>`;d.onclick=()=>{current=s.start;audio.currentTime=current;draw(current)};box.append(d)})}
async function loadMedia(files){media.forEach(m=>URL.revokeObjectURL(m.url));media=[];for(const file of [...files].sort(sortFiles)){let el=file.type.startsWith('video/')?document.createElement('video'):new Image(),url=URL.createObjectURL(file);el.src=url;el.muted=true;el.playsInline=true;el.crossOrigin='anonymous';if(el.tagName==='VIDEO'){el.preload='auto';await new Promise(r=>{el.onloadedmetadata=()=>r();el.onerror=()=>r();el.load()})}else await new Promise(r=>{el.onload=()=>r();el.onerror=()=>r()});media.push({name:file.name,el,url})}$('#status').textContent=`${media.length} medya hazır`;buildScenes()}
$('#mediaInput').onchange=e=>loadMedia(e.target.files);$('#audioInput').onchange=e=>{let f=e.target.files[0];if(!f)return;audio.src=URL.createObjectURL(f);$('#audioLabel').textContent=f.name;initAudio();audio.onloadedmetadata=()=>buildScenes()};$('#srtInput').onchange=async e=>{let f=e.target.files[0];if(!f)return;cues=parseSrt(await f.text());$('#srtLabel').textContent=f.name;$('#status').textContent=`${cues.length} altyazı bloğu hazır`;buildScenes()};
let playbackClock=0,playbackStartedAt=0;
$('#playBtn').onclick=async()=>{
  if(audio.src){initAudio();if(audioCtx.state==='suspended')await audioCtx.resume()}
  playing=!playing;$('#playBtn').textContent=playing?'Ⅱ':'▶';
  if(playing){
    if(current>=totalDuration())current=0;
    playbackClock=current;playbackStartedAt=performance.now()-current*1000;
    if(audio.src){audio.currentTime=current;await audio.play().catch(()=>{})}
    tick();
  }else{
    if(audio.src)audio.pause();
    media.forEach(x=>{if(x.el.tagName==='VIDEO')try{x.el.pause()}catch{}});
    cancelAnimationFrame(raf);
  }
};
$('#timeline').oninput=e=>{
  current=+e.target.value;playbackClock=current;playbackStartedAt=performance.now()-current*1000;
  if(audio.src)audio.currentTime=current;
  media.forEach(x=>{if(x.el.tagName==='VIDEO'){x.el._sceneIndex=-1;try{x.el.pause()}catch{}}});
  draw(current);
};
function tick(){
  if(!playing)return;
  const d=totalDuration();
  current=audio.src&&Number.isFinite(audio.duration)?audio.currentTime:Math.min(d,(performance.now()-playbackStartedAt)/1000);
  draw(current);
  if(current>=d){playing=false;$('#playBtn').textContent='▶';if(audio.src)audio.pause();media.forEach(x=>{if(x.el.tagName==='VIDEO')try{x.el.pause()}catch{}});return}
  raf=requestAnimationFrame(tick);
}
document.querySelectorAll('.style').forEach(b=>b.onclick=()=>{document.querySelectorAll('.style').forEach(x=>x.classList.remove('active'));b.classList.add('active');selectedStyle=b.dataset.style;draw(current)});document.querySelectorAll('select').forEach(s=>s.onchange=()=>{if(['orientation','resolution'].includes(s.id))setCanvasSize();if(s.id==='motion')renderScenes();draw(current)});
const CORE_BASE='https://unpkg.com/@ffmpeg/core-st@0.11.1/dist';
async function ensureFFmpeg(){
  if(ffmpegLoaded)return;
  if(!window.FFmpeg || !window.FFmpeg.createFFmpeg)throw Error('MP4 motoru bu tarayıcıda kullanılamadı.');
  const {createFFmpeg}=window.FFmpeg;
  $('#status').textContent='MP4 motoru hazırlanıyor…';
  ffmpeg=createFFmpeg({
    log:false,
    corePath:`${CORE_BASE}/ffmpeg-core.js`,
    progress:({ratio})=>{$('#progressBar').style.width=Math.round(Math.max(0,Math.min(1,ratio||0))*100)+'%'}
  });
  await ffmpeg.load();
  ffmpegLoaded=true;
}
async function convertWebMtoMP4(blob){
  await ensureFFmpeg();
  const {fetchFile}=window.FFmpeg;
  ffmpeg.FS('writeFile','input.webm',await fetchFile(blob));
  await ffmpeg.run('-i','input.webm','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-movflags','+faststart','-c:a','aac','-b:a','192k','output.mp4');
  const out=ffmpeg.FS('readFile','output.mp4');
  try{ffmpeg.FS('unlink','input.webm');ffmpeg.FS('unlink','output.mp4')}catch{}
  return new Blob([out.buffer],{type:'video/mp4'});
}
function offerDownload(blob,ext,label){
  const url=URL.createObjectURL(blob),a=$('#download');
  const preview=$('#outputPreview');
  if(preview){preview.src=url;preview.hidden=false;preview.load()}

  a.href=url;a.download=`kurgu-canavari-${Date.now()}.${ext}`;
  a.textContent=`İndir: kurgu-canavari.${ext}`;a.hidden=false;
  $('#progressBar').style.width='100%';$('#status').textContent=label;
}
function nextAnimationFrame(){
  return new Promise(resolve=>requestAnimationFrame(resolve));
}

async function renderWebM(){
  setCanvasSize();
  const duration=Math.max(.05,totalDuration());
  const fps=Number($('#quality').value)||30;
  const frameCount=Math.max(1,Math.ceil(duration*fps));
  const videoStream=stage.captureStream(fps);
  let combinedStream=videoStream,hasAudio=false;
  try{
    initAudio();
    if(audio.src){
      const tracks=audioDestination.stream.getAudioTracks();
      if(tracks.length){combinedStream=new MediaStream([...videoStream.getVideoTracks(),...tracks]);hasAudio=true}
    }
  }catch(e){console.warn('Ses kaydı devre dışı:',e)}
  const types=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
  const mime=types.find(t=>window.MediaRecorder&&MediaRecorder.isTypeSupported(t));
  if(!mime)throw Error('Bu tarayıcı WebM video kaydını desteklemiyor.');
  const recorder=new MediaRecorder(combinedStream,{mimeType:mime,videoBitsPerSecond:6000000});
  const chunks=[];
  recorder.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
  const finished=new Promise((resolve,reject)=>{
    recorder.onerror=e=>reject(e.error||new Error('MediaRecorder hatası'));
    recorder.onstop=()=>resolve(new Blob(chunks,{type:'video/webm'}));
  });
  let stopped=false;
  const stop=()=>{
    if(stopped)return;
    stopped=true;
    if(recorder.state!=='inactive')recorder.stop();
    try{audio.pause()}catch{}
    videoStream.getTracks().forEach(t=>t.stop());
    if(combinedStream!==videoStream)combinedStream.getAudioTracks().forEach(t=>t.stop());
  };
  current=0;playing=false;
  media.forEach(x=>{if(x.el.tagName==='VIDEO'){x.el._sceneIndex=-1;try{x.el.pause()}catch{}}});
  // Sesli renderda audio.currentTime master clock'tur. Kaydı, ses gerçekten
  // başladıktan sonra açıyoruz; böylece ilk video karesi sesin 0. saniyesine
  // bağlanır. Ses yoksa performance.now() fallback'i kullanılır.
  if(hasAudio){
    audio.currentTime=0;
    try{await audio.play()}catch(e){throw Error('Ses oynatılamadı; senkron render başlatılamadı.')}
  }
  ctx.clearRect(0,0,stage.width,stage.height);ctx.fillStyle='#050811';ctx.fillRect(0,0,stage.width,stage.height);
  recorder.start(250);
  const started=performance.now();
  return new Promise((resolve,reject)=>{
    let frameNo=0;
    const next=()=>{
      if(stopped)return;
      const wallClock=(performance.now()-started)/1000;
      const masterClock=hasAudio&&Number.isFinite(audio.currentTime)?audio.currentTime:wallClock;
      const t=Math.min(Math.max(0,masterClock),Math.max(0,duration-.001));
      current=t;
      draw(t); // audio.currentTime -> SRT + görsel aynı master clock
      const pct=Math.round(Math.min(1,Math.max(0,t/duration))*100);
      $('#progressBar').style.width=pct+'%';
      $('#status').textContent=`WebM oluşturuluyor… ${pct}%`;
      frameNo++;
      const done=hasAudio?audio.currentTime>=duration-.001:frameNo>=frameCount;
      if(done){
        current=Math.max(0,duration-.001);
        draw(current);
        stop();
        finished.then(resolve).catch(reject);
      }else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  });
}
$('#format').onchange=()=>{$('#renderBtn').textContent=$('#format').value==='mp4'?'▶ MP4 olarak dışa aktar':'▶ WebM olarak dışa aktar'};$('#renderBtn').onclick=async()=>{if(!media.length){alert('Önce görsel veya video yükleyin.');return}$('#renderBtn').disabled=true;$('#download').hidden=true;$('#renderProgress').hidden=false;$('#progressBar').style.width='0%';try{const webm=await renderWebM();let ext=$('#format').value;if(ext==='mp4'){try{const blob=await convertWebMtoMP4(webm);offerDownload(blob,'mp4','MP4 hazır')}catch(err){console.warn('MP4 motoru kullanılamadı, WebM fallback:',err);offerDownload(webm,'webm','MP4 motoru bu tarayıcıda kullanılamadı; WebM hazır')}}else offerDownload(webm,'webm','WEBM hazır')}catch(err){console.error(err);alert('Dışa aktarma hatası: '+(err?.message||err));$('#status').textContent='Dışa aktarma başarısız'}finally{$('#renderBtn').disabled=false;setTimeout(()=>$('#renderProgress').hidden=true,1200)}};
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#installBtn').hidden=false});$('#installBtn').onclick=async()=>{if(installPrompt){installPrompt.prompt();installPrompt=null}};if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js');setCanvasSize();draw();
