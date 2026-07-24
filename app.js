// ===================================================================
// 顔立ち診断 — メインコントローラ
// 顔写真1枚 → FaceLandmarker(478点)解析 → 2軸スコア → 8タイプ → 結果
// 表記方針(_knowledge/07): 数値は出さず「〜寄り」の傾向表現。免責は結果と同一ビューに常時可視。
// ===================================================================
import { TYPES, TYPE_ORDER, GRID, AXIS } from './data.js?v=1';
import { extractFace, FACE_OVAL, DRAW_PTS } from './analyzer.js?v=2';
import { diagnose } from './diagnosis.js?v=2';

const $=s=>document.querySelector(s);
const VISION='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9';
const FACE_MODEL='https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
let faceLandmarker=null;
async function ensureFace(){
  if(faceLandmarker) return;
  showLoading('AIモデルを初期化しています…（初回のみ数秒）');
  const vision=await import(`${VISION}/vision_bundle.mjs`);
  const fileset=await vision.FilesetResolver.forVisionTasks(`${VISION}/wasm`);
  faceLandmarker=await vision.FaceLandmarker.createFromOptions(fileset,{
    baseOptions:{ modelAssetPath:FACE_MODEL }, runningMode:'IMAGE', numFaces:1,
    outputFaceBlendshapes:true, outputFacialTransformationMatrixes:true,
  });
}

const view={ canvas:null, ctx:null, W:0, H:0, imageData:null, loaded:false, objURL:null, face:null };

function setStatus(t){ const el=$('#pc-status'); if(el) el.textContent=t; }
function setSlotStatus(t){ const el=$('#pc-status-face'); if(el) el.textContent=t; }
window.addEventListener('error', e=>{ setStatus('⚠️ エラー: '+(e.message||e.error)); });
window.addEventListener('unhandledrejection', e=>{ setStatus('⚠️ エラー: '+((e.reason&&e.reason.message)||e.reason)); });
function showLoading(t){ $('#pc-loading-text').textContent=t||'処理中…'; $('#pc-loading').hidden=false; }
function hideLoading(){ $('#pc-loading').hidden=true; }

function revealTool(){ const s=$('#start'); s.hidden=false; s.scrollIntoView({behavior:'smooth',block:'start'}); }
document.querySelectorAll('.js-reveal').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();revealTool();}));

// ---- HEIC(iPhone写真) 遅延ロード ----
let _heicMod=null;
function getHeic(){ if(!_heicMod) _heicMod=import('https://cdn.jsdelivr.net/npm/heic-to/+esm'); return _heicMod; }

// ---- blob を canvas に描画 ----
function loadImageBlob(blob){
  if(view.objURL) URL.revokeObjectURL(view.objURL);
  view.objURL=URL.createObjectURL(blob);
  const img=new Image();
  img.onload=()=>{
    const maxW=520, sc=Math.min(1, maxW/img.width);
    const W=Math.round(img.width*sc), H=Math.round(img.height*sc);
    const cv=$('#pc-canvas-face'); cv.width=W; cv.height=H;
    const ctx=cv.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(img,0,0,W,H);
    view.canvas=cv; view.ctx=ctx; view.W=W; view.H=H;
    view.imageData=ctx.getImageData(0,0,W,H).data;
    view.loaded=true; view.face=null;
    URL.revokeObjectURL(view.objURL); view.objURL=null;
    $('#pc-prev-face').hidden=false;
    setSlotStatus('✓ 顔写真を読み込みました');
    refreshDiagnoseState();
  };
  img.onerror=()=>{ hideLoading(); setSlotStatus('⚠️ この画像は表示できませんでした。JPEG/PNGでお試しください。'); };
  img.src=view.objURL;
}

async function handleFile(f){
  if(!f) return;
  setSlotStatus(`処理中… (${(f.size/1024/1024).toFixed(1)}MB)`);
  const strongHeic = /image\/(heic|heif)/i.test(f.type) || /\.(heic|heif)$/i.test(f.name||'');
  const heicLike = strongHeic || (f.type==='' && f.size>0);
  if(heicLike){
    try{
      showLoading('iPhoneの写真(HEIC)をJPEGに変換しています…');
      const mod=await getHeic();
      const jpg=await mod.heicTo({ blob:f, type:'image/jpeg', quality:0.9 });
      hideLoading(); loadImageBlob(jpg); return;
    }catch(err){
      hideLoading(); console.error(err);
      if(strongHeic){ setSlotStatus('⚠️ HEICの変換に失敗。設定→カメラ→フォーマット→「互換性優先」かJPEGでお試しください。'); return; }
      loadImageBlob(f); return;
    }
  }
  loadImageBlob(f);
}

$('#pc-file-face').addEventListener('change', e=>{ const f=e.target.files[0]; if(f) handleFile(f); });
document.addEventListener('paste', e=>{
  const dt=e.clipboardData; if(!dt) return;
  const grab=()=>{ if(dt.files&&dt.files.length) return dt.files[0]; for(const it of (dt.items||[])){ if(it.kind==='file'){ const f=it.getAsFile(); if(f) return f; } } return null; };
  const f=grab(); if(f){ e.preventDefault(); revealTool(); handleFile(f); }
});
(function(){
  const dz=$('#pc-slot-face'); if(!dz) return;
  ['dragover','dragenter'].forEach(ev=>dz.addEventListener(ev,e=>{ e.preventDefault(); dz.classList.add('pc-drag'); }));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{ e.preventDefault(); dz.classList.remove('pc-drag'); }));
  dz.addEventListener('drop',e=>{ const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0]; if(f) handleFile(f); });
})();

function refreshDiagnoseState(){
  const btn=$('#pc-diagnose'); if(!btn) return;
  btn.disabled=!view.loaded;
  const hint=$('#pc-diagnose-hint');
  if(hint) hint.textContent = view.loaded ? 'この写真で診断します' : 'まず顔写真をアップしてください';
}

// ---- 診断（FaceLandmarker解析 → 2軸採点 → 8タイプ） ----
$('#pc-diagnose').addEventListener('click', async()=>{
  if(!view.loaded){ setStatus('先に顔写真をアップロードしてください。'); return; }
  let result;
  try{
    await ensureFace();
    showLoading('顔立ちを解析しています…');
    const det=faceLandmarker.detect(view.canvas);
    const fx=extractFace(det);
    if(!fx.ok){ hideLoading(); setStatus('⚠️ '+(fx.reason||'顔を解析できませんでした。')); return; }
    view.face=fx;
    result=diagnose(fx.features, fx.quality);
    hideLoading();
  }catch(err){ console.error(err); hideLoading(); setStatus('⚠️ 解析中にエラーが発生しました。別の写真でお試しください。'); return; }

  showLoading('あなたの顔立ちタイプを判定しています…');
  setTimeout(()=>{
    hideLoading();
    renderResult(result);
    const res=$('#pc-result'); res.hidden=false;
    res.classList.remove('pc-reveal'); void res.offsetWidth; res.classList.add('pc-reveal');
    res.scrollIntoView({behavior:'smooth',block:'start'});
  }, 900);
});

// ---- 2軸マップ ----
function buildMap(typeId, accent){
  const rows=GRID.map(row=>row.map(id=>{
    if(!id) return `<div class="fc-cell empty"></div>`;
    const on = id===typeId ? ' on' : '';
    return `<div class="fc-cell${on}">${TYPES[id].name.replace('タイプ','')}</div>`;
  }).join('')).join('');
  return `<div class="fc-map">
    <div class="fc-map-wrap" style="--sa:${accent}">
      <div class="fc-axis-y"><span>${AXIS.age.minus}</span><span>${AXIS.age.plus}</span></div>
      <div class="fc-map-grid">${rows}</div>
      <div class="fc-axis-x"><span>← ${AXIS.shape.minus}</span><span>${AXIS.shape.plus} →</span></div>
    </div>
    <p class="fc-map-note">横＝かたち（曲線↔直線）／縦＝おもざし（子供↔大人）</p>
  </div>`;
}

// ---- 軸の“寄り”表示（数値は出さない） ----
function axisRow(axisKey, score, accent){
  const a=AXIS[axisKey];
  const pct=Math.round((Math.max(-1,Math.min(1,score))+1)/2*100);
  const verdict = score<=-0.2 ? a.minus+'寄り' : score>=0.2 ? a.plus+'寄り' : 'どちらとも';
  return `<div class="fc-axis-row">
      <span class="fc-axis-name">${a.name}</span>
      <div style="flex:1">
        <div class="fc-axis-bar" style="--sa:${accent}"><i style="left:${pct}%"></i></div>
        <div class="fc-axis-ends"><span>${a.minus}</span><span>${a.plus}</span></div>
      </div>
      <span class="fc-axis-verdict">${verdict}</span>
    </div>`;
}

// ---- 結果描画 ----
function renderResult(r){
  const t=TYPES[r.typeId]; const b=t.bridal;
  const confMap={ medium:['目安','#D6A85E'], low:['参考','#C57B6A'] };
  const [cf,cc]=confMap[r.confidence]||confMap.low;
  const notes=(r.notes&&r.notes.length)?`<p class="pc-confnote">確からしさに影響した点：${r.notes.join('／')}</p>`:'';

  $('#pc-result-body').innerHTML=`
    <div class="pc-res-head" style="--sa:${t.accent}">
      <div class="pc-res-season">${t.emoji} あなたの顔立ちは</div>
      <h3 class="pc-res-type">${t.name}${r.mixed?' <small>（ミックス寄り）</small>':''}</h3>
      <p class="pc-res-catch">${t.catch}</p>
      <span class="pc-conf" style="background:${cc}">確からしさ：${cf}</span>
    </div>
    <div class="pc-res-method-wrap"><span class="pc-res-method">📸 顔写真の形（比率・配置・輪郭）から判定しました</span></div>

    <div class="pc-block"><h4>AIが読み取ったあなたの顔</h4>
      <div class="fc-overlay-wrap"><canvas id="pc-face-canvas" class="fc-face-canvas"></canvas></div>
      <div class="fc-legend">
        <span><i style="background:#B89A6A"></i>顔の三分割（おもざし）</span>
        <span><i style="background:#8FA083"></i>輪郭ライン（かたち）</span>
        <span><i style="background:#C98A7C"></i>目尻の角度</span>
      </div>
      <p class="pc-share-note">この線から「おもざし（子供↔大人）」「かたち（曲線↔直線）」を測っています。<br><small>写真は端末内だけで処理し、外部には送信していません。</small></p>
    </div>

    <div class="pc-block"><h4>2軸マップ上の位置</h4>
      ${buildMap(r.typeId, t.accent)}
      ${axisRow('age', r.ageScore, t.accent)}
      ${axisRow('shape', r.shapeScore, t.accent)}
      <p class="pc-share-note">${t.axisLabel} の領域です。${t.impression}</p>
    </div>

    <div class="pc-block"><h4>顔立ちの特徴</h4>
      <ul>${t.traits.map(x=>`<li>${x}</li>`).join('')}</ul></div>

    <div class="pc-wedding">
      <div class="pc-wedding-head">
        <span class="pc-wd-label">FOR YOUR WEDDING</span>
        <h4>あなたに映える花嫁の見せ方</h4>
        <p class="pc-wd-theme">${t.catch}</p>
      </div>
      <div class="fc-wd-grid">
        <div class="fc-wd-card"><b>💠 ネックライン</b><p>${b.neckline}</p></div>
        <div class="fc-wd-card"><b>💇‍♀️ ヘア</b><p>${b.hair}</p></div>
        <div class="fc-wd-card"><b>💄 メイク</b><p>${b.makeup}</p></div>
        <div class="fc-wd-card"><b>💍 アクセサリー</b><p>${b.accessory}</p></div>
        <div class="fc-wd-card"><b>💐 ブーケ</b><p>${b.bouquet}</p></div>
        <div class="fc-wd-card"><b>👗 ドレス</b><p>${b.dress}</p></div>
        <div class="fc-wd-card"><b>📷 前撮りロケ</b><p>${b.photo}</p></div>
      </div>
    </div>

    <div class="pc-block pc-why"><h4>判定の根拠</h4><ul>${r.reasons.map(x=>`<li>${x}</li>`).join('')}</ul>${notes}</div>

    <div class="fc-disclaimer">
      本コンテンツは、フォトウェディング「Memoro」が写真映えのご提案を目的に独自に作成した<b>簡易セルフチェック</b>です。
      「顔タイプ診断®」（一般社団法人日本顔タイプ診断協会の登録商標）をはじめ、特定の登録商標・診断体系とは<b>一切関係がなく、非公認・非提携</b>です。
      結果は顔写真のAI測定に基づく<b>傾向の目安</b>で、医学的・美容的な診断ではありません。専門家による対面診断の代替ではなく、似合う/似合わないを断定するものでもありません。
      写真の角度・表情・照明・メイクにより結果が変わることがあります。
    </div>

    <div class="pc-actions">
      <button class="lx-btn lx-btn-green" id="pc-restart">別の写真で試す</button>
    </div>
  `;
  drawFaceOverlay($('#pc-face-canvas'));
  $('#pc-restart').addEventListener('click',restart);
}

// ---- 自分の顔にAIが読み取ったライン（三分割・輪郭・目尻）を上品に重ねる ----
// 顔部分にクローズアップして描画（顔分析ビジュアルらしく大きく・クリアに）
function drawFaceOverlay(cv){
  if(!cv || !view.imageData || !(view.face && view.face.raw)) return;
  const raw=view.face.raw, W=view.W, H=view.H, P=DRAW_PTS;

  // 顔のバウンディングボックス（輪郭点から）＋余白
  let minx=1,maxx=0,miny=1,maxy=0;
  FACE_OVAL.forEach(i=>{ const p=raw[i]; if(p.x<minx)minx=p.x; if(p.x>maxx)maxx=p.x; if(p.y<miny)miny=p.y; if(p.y>maxy)maxy=p.y; });
  const bw=maxx-minx, bh=maxy-miny;
  const padX=bw*0.30, padTop=bh*0.34, padBot=bh*0.14;
  const sx=Math.max(0,(minx-padX))*W, sy=Math.max(0,(miny-padTop))*H;
  const ex=Math.min(1,(maxx+padX))*W, ey=Math.min(1,(maxy+padBot))*H;
  const sw=ex-sx, sh=ey-sy;

  const outW=360, outH=Math.max(40, Math.round(outW*sh/sw));
  cv.width=outW; cv.height=outH;
  const c=cv.getContext('2d');
  const off=document.createElement('canvas'); off.width=W; off.height=H;
  off.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(view.imageData),W,H),0,0);
  c.drawImage(off, sx,sy,sw,sh, 0,0,outW,outH);
  // ごく薄いベール（ラインを映えさせる）
  c.fillStyle='rgba(28,24,20,.08)'; c.fillRect(0,0,outW,outH);

  // クロップ空間へ座標変換
  const X=i=>(raw[i].x*W - sx)/sw*outW;
  const Y=i=>(raw[i].y*H - sy)/sh*outH;

  // (1) 輪郭ライン（かたち）＝セージ
  c.strokeStyle='rgba(143,160,131,.95)'; c.lineWidth=2.2; c.lineJoin='round';
  c.beginPath();
  FACE_OVAL.forEach((idx,i)=>{ const x=X(idx),y=Y(idx); i?c.lineTo(x,y):c.moveTo(x,y); });
  c.closePath(); c.stroke();

  // (2) 顔の三分割（おもざし）＝ゴールドの水平線＋右にラベル
  const xL=X(P.cheekL), xR=X(P.cheekR), pad=(xR-xL)*0.14;
  const thirds=[[P.brow,'眉'],[P.subnasale,'鼻下'],[P.chin,'あご']];
  c.setLineDash([5,4]); c.lineWidth=1.4; c.strokeStyle='rgba(184,154,106,.95)';
  c.font='600 11px "Noto Sans JP",sans-serif'; c.textBaseline='middle';
  thirds.forEach(([idx,lab])=>{ const y=Y(idx);
    c.beginPath(); c.moveTo(xL-pad,y); c.lineTo(xR+pad,y); c.stroke();
    c.setLineDash([]); c.fillStyle='rgba(150,120,74,.95)'; c.fillText(lab, xR+pad+4, y); c.setLineDash([5,4]);
  });
  c.setLineDash([]);

  // (3) 目尻の角度（かたち）＝ローズ（目頭〜目尻を外側へ少し延長して角度を見せる）
  c.strokeStyle='rgba(201,138,124,.98)'; c.lineWidth=2.6; c.lineCap='round';
  const eyeLine=(inn,out)=>{
    const ix=X(inn),iy=Y(inn),ox=X(out),oy=Y(out);
    const ex=ox+(ox-ix)*0.5, ey2=oy+(oy-iy)*0.5;   // 目尻側へ50%延長
    c.beginPath(); c.moveTo(ix,iy); c.lineTo(ex,ey2); c.stroke();
  };
  eyeLine(P.eyeL_in,P.eyeL_out); eyeLine(P.eyeR_in,P.eyeR_out);

  // 主要点の白ドット（目頭・目尻）
  [P.eyeL_in,P.eyeL_out,P.eyeR_in,P.eyeR_out].forEach(idx=>{
    c.beginPath(); c.arc(X(idx),Y(idx),3.2,0,Math.PI*2); c.fillStyle='#fff'; c.fill();
    c.lineWidth=1; c.strokeStyle='rgba(71,63,54,.35)'; c.stroke();
  });
}

function restart(){
  view.loaded=false; view.face=null; view.imageData=null; view.canvas=null;
  $('#pc-file-face').value='';
  $('#pc-prev-face').hidden=true;
  setSlotStatus('');
  refreshDiagnoseState();
  $('#pc-result').hidden=true;
  window.scrollTo({top:0,behavior:'smooth'});
}

refreshDiagnoseState();
