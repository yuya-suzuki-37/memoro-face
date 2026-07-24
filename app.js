// ===================================================================
// 顔立ち診断 — メインコントローラ（STEP 2: 土台）
// 顔写真1枚 → (STEP3で)FaceLandmarker解析 → 2軸スコア → 8タイプ → 結果
// ※現在は診断エンジン未実装。__stubDiagnose() が仮の結果を返す（STEP3で差し替え）。
// 表記方針(_knowledge/07): 数値は出さず「〜寄り」の傾向表現。免責は結果と同一ビューに常時可視。
// ===================================================================
import { TYPES, TYPE_ORDER, GRID, AXIS } from './data.js?v=1';

const $=s=>document.querySelector(s);

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

// ===================================================================
// 🚧 STEP 3 で差し替え: 実際の FaceLandmarker 解析＋2軸採点
// 現在はレイアウト確認用の仮結果を返す
// ===================================================================
function __stubDiagnose(){
  return {
    typeId:'soft',            // 判定タイプ
    ageScore:0.15,            // -1(子供) 〜 +1(大人)
    shapeScore:-0.55,         // -1(曲線) 〜 +1(直線)
    ageBand:0, shapeBand:-1,  // 3帯: -1/0/+1
    confidence:'medium',      // medium | low （high は出さない方針）
    mixed:false,
    reasons:['🚧 これは表示確認用の仮結果です（診断エンジンはSTEP 3で実装）'],
    notes:[],
  };
}

$('#pc-diagnose').addEventListener('click', async()=>{
  if(!view.loaded){ setStatus('先に顔写真をアップロードしてください。'); return; }
  showLoading('顔立ちを解析しています…');
  setTimeout(()=>{
    hideLoading();
    renderResult(__stubDiagnose());
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
  $('#pc-restart').addEventListener('click',restart);
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
