'use strict';
// sim5p.js — 5-Player President, Build 40 AI, conquest mode
// node sim5p.js   — runs 4 rule-set variants to compare role mobility + style balance

const SUITS  = ['♠','♥','♦','♣'];
const VALUES = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const ROLES  = ['President','Vice President','Neutral','Vice Wiper','Wiper'];
const CONQUEST_TARGET = 100;
const NUM_GAMES = 100;
const N = 5;
const FIXED_STYLES = ['conservative','neutral','neutral','neutral','aggressive'];

// ── Card helpers ──────────────────────────────────────────────────────────────
function buildDeck() {
  const d=[];
  for (const s of SUITS) for (const v of VALUES) d.push({suit:s,value:v,rank:VALUES.indexOf(v)});
  return d;
}
function shuffle(d) {
  const a=[...d];
  for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function isTrump(c){return c.value==='2';}
function sortHand(h){
  return[...h].sort((a,b)=>a.rank!==b.rank?a.rank-b.rank:SUITS.indexOf(a.suit)-SUITS.indexOf(b.suit));
}
function rankSum(h){return h.reduce((s,c)=>s+c.rank,0);}

// ── Hand assessment & target ──────────────────────────────────────────────────
function assessHand(hand){
  const g={};
  hand.forEach(c=>{g[c.value]=g[c.value]||[];g[c.value].push(c);});
  const twos=(g['2']||[]).length,aces=(g['A']||[]).length,kings=(g['K']||[]).length;
  const highPairs=Object.values(g).filter(gr=>gr[0].rank>=8&&gr[0].value!=='2'&&gr.length>=2).length;
  return{twos,aces,kings,highPairs,score:twos*5+aces*2+kings*1.5+highPairs*2};
}
function getTarget(player){
  const m=assessHand(player.hand);
  const roleOrder={'President':0,'Vice President':1,'Neutral':2,'Vice Wiper':3,'Wiper':4};
  const rank=player.role!=null?(roleOrder[player.role]??2):2;
  if(m.score>=8)return'top';
  if(m.score>=4)return rank>=3?'middle':'top';
  return rank>=3?'survive':'middle';
}

// ── AI helpers (Build 40) ─────────────────────────────────────────────────────
function rollLeadGroup(style,target){
  const p=style==='neutral'?(target==='top'?0.72:0.55):(target==='top'?0.48:0.25);
  return Math.random()<p;
}

function rollBreak(style,rank,pileRank,target){
  const base=style==='aggressive'?0.90
           : style==='neutral'   ?Math.min(0.85,0.10+rank*0.07)
           : target==='top'      ?Math.min(0.78,0.12+rank*0.06)
           :                      Math.min(0.65,0.05+rank*0.05);
  const pileAdj=(pileRank-5)*0.03;
  return Math.random()<Math.min(0.95,Math.max(0.02,base+pileAdj));
}

function rollTrump(twos,handSize,pileRank,style,target,twosStillOut){
  const sizeScore=Math.max(0,Math.min(1,(12-handSize)/9));
  const twoScore=Math.min(1,(twos.length-1)/2);
  const rankScore=Math.max(0,Math.min(1,(pileRank-6)/5));
  const styleAdj=style==='aggressive'?0.10:style==='conservative'?-0.10:0;
  const targetAdj=target==='top'?0.10:0;
  const allTwosAdj=twosStillOut===0?0.30:twosStillOut===1?0.10:0;
  const prob=Math.min(0.93,Math.max(0.03,
    sizeScore*0.35+twoScore*0.30+rankScore*0.35+styleAdj+targetAdj+allTwosAdj));
  return Math.random()<prob;
}

// ── AI lead ───────────────────────────────────────────────────────────────────
function aiLead(nonTwoGroups,twos,hand,style,target,iHoldAllTwos){
  if(nonTwoGroups.length===0&&twos.length>0)return twos;
  if(hand.length===2&&twos.length>0&&nonTwoGroups.length>0)return[twos[0]];
  if(target!=='survive'&&twos.length>0&&nonTwoGroups.length===1){
    if(hand.length-nonTwoGroups[0].length===twos.length)return[twos[0]];
  }
  if(target==='top'){
    if(iHoldAllTwos&&hand.length<=5){
      const ag=nonTwoGroups.find(g=>g[0].value==='A');
      if(ag)return[ag[0]];
    }
    if(twos.length>0&&hand.length<=4&&nonTwoGroups.length>0)return nonTwoGroups[nonTwoGroups.length-1];
    if(style==='aggressive'){
      const bc=[...nonTwoGroups].sort((a,b)=>b.length!==a.length?b.length-a.length:a[0].rank-b[0].rank);
      if(bc.length>0)return bc[0];
    }else{
      if(nonTwoGroups.length>0){
        const c=nonTwoGroups[0];
        if(c.length>=3&&!rollLeadGroup(style,target)){
          const sg=nonTwoGroups.filter(g=>g.length===1);
          return sg.length>0?[sg[0][0]]:[c[0]];
        }
        return c;
      }
    }
    if(twos.length>0)return[twos[0]];
    return[hand[0]];
  }
  if(target==='survive'){
    const sg=nonTwoGroups.filter(g=>g.length===1);
    if(sg.length>0)return[sg[0][0]];
    const bs=[...nonTwoGroups].sort((a,b)=>a.length-b.length||a[0].rank-b[0].rank);
    if(bs.length>0)return[bs[0][0]];
    if(twos.length>0)return[twos[0]];
    return[hand[0]];
  }
  // middle
  if(style==='aggressive'){
    const bc=[...nonTwoGroups].sort((a,b)=>b.length!==a.length?b.length-a.length:a[0].rank-b[0].rank);
    if(bc.length>0)return bc[0];
    if(twos.length>0)return[twos[0]];
    return[hand[0]];
  }
  if(twos.length>0&&hand.length<=4&&nonTwoGroups.length>0)return nonTwoGroups[nonTwoGroups.length-1];
  if(nonTwoGroups.length>0){
    const c=nonTwoGroups[0];
    if(c.length>=3&&!rollLeadGroup(style,target)){
      const sg=nonTwoGroups.filter(g=>g.length===1);
      return sg.length>0?[sg[0][0]]:[c[0]];
    }
    return c;
  }
  if(twos.length>0)return[twos[0]];
  return[hand[0]];
}

// ── AI follow (Build 40) ──────────────────────────────────────────────────────
function aiFollow(nonTwoGroups,twos,pileCount,pileRank,style,target,hand,valuePlayed,leaderHandSize){
  const beaters=nonTwoGroups.filter(g=>g.length>=pileCount&&g[0].rank>pileRank).sort((a,b)=>a[0].rank-b[0].rank);
  const handSize=hand.length;
  const lowestBeater=beaters[0]||null;
  const playRank=lowestBeater?lowestBeater[0].rank:-1;
  const higherAfter=lowestBeater?hand.filter(c=>c.value!=='2'&&c.rank>playRank).length:0;
  const twosStillOut=(4-(valuePlayed['2']||0))-twos.length;

  const pileOnlyTrumpable=(()=>{
    for(let r=pileRank+1;r<=11;r++){if((valuePlayed[VALUES[r]]||0)<4)return false;}
    return true;
  })();
  const leaderLikelyHas2=(()=>{
    if(leaderHandSize===undefined||!pileOnlyTrumpable)return false;
    const bp=leaderHandSize===1?0.82:leaderHandSize===2?0.58:leaderHandSize<=4?0.32:0;
    if(bp===0)return false;
    const so=style==='aggressive'?-0.12:style==='conservative'?0.10:0;
    return Math.random()<Math.min(0.93,Math.max(0,bp+so));
  })();
  const canTrump=twos.length>0&&!leaderLikelyHas2;

  if(lowestBeater&&handSize===pileCount)return lowestBeater.slice(0,pileCount);
  if(!lowestBeater&&twos.length>0&&twos.length===handSize){
    if(twos.length===pileCount)return twos;
    if(twos.length===1)return[twos[0]];
  }
  if(!leaderLikelyHas2&&target!=='survive'&&lowestBeater&&twos.length>=pileCount&&handSize-pileCount===twos.length)
    return twos.slice(0,pileCount);
  if(twosStillOut===0&&twos.length>=pileCount&&!lowestBeater){
    const nna=hand.filter(c=>c.value!=='2'&&c.value!=='A');
    if(nna.length===0)return twos.slice(0,pileCount);
  }

  if(target==='top'){
    if(lowestBeater){
      if(pileCount===1&&lowestBeater.length>1&&!rollBreak(style,lowestBeater[0].rank,pileRank,target))return null;
      return lowestBeater.slice(0,pileCount);
    }
    if(canTrump&&rollTrump(twos,handSize,pileRank,style,target,twosStillOut))return[twos[0]];
    return null;
  }
  if(target==='survive'){
    if(!lowestBeater){
      const ter=style==='conservative'?11:10;
      if(canTrump&&pileRank>=ter&&rollTrump(twos,handSize,pileRank,style,target,twosStillOut))return[twos[0]];
      return null;
    }
    if(pileCount===1&&lowestBeater.length>1){
      const tt=style==='conservative'?11:style==='neutral'?10:9;
      if(canTrump&&pileRank>=tt&&rollTrump(twos,handSize,pileRank,style,target,twosStillOut))return[twos[0]];
      return null;
    }
    const bt=style==='conservative'?6:style==='neutral'?8:9;
    const threshold=twosStillOut===0?Math.max(bt,11):bt;
    if(playRank<=threshold&&higherAfter>=1)return lowestBeater.slice(0,pileCount);
    const tt=style==='conservative'?11:style==='neutral'?10:9;
    if(canTrump&&pileRank>=tt&&rollTrump(twos,handSize,pileRank,style,target,twosStillOut))return[twos[0]];
    return null;
  }
  // middle
  if(style==='conservative'){
    if(lowestBeater){
      if(pileCount===1&&lowestBeater.length>1&&!rollBreak(style,lowestBeater[0].rank,pileRank,target))return null;
      if(higherAfter===0&&handSize>pileCount+1)return null;
      return lowestBeater.slice(0,pileCount);
    }
    if(canTrump&&rollTrump(twos,handSize,pileRank,style,target,twosStillOut))return[twos[0]];
    return null;
  }
  if(style==='neutral'){
    if(lowestBeater){
      if(pileCount===1&&lowestBeater.length>1&&!rollBreak(style,lowestBeater[0].rank,pileRank,target))return null;
      return lowestBeater.slice(0,pileCount);
    }
    if(canTrump&&rollTrump(twos,handSize,pileRank,style,target,twosStillOut))return[twos[0]];
    return null;
  }
  if(lowestBeater){
    if(pileCount===1&&lowestBeater.length>1&&!rollBreak(style,lowestBeater[0].rank,pileRank,target))return null;
    return lowestBeater.slice(0,pileCount);
  }
  if(canTrump&&rollTrump(twos,handSize,pileRank,style,target,twosStillOut))return[twos[0]];
  return null;
}

function aiChoosePlay(hand,pile,style,target,valuePlayed,leaderHandSize){
  const pileCount=pile.length,pileRank=pileCount>0?pile[0].rank:-1;
  const groups={};
  hand.forEach(c=>{groups[c.value]=groups[c.value]||[];groups[c.value].push(c);});
  const ntg=Object.values(groups).filter(g=>g[0].value!=='2').sort((a,b)=>a[0].rank-b[0].rank);
  const twos=groups['2']||[];
  const iHoldAllTwos=twos.length>0&&twos.length>=(4-(valuePlayed['2']||0));
  return pileCount===0
    ?aiLead(ntg,twos,hand,style,target,iHoldAllTwos)
    :aiFollow(ntg,twos,pileCount,pileRank,style,target,hand,valuePlayed,leaderHandSize);
}

// ── Trading ───────────────────────────────────────────────────────────────────
function doTrading(players){
  const presIdx=players.findIndex(p=>p.role==='President');
  const assIdx =players.findIndex(p=>p.role==='Wiper');
  const vpIdx  =players.findIndex(p=>p.role==='Vice President');
  const vaIdx  =players.findIndex(p=>p.role==='Vice Wiper');

  function takeTop(hand,count){
    const s=[...hand].sort((a,b)=>b.rank-a.rank).slice(0,count);
    s.forEach(c=>{const i=hand.findIndex(h=>h.suit===c.suit&&h.value===c.value);if(i!==-1)hand.splice(i,1);});
    return s;
  }
  function giveWorst(from,to,excl,count){
    const ek=new Set(excl.map(c=>c.suit+c.value));
    const pool=from.filter(c=>!ek.has(c.suit+c.value));
    const src=pool.length>=count?pool:from;
    [...src].sort((a,b)=>a.rank-b.rank).slice(0,count).forEach(c=>{
      const i=from.findIndex(h=>h.suit===c.suit&&h.value===c.value);
      if(i!==-1)from.splice(i,1);
      to.push(c);
    });
  }

  const r={presGain:0,wiperLoss:0,vpGain:0,vaLoss:0};
  if(presIdx>=0&&assIdx>=0){
    const pb=rankSum(players[presIdx].hand),wb=rankSum(players[assIdx].hand);
    const recv=takeTop(players[assIdx].hand,1);
    recv.forEach(c=>players[presIdx].hand.push(c));
    players[presIdx].hand=sortHand(players[presIdx].hand);
    giveWorst(players[presIdx].hand,players[assIdx].hand,recv,1);
    players[assIdx].hand=sortHand(players[assIdx].hand);
    r.presGain=rankSum(players[presIdx].hand)-pb;
    r.wiperLoss=wb-rankSum(players[assIdx].hand);
  }
  if(vpIdx>=0&&vaIdx>=0){
    const vb=rankSum(players[vpIdx].hand),ab=rankSum(players[vaIdx].hand);
    const recv=takeTop(players[vaIdx].hand,1);
    recv.forEach(c=>players[vpIdx].hand.push(c));
    players[vpIdx].hand=sortHand(players[vpIdx].hand);
    giveWorst(players[vpIdx].hand,players[vaIdx].hand,recv,1);
    players[vaIdx].hand=sortHand(players[vaIdx].hand);
    r.vpGain=rankSum(players[vpIdx].hand)-vb;
    r.vaLoss=ab-rankSum(players[vaIdx].hand);
  }
  return r;
}

// ── Kitty exchange ────────────────────────────────────────────────────────────
function doKittyExchange(players,kitty){
  let gain=0;
  players.forEach(p=>{
    const sk=[...kitty].sort((a,b)=>b.rank-a.rank);
    const sh=[...p.hand].sort((a,b)=>a.rank-b.rank);
    const give=[],take=[];
    for(let i=0;i<sk.length&&i<sh.length;i++){
      if(sk[i].rank>sh[i].rank){take.push(sk[i]);give.push(sh[i]);}else break;
    }
    const before=rankSum(p.hand);
    take.forEach(c=>{const i=kitty.findIndex(k=>k.suit===c.suit&&k.value===c.value);if(i!==-1)kitty.splice(i,1);p.hand.push(c);});
    give.forEach(c=>{const i=p.hand.findIndex(h=>h.suit===c.suit&&h.value===c.value);if(i!==-1)p.hand.splice(i,1);kitty.push(c);});
    p.hand=sortHand(p.hand);
    gain+=rankSum(p.hand)-before;
  });
  return gain;
}

// ── Roles / scoring ───────────────────────────────────────────────────────────
function assignRoles(players,finishOrder){
  players.forEach(p=>p.role=null);
  if(finishOrder[0]!==undefined)players[finishOrder[0]].role='President';
  if(finishOrder[N-1]!==undefined)players[finishOrder[N-1]].role='Wiper';
  if(finishOrder[1]!==undefined)players[finishOrder[1]].role='Vice President';
  if(finishOrder[N-2]!==undefined)players[finishOrder[N-2]].role='Vice Wiper';
  players.forEach(p=>{if(!p.role)p.role='Neutral';});
}
function reorderSeats(players,finishOrder){
  const ro={'President':0,'Vice President':1,'Neutral':2,'Vice Wiper':3,'Wiper':4};
  const fp={};finishOrder.forEach((idx,pos)=>{fp[idx]=pos;});
  const wi=players.map((p,i)=>({p,i}));
  wi.sort((a,b)=>{const ra=ro[a.p.role]??2,rb=ro[b.p.role]??2;return ra!==rb?ra-rb:(fp[a.i]??99)-(fp[b.i]??99);});
  return wi.map(x=>x.p);
}
function scoreRound(players,finishOrder){
  finishOrder.forEach((pidx,pos)=>{
    let d=0;
    if(pos===0)d=10;else if(pos===1)d=5;else if(pos===N-1)d=-1;else if(pos===2)d=1;
    players[pidx].scoreTotal=(players[pidx].scoreTotal||0)+d;
  });
}

// ── Round simulation ──────────────────────────────────────────────────────────
function simulateRound(players,valuePlayed,stats){
  players.forEach(p=>{p.finished=false;});
  let pile=[],trickLeader=0,currentTurn=0,trickTurns=0,trickPlayerCount=N,lastPlayedBy=0;
  const finishOrder=[];

  function nextActive(from){let next=(from+1)%N,l=0;while(players[next].finished&&l<N){next=(next+1)%N;l++;}return next;}
  function endTrick(w){
    pile=[];trickTurns=0;
    const active=players.filter(p=>!p.finished);
    if(active.length<=1)return true;
    trickPlayerCount=active.length;
    const ww=players[w].finished?nextActive(w):w;
    trickLeader=ww;currentTurn=ww;return false;
  }
  function checkEnd(){
    const active=players.filter(p=>!p.finished);
    if(active.length<=1){const last=players.find(p=>!p.finished);if(last){last.finished=true;finishOrder.push(players.indexOf(last));}return true;}
    return false;
  }

  let maxIter=20000;
  while(!checkEnd()&&maxIter-->0){
    const pidx=currentTurn;
    const player=players[pidx];
    const lhs=pile.length>0?players[lastPlayedBy].hand.length:undefined;
    const play=aiChoosePlay(player.hand,pile,player.style,player.target,valuePlayed,lhs);

    if(play){
      stats.style[player.style].plays++;
      if(isTrump(play[0]))stats.style[player.style].twoPlays++;
      play.forEach(c=>{const i=player.hand.findIndex(h=>h.suit===c.suit&&h.value===c.value);if(i!==-1)player.hand.splice(i,1);});
      pile=play;trickLeader=pidx;lastPlayedBy=pidx;trickTurns++;
      valuePlayed[play[0].value]=(valuePlayed[play[0].value]||0)+play.length;
      if(player.hand.length===0){player.finished=true;finishOrder.push(pidx);}
      if(isTrump(play[0])){if(checkEnd())break;if(endTrick(pidx))break;continue;}
      if(checkEnd())break;
      if(trickTurns>=trickPlayerCount){if(endTrick(trickLeader))break;continue;}
      currentTurn=nextActive(pidx);
    }else{
      stats.style[player.style].passes++;
      trickTurns++;
      if(trickTurns>=trickPlayerCount){if(endTrick(trickLeader))break;continue;}
      currentTurn=nextActive(pidx);
    }
  }
  return finishOrder;
}

// ── Stats factory ─────────────────────────────────────────────────────────────
function makeStats(){
  const style={};
  ['conservative','neutral','aggressive'].forEach(s=>{
    style[s]={plays:0,passes:0,twoPlays:0,finishPos:[0,0,0,0,0],rounds:0};
  });
  const roleTrans={};
  ROLES.forEach(r=>{roleTrans[r]={};ROLES.forEach(r2=>{roleTrans[r][r2]=0;});});
  return{style,roleTrans,totalRounds:0,roundsPerGame:[],
    trade:{presGain:0,wiperLoss:0,vpGain:0,vaLoss:0,count:0},
    kittyGain:0,kittyRounds:0};
}

// ── Single simulation run ─────────────────────────────────────────────────────
function runSim(rules){
  const stats=makeStats();
  for(let g=0;g<NUM_GAMES;g++){
    let players=FIXED_STYLES.map((style,i)=>({
      name:`P${i}`,hand:[],role:null,finished:false,style,target:'middle',scoreTotal:0,
    }));
    let finishOrder=[],roundNum=0;

    while(!players.some(p=>p.scoreTotal>=CONQUEST_TARGET)&&roundNum<300){
      roundNum++;
      if(roundNum>1)players=reorderSeats(players,finishOrder);
      const prevRoles=roundNum>1?players.map(p=>p.role):null;

      const deck=shuffle(buildDeck());
      const cardsEach=Math.floor(deck.length/N);
      const kitty=deck.slice(cardsEach*N);
      players.forEach(p=>{p.hand=[];p.finished=false;});
      deck.slice(0,cardsEach*N).forEach((card,i)=>players[i%N].hand.push(card));
      players.forEach(p=>{p.hand=sortHand(p.hand);});

      if(rules.trading&&roundNum>1&&players.some(p=>p.role==='President')){
        const ts=doTrading(players);
        stats.trade.presGain+=ts.presGain;stats.trade.wiperLoss+=ts.wiperLoss;
        stats.trade.vpGain+=ts.vpGain;stats.trade.vaLoss+=ts.vaLoss;
        stats.trade.count++;
      }
      if(rules.kitty&&roundNum>1&&kitty.length>0){
        stats.kittyGain+=doKittyExchange(players,kitty);
        stats.kittyRounds++;
      }

      players.forEach(p=>{p.target=getTarget(p);});

      const valuePlayed={};
      finishOrder=simulateRound(players,valuePlayed,stats);
      stats.totalRounds++;
      scoreRound(players,finishOrder);
      assignRoles(players,finishOrder);

      if(prevRoles){
        players.forEach((p,i)=>{
          const prev=prevRoles[i];
          if(prev&&p.role)stats.roleTrans[prev][p.role]++;
        });
      }
      finishOrder.forEach((pidx,pos)=>{
        const s=players[pidx].style;
        stats.style[s].finishPos[pos]++;
        stats.style[s].rounds++;
      });
    }
    stats.roundsPerGame.push(roundNum);
  }
  return stats;
}

// ── Report ────────────────────────────────────────────────────────────────────
const rs={'President':'Pres','Vice President':'VP  ','Neutral':'Neut','Vice Wiper':'VA  ','Wiper':'Wiper'};

function printReport(label,stats){
  const W=64;
  console.log('\n╔'+'═'.repeat(W)+'╗');
  console.log('║  '+label.padEnd(W-1)+'║');
  console.log('╚'+'═'.repeat(W)+'╝');

  const avgR=(stats.roundsPerGame.reduce((a,b)=>a+b,0)/NUM_GAMES).toFixed(1);
  const minR=Math.min(...stats.roundsPerGame),maxR=Math.max(...stats.roundsPerGame);
  console.log(`  Rounds/game: avg ${avgR}  min ${minR}  max ${maxR}   total ${stats.totalRounds}`);

  // Style table
  console.log('\n  Style        AvgPos  Win%   Last%  Pass%  2-play%');
  console.log('  '+'-'.repeat(54));
  for(const[style,ss]of Object.entries(stats.style)){
    const r=ss.rounds;if(!r)continue;
    const avgPos=(ss.finishPos.reduce((s,c,i)=>s+c*(i+1),0)/r).toFixed(2);
    const win=(ss.finishPos[0]/r*100).toFixed(1);
    const last=(ss.finishPos[N-1]/r*100).toFixed(1);
    const act=ss.plays+ss.passes;
    const pass=(ss.passes/act*100).toFixed(1);
    const two=(ss.twoPlays/Math.max(ss.plays,1)*100).toFixed(1);
    console.log(`  ${style.padEnd(13)}${avgPos.padStart(6)}  ${win.padStart(5)}  ${last.padStart(5)}  ${pass.padStart(5)}  ${two.padStart(6)}`);
  }

  // Role transition — just the diagonal (retention) + escape rates for Wiper
  console.log('\n  Role retention (stayed in same role next round):');
  ROLES.forEach(from=>{
    const row=stats.roleTrans[from];
    const total=Object.values(row).reduce((a,b)=>a+b,0);
    if(!total)return;
    const stay=Math.round((row[from]||0)/total*100);
    // For bottom two, show escape rate (moved UP = to better role)
    const roleIdx=ROLES.indexOf(from);
    let extra='';
    if(roleIdx>=2){
      const movedUp=ROLES.slice(0,roleIdx).reduce((s,r)=>s+(row[r]||0),0);
      extra=`  escaped up: ${Math.round(movedUp/total*100)}%`;
    }
    console.log(`    ${rs[from].padEnd(6)}: ${String(stay).padStart(3)}% retained${extra}`);
  });

  // Full transition matrix (compact)
  console.log('\n  Full transition matrix (prev → next, %):');
  process.stdout.write('  '+' '.repeat(8));
  ROLES.forEach(r=>process.stdout.write(rs[r].padEnd(7)));console.log();
  ROLES.forEach(from=>{
    process.stdout.write('  '+rs[from].padEnd(8));
    const row=stats.roleTrans[from];
    const total=Object.values(row).reduce((a,b)=>a+b,0);
    ROLES.forEach(to=>{
      const pct=total?Math.round((row[to]||0)/total*100):'—';
      process.stdout.write((pct+'%').padEnd(7));
    });
    console.log();
  });

  // Trade/kitty if active
  if(stats.trade.count>0){
    const t=stats.trade;
    console.log(`\n  Trading (${t.count} rounds): Pres gains +${(t.presGain/t.count).toFixed(1)} rank pts,  Wiper loses −${(t.wiperLoss/t.count).toFixed(1)}`);
    console.log(`                          VP   gains +${(t.vpGain/t.count).toFixed(1)} rank pts,  VA    loses −${(t.vaLoss/t.count).toFixed(1)}`);
  }
  if(stats.kittyRounds>0){
    console.log(`  Kitty (${stats.kittyRounds} rounds): avg +${(stats.kittyGain/stats.kittyRounds).toFixed(1)} total rank gain per round (all 5 players)`);
  }
}

// ── Run all four variants ─────────────────────────────────────────────────────
const VARIANTS = [
  {trading:false, kitty:false, label:'No trading · No kitty exchange  (pure play)'},
  {trading:true,  kitty:false, label:'Card trading · No kitty exchange'},
  {trading:false, kitty:true,  label:'No trading · Kitty exchange'},
  {trading:true,  kitty:true,  label:'Card trading + Kitty exchange    (full rules)'},
];

console.log('\n5-Player President — Build 40 AI — Rule-set Comparison');
console.log(`${NUM_GAMES} conquest games each · 1 conservative · 3 neutral · 1 aggressive\n`);

for(const v of VARIANTS){
  const stats=runSim(v);
  printReport(v.label,stats);
}
console.log();
