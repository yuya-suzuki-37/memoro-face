// ===================================================================
// analyzer.js — FaceLandmarker(478点)から顔の形状特徴を抽出（出典: _knowledge/03,08）
// 前処理: ロール正規化（両目を水平化）→ 品質ゲート（ヨー/ピッチ/薄目/笑み）→ 特徴量
// すべて顔幅W=bizygomatic(234-454)で無次元化。角度はロール正規化後に算出。
// ===================================================================

// ---- ランドマークindex（MediaPipe canonical face mesh。実装確認済みの代表点） ----
const P = {
  faceTop:10, chin:152, cheekL:234, cheekR:454,
  nasion:168, subnasale:2, noseTip:1,
  browL:105, browR:334,
  // 左目: 外33 内133 上159 下145 ／ 右目: 内362 外263 上386 下374
  eyeL_out:33, eyeL_in:133, eyeL_top:159, eyeL_bot:145,
  eyeR_in:362, eyeR_out:263, eyeR_top:386, eyeR_bot:374,
  irisL:468, irisR:473,
  jawL:172, jawR:397,
  mouthL:61, mouthR:291, lipTop:13, lipBot:14,
};

const dist=(a,b)=> Math.hypot(a.x-b.x, a.y-b.y);
const mid=(a,b)=> ({x:(a.x+b.x)/2, y:(a.y+b.y)/2});
const clamp=(v,lo,hi)=> Math.max(lo,Math.min(hi,v));
const deg=r=> r*180/Math.PI;

// ---- ロール正規化: 両目(虹彩)を水平にするよう全点を回転 ----
function rollNormalize(lm){
  const iL=lm[P.irisL]||mid(lm[P.eyeL_out],lm[P.eyeL_in]);
  const iR=lm[P.irisR]||mid(lm[P.eyeR_out],lm[P.eyeR_in]);
  const theta=Math.atan2(iR.y-iL.y, iR.x-iL.x); // 目線の傾き
  const c=Math.cos(-theta), s=Math.sin(-theta);
  const cx=(iL.x+iR.x)/2, cy=(iL.y+iR.y)/2;
  const out=lm.map(p=>{
    const dx=p.x-cx, dy=p.y-cy;
    return { x:cx+dx*c-dy*s, y:cy+dx*s+dy*c, z:p.z };
  });
  return { lm:out, rollDeg:Math.abs(deg(theta)) };
}

// ---- ヨー（左右向き）: 鼻先が頬骨中点からどれだけ横にずれているか ----
function estimateYaw(lm){
  const cxFace=(lm[P.cheekL].x+lm[P.cheekR].x)/2;
  const W=Math.abs(lm[P.cheekR].x-lm[P.cheekL].x)||1e-4;
  const off=(lm[P.noseTip].x-cxFace)/W;        // 0=正面, ±=横向き
  return Math.abs(off)*90;                       // ざっくり度数
}
// ---- ピッチ（上下向き）: 変換行列があれば分解、無ければ0 ----
function estimatePitch(matrix){
  if(!matrix||!matrix.data||matrix.data.length<16) return null;
  const d=matrix.data; // column-major 4x4
  // 回転部 R（row-major）: R12=d[9], R22=d[10]
  const pitch=Math.atan2(-d[9], d[10]);
  return Math.abs(deg(pitch));
}

// ---- 顎の左右対称な目尻角度（canthal tilt, 度） ----
// 各目: 中心に近い方=内, 遠い方=外。外が上(=y小)なら正(上がり/切れ長)。
function canthalTilt(lm){
  const cx=(lm[P.cheekL].x+lm[P.cheekR].x)/2;
  const tiltOf=(a,b)=>{ // a,b: 目の両端
    const inner = Math.abs(a.x-cx)<Math.abs(b.x-cx)? a:b;
    const outer = inner===a? b:a;
    const dx=Math.abs(outer.x-inner.x)||1e-4;
    return deg(Math.atan2(inner.y-outer.y, dx)); // 外が上→正
  };
  const tL=tiltOf(lm[P.eyeL_out], lm[P.eyeL_in]);
  const tR=tiltOf(lm[P.eyeR_out], lm[P.eyeR_in]);
  return (tL+tR)/2;
}

export function extractFace(result){
  const faces=result && result.faceLandmarks;
  if(!faces || !faces.length) return { ok:false, reason:'顔を検出できませんでした。明るく・正面・顔がはっきり写った写真でお試しください。' };
  // 複数顔なら最大の顔を採用
  let lm0=faces[0];
  if(faces.length>1){
    let best=-1; faces.forEach(f=>{ let minx=1,maxx=0; f.forEach(p=>{ if(p.x<minx)minx=p.x; if(p.x>maxx)maxx=p.x; }); const w=maxx-minx; if(w>best){best=w; lm0=f;} });
  }

  const { lm, rollDeg } = rollNormalize(lm0);
  const W = dist(lm[P.cheekL], lm[P.cheekR]) || 1e-4;
  const yTop=lm[P.faceTop].y, yChin=lm[P.chin].y, yNas=lm[P.nasion].y, ySub=lm[P.subnasale].y;
  const faceH_nas = (yChin - yNas) || 1e-4;   // 鼻根〜顎（y10非依存）
  const faceH_top = (yChin - yTop) || 1e-4;

  // 目
  const eyeLc=mid(lm[P.eyeL_out], lm[P.eyeL_in]);
  const eyeRc=mid(lm[P.eyeR_out], lm[P.eyeR_in]);
  const eyeCy=(eyeLc.y+eyeRc.y)/2;
  const eyeW_L=dist(lm[P.eyeL_out], lm[P.eyeL_in]);
  const eyeW_R=dist(lm[P.eyeR_out], lm[P.eyeR_in]);
  const eyeW=(eyeW_L+eyeW_R)/2;
  const eyeH_L=dist(lm[P.eyeL_top], lm[P.eyeL_bot]);
  const eyeH_R=dist(lm[P.eyeR_top], lm[P.eyeR_bot]);
  const eyeH=(eyeH_L+eyeH_R)/2;

  // ---- 特徴量 ----
  const features = {
    lowerFace:  (yChin - ySub)/faceH_nas,        // 下顔面比（中心0.50）
    faceAspect: faceH_nas / W,                    // 縦横比（中心0.87）
    eyeLevel:   (eyeCy - yTop)/faceH_top,         // 目の縦位置（中心0.40・大=目が下=子供）
    eyeSize:    eyeW / W,                          // 目幅/顔幅（中心0.225・大=子供）
    canthalTilt: canthalTilt(lm),                 // 目尻角度 度（中心+5）
    eyeRound:   eyeH / (eyeW||1e-4),               // 目の縦横比（中心0.32・大=丸目）
    jawWidth:   dist(lm[P.jawL], lm[P.jawR]) / W,  // 顎幅/頬骨幅（中心0.78・低信頼）
  };

  // ---- 品質 ----
  const yawDeg=estimateYaw(lm);
  const pitchDeg=estimatePitch(result.facialTransformationMatrixes && result.facialTransformationMatrixes[0]);
  // blendshapes（あれば）: 薄目・笑み・口開け
  let eyeOpen=null, smile=null;
  const bs=result.faceBlendshapes && result.faceBlendshapes[0] && result.faceBlendshapes[0].categories;
  if(bs){
    const get=n=>{ const c=bs.find(x=>x.categoryName===n); return c?c.score:0; };
    eyeOpen = 1 - (get('eyeBlinkLeft')+get('eyeBlinkRight'))/2;
    smile   = (get('mouthSmileLeft')+get('mouthSmileRight'))/2;
  } else {
    // 幾何フォールバック: 目の開き=eyeRound、笑み=口幅/顔幅の大きさで代用
    eyeOpen = clamp(features.eyeRound/0.32, 0, 1.5);
    smile   = clamp(dist(lm[P.mouthL],lm[P.mouthR])/W/0.9, 0, 1.2);
  }

  const quality={ rollDeg, yawDeg, pitchDeg, eyeOpen, smile, warnings:[], flags:{} };

  return { ok:true, features, quality, lm, raw:lm0, faceTopY:yTop, chinY:yChin, W };
}

// 顔の輪郭ライン用（MediaPipe FACE_OVAL の点列・描画用に公開）
export const FACE_OVAL=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
// 描画で使う主要点（元画像座標）: 三分割・目尻・眉
export const DRAW_PTS={ top:10, brow:9, subnasale:2, chin:152, cheekL:234, cheekR:454,
  eyeL_out:33, eyeL_in:133, eyeR_in:362, eyeR_out:263, browL:105, browR:334 };
