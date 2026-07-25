// ===================================================================
// diagnosis.js — 特徴量 → 2軸スコア → 8タイプ（出典: _knowledge/02,03,07,08）
// 方針(07): 下顔面比を主軸重視／輪郭系は低信頼／メイク・姿勢交絡は減点／
//          確信度は「目安・参考」の2段階（高は出さない）／UIは傾向表現。
// ===================================================================
import { GRID } from './data.js?v=1';
import { CALIB } from './calib.js?v=4';

const clamp=(v,lo=-1,hi=1)=> Math.max(lo,Math.min(hi,v));

// 指標を [-1,+1] へ（dir で子供/曲線=負に揃える）
function norm(x, c){ return clamp(((x - c.center)/c.half) * c.dir); }

export function diagnose(features, quality){
  const f=features, q=quality||{}, J=CALIB.judge;
  const warn=[], notes=[];

  // ---- 品質ゲート → 重み調整係数 ----
  const yawBad   = q.yawDeg!=null && q.yawDeg > J.maxYawDeg;
  const pitchBad = q.pitchDeg!=null && q.pitchDeg > J.maxPitchDeg;
  const squint   = q.eyeOpen!=null && q.eyeOpen < J.minEyeOpen;
  const smiling  = q.smile!=null && q.smile > J.smileMax;
  if(yawBad)   warn.push('顔が横を向いています（正面で撮り直すと精度が上がります）');
  if(pitchBad) warn.push('顔が上／下を向いています（カメラを目の高さで水平に）');
  if(squint)   warn.push('目が細まっています（自然に開いた状態で）');
  if(smiling)  warn.push('笑顔で目・口の形が変化しています（無表情がおすすめ）');

  // 縦比系は姿勢(ピッチ/ヨー)に弱い。目系は薄目・笑みに弱い。
  const kVert = (yawBad||pitchBad) ? 0.5 : 1.0;
  const kEye  = (squint||smiling) ? 0.4 : 1.0;

  // ---- おもざし軸 S_age（多重信号: 縦横比＋目の位置＋輪郭の顎/あご） ----
  const A=CALIB.age;
  const ageTerms=[
    { v:norm(f.faceAspect, A.faceAspect),  w:A.faceAspect.w  * kVert },
    { v:norm(f.eyeLevel,   A.eyeLevel),    w:A.eyeLevel.w    * kVert },
    { v:norm(f.gonialAngle,A.gonialAngle), w:A.gonialAngle.w * kVert }, // エラ角（輪郭・pose感受）
    { v:norm(f.chinAngle,  A.chinAngle),   w:A.chinAngle.w   * kVert }, // あご先角（輪郭・pose感受）
    { v:norm(f.lowerFace,  A.lowerFace),   w:A.lowerFace.w   * kVert },
    { v:norm(f.eyeSize,    A.eyeSize),     w:A.eyeSize.w     * kEye  },
  ];
  const S_age=wsum(ageTerms);

  // ---- かたち軸 S_shape ----
  const S=CALIB.shape;
  const shapeTerms=[
    { v:norm(f.canthalTilt,S.canthalTilt), w:S.canthalTilt.w * kEye },
    { v:norm(f.eyeRound,   S.eyeRound),    w:S.eyeRound.w   * kEye },
    { v:norm(f.jawWidth,   S.jawWidth),    w:S.jawWidth.w }, // 低信頼・小重み
  ];
  const S_shape=wsum(shapeTerms);

  // ---- 3帯化 ----
  const band=s=> s<=-J.bandMid ? -1 : s>=J.bandMid ? +1 : 0;
  let ageBand=band(S_age), shapeBand=band(S_shape);
  let mixed = Math.abs(Math.abs(S_age)-J.bandMid)<J.mixMargin || Math.abs(Math.abs(S_shape)-J.bandMid)<J.mixMargin;

  // 中央(0,0)は大きい方の軸で最近傍のエッジへ寄せてミックス表示
  if(ageBand===0 && shapeBand===0){
    if(Math.abs(S_age)>=Math.abs(S_shape)) ageBand = S_age>=0?1:-1;
    else shapeBand = S_shape>=0?1:-1;
    mixed=true;
  }

  // ---- タイプ割付（GRID: 行=おもざし[子供0/中1/大人2], 列=かたち[曲線0/中1/直線2]） ----
  const row = ageBand+1, col = shapeBand+1;
  const typeId = GRID[row][col];

  // ---- 確信度（高は出さない） ----
  const nonDiagonal = (typeId==='natural' || typeId==='glamour'); // 子供×直線 / 大人×曲線（過疎・07）
  let conf=1;
  // どちらか一軸が明確に振れていれば「目安」に（両軸とも極端でなくてよい）
  if(Math.max(Math.abs(S_age), Math.abs(S_shape))>=0.33) conf++;
  if(yawBad||pitchBad) conf--;
  if(squint||smiling) conf--;
  if(nonDiagonal){ conf--; notes.push('この組み合わせ（子供顔×直線／大人顔×曲線）は判別が難しめのため控えめに表示しています'); }
  if(mixed) notes.push('軸が中間寄りのため「ミックス」として提示しています');
  const confidence = conf>=2 ? 'medium' : 'low';

  // ---- 根拠（UIは傾向表現・数値は出さない：07） ----
  const ageWord   = S_age  <=-0.33?'子供っぽい寄り' : S_age  >=0.33?'大人っぽい寄り' : 'どちらとも';
  const shapeWord = S_shape<=-0.33?'曲線的寄り'     : S_shape>=0.33?'直線的寄り'     : 'どちらとも';
  const reasons=[
    `おもざし（世代の印象）：${ageWord}（顔の縦横比・下顔面の長さ・目の位置から）`,
    `かたち（輪郭とパーツ）：${shapeWord}（目の丸み・目尻の角度などから）`,
  ];
  if(warn.length) reasons.push('※ ' + warn.join(' / '));

  return {
    typeId, ageScore:S_age, shapeScore:S_shape, ageBand, shapeBand,
    confidence, mixed, reasons, notes, warnings:warn,
  };
}

function wsum(terms){
  let s=0,w=0;
  for(const t of terms){ if(t.w>0 && isFinite(t.v)){ s+=t.v*t.w; w+=t.w; } }
  return w>0 ? clamp(s/w) : 0;
}
