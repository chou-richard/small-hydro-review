import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import {getAuth,signInAnonymously,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import {getDatabase,ref,get,set,update} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js';
import {firebaseConfig} from './firebase-config.js';

const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const params=new URLSearchParams(location.search), fragment=new URLSearchParams(location.hash.replace(/^#/,''));
const ADMIN=fragment.get('admin')||params.get('admin')||'', TOKEN=fragment.get('token')||params.get('token')||'';
let db,auth,user,config,adminConfig={},cases={},reviewer={},submissions={},draft={},activeCase='';

async function boot(){
  if(Object.values(firebaseConfig).some(v=>String(v).startsWith('__'))) throw new Error('Firebase 尚未完成設定');
  const app=initializeApp(firebaseConfig); db=getDatabase(app); auth=getAuth(app);
  await signInAnonymously(auth); user=auth.currentUser;
  if(!ADMIN&&!TOKEN) throw new Error('網址缺少管理或委員專屬識別碼');
  await set(ref(db,'sessions/'+user.uid),ADMIN?{adminToken:ADMIN}:{reviewerToken:TOKEN});
  config=(await get(ref(db,'config'))).val(); cases=(await get(ref(db,'cases'))).val()||{};
  if(ADMIN) await loadAdmin(); else await loadReviewer();
}

async function loadReviewer(){
  reviewer=(await get(ref(db,'reviewers/'+TOKEN))).val();
  if(!reviewer||!reviewer.active) throw new Error('無效或已停用的委員網址');
  submissions=(await get(ref(db,'assessments/'+TOKEN))).val()||{};
  activeCase=Object.keys(cases).find(k=>cases[k].active)||'';
  $('#subtitle').textContent='雲端評分、即時儲存與審查結果彙總'; $('#roleTab').textContent='委員評分｜'+reviewer.name; $('#notice').classList.add('hide'); renderReviewer();
}

function renderReviewer(){
  const c=cases[activeCase]; if(!c)return showError('目前沒有啟用中的案件');
  draft=structuredClone(submissions[activeCase]||{scores:{},comments:{}}); draft.scores||={};draft.comments||={};
  const filled=Object.values(draft.scores).filter(v=>v!==''&&Number.isFinite(Number(v))).length;
  $('#app').innerHTML=`<section class="section-title"><h2>委員評分</h2><p class="lede">每個子項輸入 0–100 的規劃完整度分數。系統依五級距顯示定義，並以「子項上限 × 委員評分 ÷ 100」換算實得分。</p></section><div class="score-head no-print"><label>審查委員<input value="${esc(reviewer.name)}" disabled></label><label>審查案件<select id="caseSel">${Object.entries(cases).filter(([,x])=>x.active).map(([id,x])=>`<option value="${id}" ${id===activeCase?'selected':''}>${esc(x.no)}｜${esc(x.organization)}｜${esc(x.name)}</option>`).join('')}</select></label></div><div class="card"><div class="card-title"><div><h3>${esc(reviewer.name)}｜${esc(c.no)} ${esc(c.name)}</h3><div class="case-meta">${esc(c.organization||'')}</div></div><button class="btn secondary no-print" onclick="window.print()">列印當前評分表</button></div><div class="score-summary" id="metrics"></div><div class="${filled===15?'completion ok':'completion incomplete'}" id="completionState">${filled===15?'已完成 15 項評分':'已填 '+filled+' / 15 項，未完成者不納入彙總平均'}</div></div>${['citizen','environment','composite'].map(cat=>renderCategory(c,cat)).join('')}<div class="card"><h3>總評</h3><label>綜合意見（最多 200 字）<textarea maxlength="200" data-comment="overall" placeholder="請綜合說明計畫可行性、獎勵工項規劃符合程度與建議事項。">${esc(draft.comments.overall||'')}</textarea></label></div><div class="savebar no-print"><span id="status" class="muted">${submissions[activeCase]?.updatedAt?'上次儲存：'+new Date(submissions[activeCase].updatedAt).toLocaleString():'尚未儲存'}</span><button class="btn" id="saveBtn">儲存本案評分</button></div>`;
  $('#caseSel').onchange=e=>{activeCase=e.target.value;renderReviewer()};
  document.querySelectorAll('[data-score]').forEach(el=>el.oninput=e=>{draft.scores[e.target.dataset.score]=e.target.value;updateMetrics(c)});
  document.querySelectorAll('[data-pick]').forEach(el=>el.onchange=e=>{if(e.target.value!==''){draft.scores[e.target.dataset.pick]=Number(e.target.value);renderReviewer()}});
  document.querySelectorAll('[data-comment]').forEach(el=>el.oninput=e=>draft.comments[e.target.dataset.comment]=e.target.value);
  $('#saveBtn').onclick=saveCurrent; updateMetrics(c);
}

function renderCategory(c,cat){
  const items=config.criteria.filter(i=>i.categoryId===cat), name=items[0]?.categoryName||cat;
  const colors={citizen:'#173f78',environment:'#007d7d',composite:'#1f5da8'}, subtotal=items.reduce((sum,i)=>{const v=draft.scores[i.itemId];return sum+(v===''||!Number.isFinite(Number(v))?0:Number(c[cat])/5*Math.max(0,Math.min(100,Number(v)))/100)},0);
  return `<section class="category"><div class="category-head" style="background:${colors[cat]||'#173f78'}"><h3>${esc(name)}（配分 ${Number(c[cat])}，每子項上限 ${Number(c[cat])/5}）</h3><div class="category-subtotal" data-subtotal="${cat}">小計 ${subtotal.toFixed(1)} / ${Number(c[cat]).toFixed(1)}</div></div>${items.map((i,idx)=>{const v=draft.scores[i.itemId]??'',b=bandFor(v),level=b?5-config.bands.indexOf(b):'';return `<div class="criterion"><div class="criterion-main"><div class="criterion-name">${idx+1}. ${esc(i.itemName)}</div><div class="criterion-desc">${esc(i.description)}</div></div><label>快速選級距<select data-pick="${i.itemId}"><option value="">請選擇</option>${config.bands.map(x=>`<option value="${x.pick}" ${Number(v)===x.pick?'selected':''}>${esc(x.label)} 帶入最高分 ${x.pick}</option>`).join('')}</select></label><label>委員評分（0–100）<input data-score="${i.itemId}" type="number" min="0" max="100" step="0.1" value="${v}"></label><div><span class="band-badge ${b?'band-'+level:''}" data-band="${i.itemId}">${b?esc(b.title):'未評分'}</span><div class="small-text muted" data-detail="${i.itemId}" style="margin-top:5px">${b?esc(b.detail||''):''}</div><div class="small-text muted" data-contrib="${i.itemId}" style="margin-top:5px"></div></div></div>`}).join('')}<div class="category-comments"><label>${esc(name)}書面意見（最多 200 字）<textarea maxlength="200" data-comment="${cat}">${esc(draft.comments[cat]||'')}</textarea></label></div></section>`;
}

function bandFor(v){const x=Number(v);if(v===''||!Number.isFinite(x))return null;return config.bands.find(b=>x<=b.max&&(b.min===0?x>=0:x>b.min))||null}
function calculate(c){const totals={citizen:0,environment:0,composite:0},counts={citizen:0,environment:0,composite:0};config.criteria.forEach(i=>{const v=draft.scores[i.itemId],x=Number(v);if(v!==''&&Number.isFinite(x)){totals[i.categoryId]+=Number(c[i.categoryId])/5*Math.max(0,Math.min(100,x))/100;counts[i.categoryId]++}});return {totals,counts,total:Object.values(totals).reduce((a,b)=>a+b,0),complete:Object.values(counts).reduce((a,b)=>a+b,0)===15}}
function updateMetrics(c){
  const r=calculate(c); config.criteria.forEach(i=>{const v=draft.scores[i.itemId],b=bandFor(v),x=Number(v),cap=Number(c[i.categoryId])/5,con=v!==''&&Number.isFinite(x)?cap*x/100:null;const bl=document.querySelector(`[data-band="${i.itemId}"]`),de=document.querySelector(`[data-detail="${i.itemId}"]`),ce=document.querySelector(`[data-contrib="${i.itemId}"]`);if(bl){bl.textContent=b?b.title:'未評分';bl.className='band-badge'+(b?' band-'+(5-config.bands.indexOf(b)):'')}if(de)de.textContent=b?(b.detail||''):'';if(ce)ce.textContent=con===null?'':'實得 '+con.toFixed(2)});
  $('#metrics').innerHTML=`${[['citizen','公民參與'],['environment','友善環境'],['composite','複合利用']].map(([id,n])=>`<div class="metric"><span>${n}</span><strong>${r.counts[id]===5?r.totals[id].toFixed(1):'—'} / ${c[id]}</strong></div>`).join('')}<div class="metric"><span>總分</span><strong>${r.complete?r.total.toFixed(1):'—'} / 100</strong></div>`;
  Object.entries(r.totals).forEach(([id,total])=>{const el=document.querySelector(`[data-subtotal="${id}"]`);if(el)el.textContent='小計 '+total.toFixed(1)+' / '+Number(c[id]).toFixed(1)});
  const done=$('#completionState'),filled=Object.values(r.counts).reduce((a,b)=>a+b,0);if(done){done.className=r.complete?'completion ok':'completion incomplete';done.textContent=r.complete?'已完成 15 項評分':'已填 '+filled+' / 15 項，未完成者不納入彙總平均'}
}
async function saveCurrent(){const btn=$('#saveBtn'),r=calculate(cases[activeCase]);btn.disabled=true;$('#status').textContent='儲存中…';try{const data={scores:draft.scores,comments:draft.comments,total:r.total,totals:r.totals,complete:r.complete,updatedAt:new Date().toISOString()};await set(ref(db,`assessments/${TOKEN}/${activeCase}`),data);submissions[activeCase]=data;$('#status').textContent=(r.complete?'已完成 15 項':'已儲存未完成評分')+'，總分 '+r.total.toFixed(2)}catch(e){$('#status').textContent='儲存失敗：'+e.message}finally{btn.disabled=false}}

async function loadAdmin(){
  const [rs,as,xs,acs]=await Promise.all([get(ref(db,'reviewers')),get(ref(db,'assessments')),get(ref(db,'exclusions')),get(ref(db,'adminConfig'))]);
  adminConfig=acs.val()||{};
  const reviewers=rs.val()||{}, assessments=as.val()||{}, exclusions=xs.val()||{};
  $('#subtitle').textContent='雲端管理、委員彙總、平均與案件排名';$('#roleTab').textContent='基本設定與彙總管理';$('#notice').classList.add('hide');renderAdmin(reviewers,assessments,exclusions);
}
function resultRows(reviewers,assessments,exclusions){
  return Object.entries(cases).filter(([,c])=>c.active).map(([caseId,c])=>{const detail=Object.entries(reviewers).filter(([,r])=>r.active).map(([token,r])=>{const s=assessments[token]?.[caseId],include=exclusions[caseId]?.[token]!==false;return {token,name:r.name,complete:!!s?.complete,score:s?Number(s.total):null,include}});const used=detail.filter(x=>x.include&&x.complete&&Number.isFinite(x.score)),avg=used.length?used.reduce((a,b)=>a+b.score,0)/used.length:null;return {caseId,...c,detail,average:avg,includedCount:used.length,passed:avg===null?null:avg>=Number(config.passScore)}}).sort((a,b)=>(b.average??-1)-(a.average??-1)).map((r,i,a)=>({...r,rank:r.average===null?null:(i&&a[i-1].average===r.average?a[i-1].rank:i+1)}));
}
function renderAdmin(reviewers,assessments,exclusions){
  const results=resultRows(reviewers,assessments,exclusions),base=location.origin+location.pathname;
  $('#app').innerHTML=`<section class="section-title"><h2>基本設定與彙總管理</h2><p class="lede">管理委員專屬入口、查看各案評分進度，並人工選擇委員是否納入平均與排名。</p></section><div class="card"><div class="card-title"><h3>會議與雲端工具</h3><div class="toolbar"><button class="btn secondary small" id="reload">重新計算</button><a class="btn secondary small" href="${esc(adminConfig.googleAdminUrl)}" target="_blank" rel="noopener">Google 雲端管理頁（備用）</a><a class="btn secondary small" href="${esc(config.googlePublicUrl)}" target="_blank" rel="noopener">Google 雲端表單入口</a></div></div><div class="notice">及格分數：<strong>${config.passScore}</strong> 分。只有 15 個子項均已評分的委員才可納入平均。</div><p class="security">管理網址包含私密權杖，請勿轉傳給委員。</p></div><div class="card"><div class="card-title"><h3>委員管理</h3></div><div class="toolbar"><label style="min-width:280px">新委員姓名<input id="newName" placeholder="輸入姓名後建立專屬網址"></label><button class="btn" id="addBtn">新增委員</button></div></div><div class="card"><div class="card-title"><h3>案件排名</h3></div><div class="table-wrap"><table><thead><tr><th>名次</th><th>案件</th><th>申請單位</th><th>納入委員數</th><th>平均總得分</th><th>結果</th></tr></thead><tbody>${results.map(r=>`<tr><td>${r.rank?`<span class="rank-number">${r.rank}</span>`:'—'}</td><td><strong>${esc(r.no)} ${esc(r.name)}</strong></td><td>${esc(r.organization||'')}</td><td>${r.includedCount}</td><td><strong>${r.average===null?'—':r.average.toFixed(2)}</strong></td><td class="${r.passed===true?'pass':r.passed===false?'fail':''}">${r.passed===null?'無完整且納入的評分':r.passed?'及格':'未達 '+config.passScore+' 分'}</td></tr>`).join('')}</tbody></table></div></div>${results.map(r=>`<div class="card"><div class="card-title"><div><h3>${esc(r.no)} ${esc(r.name)}</h3><div class="case-meta">本案件配分：公民參與 ${r.citizen}、友善環境 ${r.environment}、複合利用 ${r.composite}</div></div></div><div class="table-wrap"><table><thead><tr><th>委員</th><th>評分狀態</th><th>總分</th><th>納入本案平均</th><th>說明</th></tr></thead><tbody>${r.detail.map(x=>`<tr><td>${esc(x.name)}</td><td class="${x.complete?'completion ok':'completion incomplete'}">${x.complete?'已完成':'未完成'}</td><td>${x.score===null?'—':x.score.toFixed(2)}</td><td><label><input style="width:auto;margin-right:6px" type="checkbox" data-inc="${r.caseId}::${x.token}" ${x.include?'checked':''} ${x.complete?'':'disabled'}>納入</label></td><td class="muted small-text">${x.complete?(x.include?'已納入平均':'人工排除，不列入平均'):'須完成 15 項評分後才能納入'}</td></tr>`).join('')}</tbody></table></div></div>`).join('')}<div class="card"><div class="card-title"><h3>委員專屬填報網址</h3></div><p class="lede">新增委員後會自動產生專屬入口。網址只能提供給對應委員使用。</p>${Object.entries(reviewers).filter(([,r])=>r.active).map(([token,r])=>{const url=base+'#token='+encodeURIComponent(token);return `<div class="url-row"><strong>${esc(r.name)}</strong><a class="linkbox" href="${esc(url)}" target="_blank">${esc(url)}</a><button class="btn secondary small" type="button" data-copy="${esc(url)}">複製網址</button></div>`}).join('')}</div>`;
  $('#reload').onclick=loadAdmin;$('#addBtn').onclick=async()=>{const name=$('#newName').value.trim();if(!name)return alert('請輸入姓名');const token=randomToken();await set(ref(db,'reviewers/'+token),{id:'r'+Date.now().toString(36),name,active:true,defaultInclude:true,createdAt:new Date().toISOString()});await loadAdmin()};
  document.querySelectorAll('[data-inc]').forEach(el=>el.onchange=async e=>{const [caseId,token]=e.target.dataset.inc.split('::');await set(ref(db,`exclusions/${caseId}/${token}`),e.target.checked);await loadAdmin()});
  document.querySelectorAll('[data-copy]').forEach(el=>el.onclick=async e=>{await navigator.clipboard.writeText(e.currentTarget.dataset.copy);const old=e.currentTarget.textContent;e.currentTarget.textContent='已複製';setTimeout(()=>e.currentTarget.textContent=old,1200)});
}
function randomToken(){const a=new Uint8Array(18);crypto.getRandomValues(a);return [...a].map(x=>x.toString(16).padStart(2,'0')).join('')}
function showError(msg){$('#notice').className='notice error';$('#notice').textContent=msg}
boot().catch(e=>showError(e.message));
