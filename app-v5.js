import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import {getAuth,signInAnonymously,setPersistence,inMemoryPersistence} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import {getDatabase,ref,get,set,update} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-database.js';
import {firebaseConfig} from './firebase-config.js';
import qrcode from './qrcode-generator.mjs';

const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const params=new URLSearchParams(location.search),fragment=new URLSearchParams(location.hash.replace(/^#/,''));
const ADMIN=fragment.get('admin')||params.get('admin')||'',TOKEN=fragment.get('token')||params.get('token')||'';
const ACCESS_HASH='e4ffbb56f9fe9c50f61447d9582fdfe6be8727a51adabcad7d7d5da49d49a978';
const ACCESS_VERSION='2026-11-10-v1';
const APP_VERSION='33';
const CATS=['citizen','environment','composite'];
const CAT_NAMES={citizen:'公民參與',environment:'友善環境',composite:'複合利用'};
const CAT_COLORS={citizen:'#173f78',environment:'#007d7d',composite:'#1f5da8'};
const BAND_DETAILS=['人、事、時、地、物等要素具 3 項以上。','人、事、時、地、物等要素具 1–2 項。','僅列目標，沒有具體作法。','僅有構想，未承諾辦理。','計畫書未提及。'];

let db,auth,user,config={},adminConfig={},cases={},reviewer={},submissions={},draft={},activeCase='';
let adminData={reviewers:{},assessments:{},exclusions:{}},adminTab='setup',adminReviewer='',adminCase='';

async function passwordHash(value){
  const bytes=new TextEncoder().encode(value),digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function loginSessionKey(){return `smallHydroAccess:${ACCESS_VERSION}:${ADMIN?'admin':'reviewer'}`}
async function requireLogin(){
  if(!ADMIN&&!TOKEN)throw new Error('網址缺少管理或委員專屬識別碼');
  const gate=$('#loginGate'),shell=$('#appShell'),form=$('#loginForm'),input=$('#loginPassword'),message=$('#loginMessage'),submit=$('#loginSubmit');
  $('#loginRole').textContent=ADMIN?'管理者登入':'審查委員登入';
  if(sessionStorage.getItem(loginSessionKey())===ACCESS_HASH){gate.classList.add('hide');shell.classList.remove('hide');return}
  await new Promise(resolve=>{form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;message.textContent='驗證中…';try{if(await passwordHash(input.value)!==ACCESS_HASH){message.textContent='密碼錯誤，請重新輸入。';input.value='';input.focus();return}sessionStorage.setItem(loginSessionKey(),ACCESS_HASH);gate.classList.add('hide');shell.classList.remove('hide');resolve()}finally{submit.disabled=false}}});
}
function logout(){sessionStorage.removeItem(loginSessionKey());location.reload()}

async function boot(){
  if(Object.values(firebaseConfig).some(v=>String(v).startsWith('__')))throw new Error('Firebase 尚未完成設定');
  const app=initializeApp(firebaseConfig,'small-hydro-'+crypto.randomUUID());db=getDatabase(app);auth=getAuth(app);await setPersistence(auth,inMemoryPersistence);await signInAnonymously(auth);user=auth.currentUser;
  if(!ADMIN&&!TOKEN)throw new Error('網址缺少管理或委員專屬識別碼');
  await setSession(ADMIN?{adminToken:ADMIN}:{reviewerToken:TOKEN});
  config=(await get(ref(db,'config'))).val()||{};cases=(await get(ref(db,'cases'))).val()||{};normalizeConfig();
  if(ADMIN)await loadAdmin();else await loadReviewer();
}
function normalizeConfig(){config.title=config.title||'小水力發電示範獎勵審查';config.passScore=Number(config.passScore??70);config.bands=(config.bands||[]).map((b,i)=>({...b,detail:b.detail||BAND_DETAILS[i]||''}));config.criteria=config.criteria||[]}
async function setSession(v){await set(ref(db,'sessions/'+user.uid),v)}
function randomToken(){const a=new Uint8Array(18);crypto.getRandomValues(a);return [...a].map(x=>x.toString(16).padStart(2,'0')).join('')}
function activeCases(){return Object.entries(cases).filter(([,c])=>c.active!==false)}
function activeReviewers(){return Object.entries(adminData.reviewers).filter(([,r])=>r.active!==false)}
function bandFor(v){const x=Number(v);if(v===''||v==null||!Number.isFinite(x))return null;return config.bands.find(b=>x<=b.max&&(Number(b.min)===0?x>=0:x>b.min))||null}
function calculate(c,values=draft.scores||{}){const totals={citizen:0,environment:0,composite:0},counts={citizen:0,environment:0,composite:0};config.criteria.forEach(i=>{const v=values[i.itemId],x=Number(v);if(v!==''&&v!=null&&Number.isFinite(x)){totals[i.categoryId]+=Number(c[i.categoryId])/5*Math.max(0,Math.min(100,x))/100;counts[i.categoryId]++}});return {totals,counts,total:Object.values(totals).reduce((a,b)=>a+b,0),complete:Object.values(counts).reduce((a,b)=>a+b,0)===15}}

async function loadReviewer(){
  reviewer=(await get(ref(db,'reviewers/'+TOKEN))).val();if(!reviewer||!reviewer.active)throw new Error('無效或已停用的委員網址');
  submissions=(await get(ref(db,'assessments/'+TOKEN))).val()||{};activeCase=activeCases()[0]?.[0]||'';
  $('#subtitle').textContent='雲端評分、即時儲存與審查結果彙總';$('#mainNav').innerHTML=`<button class="active" type="button">委員評分｜${esc(reviewer.name)}</button>`;$('#notice').classList.add('hide');renderReviewer();
}
function renderReviewer(){
  const c=cases[activeCase];if(!c)return showError('目前沒有啟用中的案件');
  draft=structuredClone(submissions[activeCase]||{scores:{},comments:{}});draft.scores||={};draft.comments||={};
  $('#app').innerHTML=`<section class="section-title"><h2>委員評分</h2><p class="lede">每個子項輸入 0–100 分，也可用「快速選級距」帶入該級距最高分。</p></section><div class="score-head no-print"><label>審查委員<input value="${esc(reviewer.name)}" disabled></label><label>審查案件<select id="caseSel">${activeCases().map(([id,x])=>`<option value="${id}" ${id===activeCase?'selected':''}>${esc(x.no)}｜${esc(x.organization)}｜${esc(x.name)}</option>`).join('')}</select></label></div>${scorePanel(c,reviewer.name,submissions[activeCase])}`;
  $('#caseSel').onchange=e=>{activeCase=e.target.value;renderReviewer()};wireScoreControls(c);$('#saveBtn').onclick=saveReviewerScore;updateMetrics(c);
}
function scorePanel(c,reviewerName,saved){
  const filled=Object.values(draft.scores).filter(v=>v!==''&&Number.isFinite(Number(v))).length;
  return `<div class="card"><div class="card-title"><div><h3>${esc(reviewerName)}｜${esc(c.no)} ${esc(c.name)}</h3><div class="case-meta">${esc(c.organization||'')}</div></div><button type="button" class="btn secondary no-print" onclick="window.print()">列印當前評分表</button></div><div class="score-summary" id="metrics"></div><div class="${filled===15?'completion ok':'completion incomplete'}" id="completionState">${filled===15?'已完成 15 項評分':'已填 '+filled+' / 15 項；可先單獨儲存書面意見，15 題全部完成後才能儲存評分'}</div></div>${CATS.map(cat=>renderCategory(c,cat)).join('')}<div class="savebar no-print"><span id="status" class="muted">系統 v${APP_VERSION}｜${saved?.updatedAt?'上次儲存：'+new Date(saved.updatedAt).toLocaleString():'尚未儲存'}</span><div class="toolbar"><button type="button" class="btn secondary" id="saveCommentsBtn" onclick="window.saveReviewerComments(event)">儲存三大項書面意見</button><button type="button" class="btn" id="saveBtn">儲存本案評分</button></div></div>`;
}
function renderCategory(c,cat){
  const items=config.criteria.filter(i=>i.categoryId===cat),name=items[0]?.categoryName||CAT_NAMES[cat],subtotal=items.reduce((sum,i)=>{const v=draft.scores[i.itemId];return sum+(v===''||v==null||!Number.isFinite(Number(v))?0:Number(c[cat])/5*Math.max(0,Math.min(100,Number(v)))/100)},0);
  return `<section class="category"><div class="category-head" style="background:${CAT_COLORS[cat]}"><h3>${esc(name)}（配分 ${Number(c[cat])}，每子項上限 ${Number(c[cat])/5}）</h3><div class="category-subtotal" data-subtotal="${cat}">小計 ${subtotal.toFixed(1)} / ${Number(c[cat]).toFixed(1)}</div></div>${items.map((i,idx)=>{const v=draft.scores[i.itemId]??'',b=bandFor(v),level=b?5-config.bands.indexOf(b):'';return `<div class="criterion"><div class="criterion-main"><div class="criterion-name">${idx+1}. ${esc(i.itemName)}</div><div class="criterion-desc">${esc(i.description)}</div></div><label>快速選級距<select data-pick="${i.itemId}"><option value="">請選擇</option>${config.bands.map(x=>`<option value="${x.pick}" ${Number(v)===Number(x.pick)?'selected':''}>${esc(x.label)} 帶入最高分 ${x.pick}</option>`).join('')}</select></label><label>委員評分（0–100）<input data-score="${i.itemId}" type="number" min="0" max="100" step="0.1" value="${v}" required></label><div><span class="band-badge ${b?'band-'+level:''}" data-band="${i.itemId}">${b?esc(b.title):'未評分'}</span><div class="small-text muted" data-detail="${i.itemId}" style="margin-top:5px">${b?esc(b.detail):''}</div><div class="small-text muted" data-contrib="${i.itemId}" style="margin-top:5px"></div></div></div>`}).join('')}<div class="category-comments">${commentControlMarkup(cat,name)}<label class="comment-field-label">${esc(name)}書面意見<textarea data-comment="${cat}">${esc(draft.comments[cat]||'')}</textarea></label></div></section>`;
}
function wireScoreControls(c){
  document.querySelectorAll('[data-score]').forEach(el=>el.oninput=e=>{draft.scores[e.target.dataset.score]=e.target.value;e.target.closest('.criterion')?.classList.remove('score-error');e.target.removeAttribute('aria-invalid');updateMetrics(c)});
  document.querySelectorAll('[data-pick]').forEach(el=>el.onchange=e=>{if(e.target.value!==''){const id=e.target.dataset.pick;draft.scores[id]=Number(e.target.value);const input=document.querySelector(`[data-score="${id}"]`);if(input){input.value=e.target.value;input.closest('.criterion')?.classList.remove('score-error');input.removeAttribute('aria-invalid')}updateMetrics(c)}});
  document.querySelectorAll('[data-comment]').forEach(el=>el.oninput=e=>draft.comments[e.target.dataset.comment]=e.target.value);
}
function commentControlMarkup(id,name){const savedAt=(ADMIN?adminData.assessments[adminReviewer]?.[adminCase]:submissions[activeCase])?.commentUpdatedAt?.[id];return `<div class="comment-save-row no-print"><span class="muted small-text" data-single-comment-status="${id}">${savedAt?'已儲存：'+new Date(savedAt).toLocaleString():'尚未單獨儲存'}</span><button type="button" class="btn secondary" data-save-single-comment="${id}" onclick="window.saveSingleComment(event,'${id}')">儲存${esc(name)}</button></div>`}
function validateAllScores(){const invalid=[...document.querySelectorAll('[data-score]')].filter(input=>{const raw=input.value.trim(),value=Number(raw),bad=raw===''||!Number.isFinite(value)||value<0||value>100;input.closest('.criterion')?.classList.toggle('score-error',bad);if(bad)input.setAttribute('aria-invalid','true');else input.removeAttribute('aria-invalid');return bad});if(!invalid.length)return true;const missing=invalid.filter(x=>x.value.trim()==='').length,outOfRange=invalid.length-missing,parts=[];if(missing)parts.push(`尚有 ${missing} 題未評分`);if(outOfRange)parts.push(`${outOfRange} 題分數須介於 0–100`);const status=$('#status');status.textContent=parts.join('，')+'；請完成後再儲存。';status.className='validation-error';invalid[0].closest('.criterion')?.scrollIntoView({behavior:'smooth',block:'center'});invalid[0].focus({preventScroll:true});return false}
function updateMetrics(c){
  const r=calculate(c);config.criteria.forEach(i=>{const v=draft.scores[i.itemId],b=bandFor(v),x=Number(v),cap=Number(c[i.categoryId])/5,con=v!==''&&v!=null&&Number.isFinite(x)?cap*x/100:null,bl=document.querySelector(`[data-band="${i.itemId}"]`),de=document.querySelector(`[data-detail="${i.itemId}"]`),ce=document.querySelector(`[data-contrib="${i.itemId}"]`);if(bl){bl.textContent=b?b.title:'未評分';bl.className='band-badge'+(b?' band-'+(5-config.bands.indexOf(b)):'')}if(de)de.textContent=b?b.detail:'';if(ce)ce.textContent=con===null?'':'實得 '+con.toFixed(2)});
  $('#metrics').innerHTML=`${CATS.map(id=>`<div class="metric"><span>${CAT_NAMES[id]}</span><strong>${r.counts[id]===5?r.totals[id].toFixed(1):'—'} / ${c[id]}</strong></div>`).join('')}<div class="metric"><span>總分</span><strong>${r.complete?r.total.toFixed(1):'—'} / 100</strong></div>`;
  Object.entries(r.totals).forEach(([id,total])=>{const el=document.querySelector(`[data-subtotal="${id}"]`);if(el)el.textContent='小計 '+total.toFixed(1)+' / '+Number(c[id]).toFixed(1)});
  const done=$('#completionState'),filled=Object.values(r.counts).reduce((a,b)=>a+b,0);if(done){done.className=r.complete?'completion ok':'completion incomplete';done.textContent=r.complete?'已完成 15 項評分，可儲存本案':'已填 '+filled+' / 15 項；可先單獨儲存書面意見，15 題全部完成後才能儲存評分'}
}
function assessmentPayload(c){const r=calculate(c),scores=Object.fromEntries(config.criteria.map(i=>[i.itemId,draft.scores[i.itemId]??''])),comments=Object.fromEntries([...CATS,'overall'].map(id=>[id,draft.comments[id]??'']));return {scores,comments,total:r.total,totals:r.totals,complete:r.complete,updatedAt:new Date().toISOString()}}
async function saveReviewerComments(event){event?.preventDefault();event?.stopPropagation();const btn=$('#saveCommentsBtn'),scoreBtn=$('#saveBtn');if(!btn||btn.dataset.saving==='1')return;btn.dataset.saving='1';const originalLabel=btn.textContent,saved=structuredClone(submissions[activeCase]||{}),status=$('#status');status.className='muted';status.textContent='已接收到儲存指令，正在檢查書面意見…';document.querySelectorAll('[data-comment]').forEach(el=>draft.comments[el.dataset.comment]=el.value);const scores=Object.fromEntries(config.criteria.map(i=>[i.itemId,saved.scores?.[i.itemId]??''])),comments=Object.fromEntries([...CATS,'overall'].map(id=>[id,draft.comments[id]??'']));if(!Object.values(comments).some(value=>String(value).trim())){const message='請至少填寫一欄書面意見後再儲存。';status.className='validation-error';status.textContent=message;alert(message);delete btn.dataset.saving;return}const now=new Date().toISOString(),data={scores,comments,total:Number(saved.total)||0,totals:saved.totals||{citizen:0,environment:0,composite:0},complete:saved.complete===true,updatedAt:now,commentsUpdatedAt:now};btn.disabled=true;scoreBtn.disabled=true;btn.textContent='書面意見儲存中…';status.textContent='正在儲存書面意見…';try{await set(ref(db,`assessments/${TOKEN}/${activeCase}`),data);submissions[activeCase]=structuredClone(data);btn.textContent='書面意見已儲存 ✓';status.className='completion ok';status.textContent='書面意見已儲存；未完成的評分不會一併送出';alert('書面意見已成功儲存。')}catch(e){const message='書面意見儲存失敗：'+e.message;status.className='validation-error';status.textContent=message;alert(message)}finally{btn.disabled=false;scoreBtn.disabled=false;delete btn.dataset.saving;if(btn.textContent!=='書面意見已儲存 ✓')btn.textContent=originalLabel}}
async function saveSingleComment(event,id){event?.preventDefault();event?.stopPropagation();const btn=document.querySelector(`[data-save-single-comment="${id}"]`),field=document.querySelector(`[data-comment="${id}"]`),fieldStatus=document.querySelector(`[data-single-comment-status="${id}"]`),globalStatus=$('#status'),scoreBtn=$('#saveBtn');if(!btn||!field||btn.dataset.saving==='1')return;const name=id==='overall'?'綜合意見':(CAT_NAMES[id]||'書面意見'),value=field.value;if(!value.trim()){const message=`請先填寫${name}內容。`;fieldStatus.textContent=message;fieldStatus.className='validation-error small-text';alert(message);field.focus();return}btn.dataset.saving='1';btn.disabled=true;scoreBtn.disabled=true;btn.textContent='儲存中…';fieldStatus.className='muted small-text';fieldStatus.textContent='正在儲存…';globalStatus.className='muted';globalStatus.textContent=`正在儲存${name}…`;const saved=structuredClone(submissions[activeCase]||{}),scores=Object.fromEntries(config.criteria.map(item=>[item.itemId,saved.scores?.[item.itemId]??''])),comments=Object.fromEntries([...CATS,'overall'].map(commentId=>[commentId,saved.comments?.[commentId]??''])),now=new Date().toISOString(),commentUpdatedAt={...(saved.commentUpdatedAt||{}),[id]:now};comments[id]=value;const data={scores,comments,total:Number(saved.total)||0,totals:saved.totals||{citizen:0,environment:0,composite:0},complete:saved.complete===true,updatedAt:now,commentsUpdatedAt:now,commentUpdatedAt};try{await set(ref(db,`assessments/${TOKEN}/${activeCase}`),data);submissions[activeCase]=structuredClone(data);draft.comments[id]=value;btn.textContent='已完成儲存 ✓';fieldStatus.className='completion ok small-text';fieldStatus.textContent='已儲存：'+new Date(now).toLocaleString();globalStatus.className='completion ok';globalStatus.textContent=`${name}已完成儲存`;alert(`${name}已完成儲存。`)}catch(e){const message=`${name}儲存失敗：${e.message}`;btn.textContent=`儲存${name}`;fieldStatus.className='validation-error small-text';fieldStatus.textContent=message;globalStatus.className='validation-error';globalStatus.textContent=message;alert(message)}finally{btn.disabled=false;scoreBtn.disabled=false;delete btn.dataset.saving}}
async function saveReviewerScore(){if(!validateAllScores())return;const btn=$('#saveBtn'),data=assessmentPayload(cases[activeCase]);btn.disabled=true;$('#status').className='muted';$('#status').textContent='儲存中…';try{await set(ref(db,`assessments/${TOKEN}/${activeCase}`),data);submissions[activeCase]=structuredClone(data);$('#status').textContent='已完成 15 項並儲存，總分 '+data.total.toFixed(2)}catch(e){$('#status').textContent='儲存失敗：'+e.message}finally{btn.disabled=false}}

async function loadAdmin(){
  await setSession({adminToken:ADMIN});const [rs,as,xs,acs]=await Promise.all([get(ref(db,'reviewers')),get(ref(db,'assessments')),get(ref(db,'exclusions')),get(ref(db,'adminConfig'))]);
  adminConfig=acs.val()||{};adminData={reviewers:rs.val()||{},assessments:as.val()||{},exclusions:xs.val()||{}};adminReviewer=adminReviewer&&adminData.reviewers[adminReviewer]?adminReviewer:activeReviewers()[0]?.[0]||'';adminCase=adminCase&&cases[adminCase]?adminCase:activeCases()[0]?.[0]||'';
  $('#subtitle').textContent='雲端管理、委員評分、彙總排名與專案備份';$('#notice').classList.add('hide');renderAdmin();
}
function renderAdminNav(){const tabs=[['setup','基本設定'],['scoring','委員評分'],['summary','彙總與排名'],['deliberation','評分研商頁面'],['guide','使用與轉置']];$('#mainNav').innerHTML=tabs.map(([id,name])=>`<button type="button" data-admin-tab="${id}" class="${adminTab===id?'active':''}">${name}</button>`).join('');document.querySelectorAll('[data-admin-tab]').forEach(el=>el.onclick=()=>{adminTab=el.dataset.adminTab;renderAdmin()})}
function renderAdmin(){renderAdminNav();const markup=adminTab==='setup'?setupMarkup():adminTab==='scoring'?adminScoringMarkup():adminTab==='summary'?summaryMarkup():adminTab==='deliberation'?deliberationHierarchyMarkup():guideMarkup();$('#app').innerHTML=`${projectBar()}<section class="admin-tab active">${markup}</section><input id="projectFileInput" type="file" accept=".json,application/json" class="hide">`;bindProjectBar();if(adminTab==='setup')bindSetup();if(adminTab==='scoring')bindAdminScoring();if(adminTab==='summary')bindSummary();if(adminTab==='deliberation')bindDeliberation();if(adminTab==='guide')bindGuide()}
function projectBar(){const projects=adminConfig.cloudProjects||{},current=adminConfig.currentProjectId||'',currentName=projects[current]?.name||config.title;return `<div class="project-bar no-print"><div class="project-identity"><strong>${esc(currentName)}</strong><br><span id="cloudProjectStatus">Firebase 線上專案｜${current?'已連結目前專案':'尚未建立線上專案'}</span></div><label class="project-select">線上專案<select id="cloudProjectSelect"><option value="">請選擇線上專案</option>${Object.entries(projects).sort((a,b)=>String(b[1].savedAt||'').localeCompare(String(a[1].savedAt||''))).map(([id,p])=>`<option value="${id}" ${id===current?'selected':''}>${esc(p.name)}${p.savedAt?'｜'+new Date(p.savedAt).toLocaleString():''}</option>`).join('')}</select></label><div class="toolbar"><button class="btn secondary small" id="newProject">建立新專案</button><button class="btn secondary small" id="openProject">開啟專案</button><button class="btn small" id="saveProject">儲存專案</button><button class="btn secondary small" id="saveProjectAs">另存新檔</button></div></div>`}

function setupMarkup(){
  const base=location.origin+location.pathname+'?v='+APP_VERSION;
  return `<div class="section-title"><h2>基本設定</h2><p class="lede">設定審查會議、委員與案件配分。各大項配分可從 50、30、20 中選擇，三項合計必須為 100；每個構面的 5 個子項均分該構面配分。</p></div><div class="card"><div class="card-title"><h3>會議設定</h3><button class="btn small" id="saveMeeting">儲存設定</button></div><div class="grid grid-3"><label>會議名稱<input id="meetingTitle" value="${esc(config.title)}"></label><label>審查日期<input id="meetingDate" type="date" value="${esc(config.meetingDate||'')}"></label><label>及格分數<input id="passScore" type="number" min="0" max="100" step="0.1" value="${config.passScore}"></label></div><div class="status-line muted" id="setupStatus"></div></div><div class="card"><div class="card-title"><h3>委員管理</h3><div class="toolbar"><button class="btn small" id="saveAllReviewers">儲存委員設定</button><label style="min-width:240px">新委員姓名<input id="newName" placeholder="輸入姓名"></label><button class="btn secondary small" id="addBtn">新增委員</button></div></div><div class="status-line muted" id="reviewerStatus">修改姓名或啟用狀態後，請按「儲存委員設定」。</div><div class="table-wrap"><table><thead><tr><th>委員</th><th>啟用</th><th>專屬網址</th><th>QR Code</th><th>操作</th></tr></thead><tbody>${Object.entries(adminData.reviewers).map(([token,r])=>{const url=base+'#token='+encodeURIComponent(token);return `<tr><td><input data-reviewer-name="${token}" value="${esc(r.name)}"></td><td><input style="width:auto" type="checkbox" data-reviewer-active="${token}" ${r.active!==false?'checked':''}></td><td class="linkbox"><a href="${esc(url)}" target="_blank">${esc(url)}</a></td><td class="qr-cell"><div class="qr-box" role="img" aria-label="${esc(r.name)} 專屬填報網址 QR Code" data-qr-url="${esc(url)}" data-qr-name="${esc(r.name)}"></div><button class="btn secondary small qr-download" type="button" data-download-qr="${token}">下載 QR</button></td><td><div class="toolbar"><button class="btn secondary small" data-save-reviewer="${token}">儲存</button><button class="btn danger small" data-delete-reviewer="${token}">刪除</button></div></td></tr>`}).join('')}</tbody></table></div></div><div class="card"><div class="card-title"><h3>案件與構面配分</h3><button class="btn secondary small" id="addCase">新增案件</button></div>${Object.entries(cases).map(([id,c])=>caseCard(id,c)).join('')}</div><div class="card"><h3>評分項目參考</h3>${CATS.map(cat=>`<h3>${CAT_NAMES[cat]}</h3><ol>${config.criteria.filter(i=>i.categoryId===cat).map(i=>`<li><strong>${esc(i.itemName)}</strong><br><span class="muted">${esc(i.description)}</span></li>`).join('')}</ol>`).join('')}</div>`;
}
function caseCard(id,c){const choices=[50,30,20],weights=Object.fromEntries(CATS.map(k=>[k,choices.includes(Number(c[k]))?Number(c[k]):50])),sum=CATS.reduce((n,k)=>n+weights[k],0);return `<div class="case-card"><div class="card-title"><h3>${esc(c.no)} ${esc(c.name)}</h3><label style="width:auto">啟用 <input style="width:auto" type="checkbox" data-case-active="${id}" ${c.active!==false?'checked':''}></label></div><div class="grid grid-3"><label>案號<input data-case-field="${id}:no" value="${esc(c.no)}"></label><label>申請單位<input data-case-field="${id}:organization" value="${esc(c.organization||'')}"></label><label>案場名稱<input data-case-field="${id}:name" value="${esc(c.name||'')}"></label></div><div class="weight-grid">${CATS.map(k=>`<label>${CAT_NAMES[k]}配分<select data-case-weight="${id}:${k}">${choices.map(v=>`<option value="${v}" ${weights[k]===v?'selected':''}>${v}</option>`).join('')}</select></label>`).join('')}<div class="weight-sum ${sum===100?'':'bad'}" data-weight-sum="${id}">合計 ${sum}</div></div><div class="toolbar" style="margin-top:12px"><button class="btn small" data-save-case="${id}">儲存案件</button></div></div>`}
function bindSetup(){
  $('#saveMeeting').onclick=async()=>{const pass=Number($('#passScore').value);if(!Number.isFinite(pass)||pass<0||pass>100)return alert('及格分數必須介於 0–100');const title=$('#meetingTitle').value.trim()||config.title;await update(ref(db,'config'),{title,meetingDate:$('#meetingDate').value,passScore:pass});Object.assign(config,{title,meetingDate:$('#meetingDate').value,passScore:pass});$('#setupStatus').textContent='會議設定已儲存'};
  $('#addBtn').onclick=async()=>{const name=$('#newName').value.trim();if(!name)return alert('請輸入姓名');const token=randomToken();await set(ref(db,'reviewers/'+token),{id:'r'+Date.now().toString(36),name,active:true,defaultInclude:true,createdAt:new Date().toISOString()});await loadAdmin()};
  $('#saveAllReviewers').onclick=async()=>{const btn=$('#saveAllReviewers'),rows=[...document.querySelectorAll('[data-reviewer-name]')];btn.disabled=true;$('#reviewerStatus').textContent='儲存中…';try{let activeCount=0;for(const nameInput of rows){const token=nameInput.dataset.reviewerName,name=nameInput.value.trim()||'未命名委員',active=document.querySelector(`[data-reviewer-active="${token}"]`).checked;if(active)activeCount++;await update(ref(db,'reviewers/'+token),{name,active});adminData.reviewers[token]={...adminData.reviewers[token],name,active}}$('#reviewerStatus').textContent=`已儲存 ${rows.length} 位委員設定，其中啟用 ${activeCount} 位。`;adminReviewer=activeReviewers()[0]?.[0]||''}catch(err){$('#reviewerStatus').textContent='儲存失敗：'+err.message}finally{btn.disabled=false}};
  document.querySelectorAll('[data-save-reviewer]').forEach(el=>el.onclick=async()=>{const token=el.dataset.saveReviewer,name=document.querySelector(`[data-reviewer-name="${token}"]`).value.trim()||'未命名委員',active=document.querySelector(`[data-reviewer-active="${token}"]`).checked;await update(ref(db,'reviewers/'+token),{name,active});await loadAdmin()});
  document.querySelectorAll('[data-delete-reviewer]').forEach(el=>el.onclick=async()=>{const token=el.dataset.deleteReviewer,record=adminData.reviewers[token],name=document.querySelector(`[data-reviewer-name="${token}"]`).value.trim()||record?.name||'未命名委員';if(!confirm(`確定刪除委員「${name}」？\n\n專屬網址、所有案件評分及納入／排除設定都會一併刪除，且無法復原。建議先「儲存專案」備份。`))return;el.disabled=true;try{await withReviewerAccess(token,record,async()=>{for(const caseId of Object.keys(adminData.assessments[token]||{}))await set(ref(db,`assessments/${token}/${caseId}`),null)});for(const caseId of Object.keys(cases))await set(ref(db,`exclusions/${caseId}/${token}`),null);await set(ref(db,'reviewers/'+token),null);if(adminReviewer===token)adminReviewer='';await loadAdmin()}catch(err){alert('無法刪除委員：'+err.message);el.disabled=false}});
  $('#addCase').onclick=async()=>{const id='case'+Date.now().toString(36);await set(ref(db,'cases/'+id),{no:'新案件',organization:'',name:'',citizen:50,environment:30,composite:20,active:true});cases=(await get(ref(db,'cases'))).val()||{};renderAdmin()};
  document.querySelectorAll('[data-case-weight]').forEach(el=>el.onchange=()=>{const id=el.dataset.caseWeight.split(':')[0],sum=CATS.reduce((n,k)=>n+Number(document.querySelector(`[data-case-weight="${id}:${k}"]`).value),0),box=document.querySelector(`[data-weight-sum="${id}"]`);box.textContent='合計 '+sum;box.classList.toggle('bad',sum!==100)});
  document.querySelectorAll('[data-save-case]').forEach(el=>el.onclick=async()=>{const id=el.dataset.saveCase,obj={active:document.querySelector(`[data-case-active="${id}"]`).checked};document.querySelectorAll(`[data-case-field^="${id}:"]`).forEach(x=>obj[x.dataset.caseField.split(':')[1]]=x.value.trim());CATS.forEach(k=>obj[k]=Number(document.querySelector(`[data-case-weight="${id}:${k}"]`).value));if(CATS.reduce((n,k)=>n+obj[k],0)!==100)return alert('三個大項配分合計必須為 100');await set(ref(db,'cases/'+id),obj);cases=(await get(ref(db,'cases'))).val()||{};renderAdmin()});
  renderQrCodes();
}

function renderQrCodes(){
  document.querySelectorAll('[data-qr-url]').forEach(box=>{const qr=qrcode(0,'M');qr.addData(box.dataset.qrUrl);qr.make();box.innerHTML=qr.createSvgTag({cellSize:3,margin:3,scalable:true});box.dataset.qrImage=qr.createDataURL(6,12);box.onclick=()=>box.classList.toggle('large')});
  document.querySelectorAll('[data-download-qr]').forEach(btn=>btn.onclick=()=>{const box=btn.closest('.qr-cell').querySelector('[data-qr-url]'),a=document.createElement('a');a.href=box.dataset.qrImage;a.download=safeName(box.dataset.qrName)+'_專屬填報_QR.gif';document.body.appendChild(a);a.click();a.remove()});
}

function adminScoringMarkup(){if(!adminReviewer||!adminCase)return `<div class="notice error">請先建立並啟用委員與案件。</div>`;const c=cases[adminCase],r=adminData.reviewers[adminReviewer],saved=adminData.assessments[adminReviewer]?.[adminCase];draft=structuredClone(saved||{scores:{},comments:{}});draft.scores||={};draft.comments||={};return `<div class="section-title"><h2>委員評分</h2><p class="lede">管理員可選擇委員與案件代為填報，儲存後與該委員專屬網址同步。</p></div><div class="score-head"><label>審查委員<select id="adminReviewerSel">${activeReviewers().map(([id,x])=>`<option value="${id}" ${id===adminReviewer?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label><label>審查案件<select id="adminCaseSel">${activeCases().map(([id,x])=>`<option value="${id}" ${id===adminCase?'selected':''}>${esc(x.no)}｜${esc(x.name)}</option>`).join('')}</select></label></div>${scorePanel(c,r.name,saved)}`}
function bindAdminScoring(){if(!adminReviewer||!adminCase)return;$('#adminReviewerSel').onchange=e=>{adminReviewer=e.target.value;renderAdmin()};$('#adminCaseSel').onchange=e=>{adminCase=e.target.value;renderAdmin()};const c=cases[adminCase];wireScoreControls(c);$('#saveBtn').onclick=saveAdminScore;updateMetrics(c)}
async function saveAdminScore(){if(!validateAllScores())return;const btn=$('#saveBtn'),data=assessmentPayload(cases[adminCase]);btn.disabled=true;$('#status').className='muted';$('#status').textContent='儲存中…';try{await setSession({adminToken:ADMIN,reviewerToken:adminReviewer});await set(ref(db,`assessments/${adminReviewer}/${adminCase}`),data);adminData.assessments[adminReviewer]||={};adminData.assessments[adminReviewer][adminCase]=structuredClone(data);$('#status').textContent='已完成 15 項並儲存，總分 '+data.total.toFixed(2)}catch(e){$('#status').textContent='儲存失敗：'+e.message}finally{await setSession({adminToken:ADMIN});btn.disabled=false}}

function resultRows(){return activeCases().map(([caseId,c])=>{const detail=activeReviewers().map(([token,r])=>{const s=adminData.assessments[token]?.[caseId],include=adminData.exclusions[caseId]?.[token]!==false;return {token,name:r.name,complete:!!s?.complete,score:s?Number(s.total):null,include}}),used=detail.filter(x=>x.include&&x.complete&&Number.isFinite(x.score)),avg=used.length?used.reduce((a,b)=>a+b.score,0)/used.length:null;return {caseId,...c,detail,average:avg,includedCount:used.length,passed:avg===null?null:avg>=config.passScore}}).sort((a,b)=>(b.average??-1)-(a.average??-1)).map((r,i,a)=>({...r,rank:r.average===null?null:(i&&a[i-1].average===r.average?a[i-1].rank:i+1)}))}
function summaryMarkup(){const results=resultRows();return `<div class="section-title"><h2>彙總與排名</h2><p class="lede">可隨時預先設定各委員是否納入本案平均；只有 15 個子項均已評分的委員才會實際納入計算。</p></div><div class="card"><div class="card-title"><h3>案件排名</h3><button class="btn secondary small" id="reload">重新計算</button></div><div class="table-wrap"><table><thead><tr><th>名次</th><th>案件</th><th>申請單位</th><th>納入委員數</th><th>平均總得分</th><th>結果</th></tr></thead><tbody>${results.map(r=>`<tr><td>${r.rank?`<span class="rank-number">${r.rank}</span>`:'—'}</td><td><strong>${esc(r.no)} ${esc(r.name)}</strong></td><td>${esc(r.organization||'')}</td><td>${r.includedCount}</td><td><strong>${r.average===null?'—':r.average.toFixed(2)}</strong></td><td class="${r.passed===true?'pass':r.passed===false?'fail':''}">${r.passed===null?'無完整且納入的評分':r.passed?'及格':'未達 '+config.passScore+' 分'}</td></tr>`).join('')}</tbody></table></div></div>${results.map(r=>`<div class="card"><div class="card-title"><div><h3>${esc(r.no)} ${esc(r.name)}</h3><div class="case-meta">本案件配分：${CATS.map(k=>CAT_NAMES[k]+' '+r[k]).join('、')}</div></div></div><div class="table-wrap"><table><thead><tr><th>委員</th><th>評分狀態</th><th>總分</th><th>納入本案平均</th><th>說明</th></tr></thead><tbody>${r.detail.map(x=>`<tr><td>${esc(x.name)}</td><td class="${x.complete?'completion ok':'completion incomplete'}">${x.complete?'已完成':'未完成'}</td><td>${x.score===null?'—':x.score.toFixed(2)}</td><td><label><input style="width:auto;margin-right:6px" type="checkbox" data-inc="${r.caseId}::${x.token}" ${x.include?'checked':''}>納入</label></td><td class="muted small-text">${x.complete?(x.include?'已納入平均':'人工排除，不列入平均'):(x.include?'已預設納入；完成 15 項評分後自動計算':'已預設排除；完成後仍不列入平均')}</td></tr>`).join('')}</tbody></table></div></div>`).join('')}`}
function bindSummary(){$('#reload').onclick=loadAdmin;document.querySelectorAll('[data-inc]').forEach(el=>el.onchange=async e=>{const [caseId,token]=e.target.dataset.inc.split('::');await set(ref(db,`exclusions/${caseId}/${token}`),e.target.checked);adminData.exclusions[caseId]||={};adminData.exclusions[caseId][token]=e.target.checked;renderAdmin()})}

function deliberationMarkup(){const reviewers=activeReviewers().map(([token],index)=>({token,label:'委員'+String(index+1).padStart(2,'0')})),items=config.criteria;return `<div class="section-title"><div class="card-title"><div><h2>評分研商頁面</h2><p class="lede">委員姓名已遮蔽，匿名編號依啟用委員順序產生。直向列出三大項、總分及 15 個子項，橫向比較各委員評分。</p></div><div class="toolbar no-print"><button class="btn secondary" id="deliberationReload">重新載入</button><button class="btn" id="deliberationPrint">列印研商頁面</button></div></div></div>${activeCases().map(([caseId,c])=>`<div class="card deliberation-card"><div class="card-title"><div><h3>${esc(c.no)} ${esc(c.name)}</h3><div class="case-meta">${esc(c.organization||'')}｜配分：公民參與 ${c.citizen}、友善環境 ${c.environment}、複合利用 ${c.composite}</div></div></div><div class="table-wrap"><table class="deliberation-table deliberation-transposed"><thead><tr><th>評分內容</th>${reviewers.map(({label})=>`<th data-anonymous-reviewer>${label}</th>`).join('')}</tr></thead><tbody><tr class="deliberation-summary-row"><th scope="row">評分狀態</th>${reviewers.map(({token})=>{const a=adminData.assessments[token]?.[caseId];return `<td class="${a?.complete?'pass':'completion incomplete'}">${a?.complete?'已完成':'未完成'}</td>`}).join('')}</tr>${CATS.map(cat=>`<tr class="deliberation-summary-row"><th scope="row">${CAT_NAMES[cat]}大項得分</th>${reviewers.map(({token})=>{const a=adminData.assessments[token]?.[caseId];return `<td>${a?.totals?.[cat]!=null?Number(a.totals[cat]).toFixed(1):'—'}</td>`}).join('')}</tr>`).join('')}<tr class="deliberation-total-row"><th scope="row">總分</th>${reviewers.map(({token})=>{const a=adminData.assessments[token]?.[caseId];return `<td><strong>${a?.complete&&a?.total!=null?Number(a.total).toFixed(1):'—'}</strong></td>`}).join('')}</tr>${items.map((item,index)=>{const categoryIndex=config.criteria.filter(x=>x.categoryId===item.categoryId).findIndex(x=>x.itemId===item.itemId)+1;return `<tr><th scope="row"><span class="deliberation-category">${esc(item.categoryName||CAT_NAMES[item.categoryId])} ${categoryIndex}</span>${esc(item.itemName)}</th>${reviewers.map(({token})=>{const a=adminData.assessments[token]?.[caseId],value=a?.scores?.[item.itemId];return `<td data-deliberation-score>${value!==''&&value!=null?esc(value):'—'}</td>`}).join('')}</tr>`}).join('')}</tbody></table></div></div>`).join('')||'<div class="notice">目前沒有啟用中的案件。</div>'}`}
function deliberationHierarchyMarkup(){
  const reviewers=activeReviewers().map(([token],index)=>({token,label:'委員'+String(index+1).padStart(2,'0')}));
  const tableWidth=190+reviewers.length*108;
  const cells=(caseId,render)=>reviewers.map(({token})=>render(adminData.assessments[token]?.[caseId])).join('');
  const caseTable=([caseId,c])=>`<div class="card deliberation-card"><div class="card-title"><div><h3>${esc(c.no)} ${esc(c.name)}</h3><div class="case-meta">${esc(c.organization||'')}｜配分：公民參與 ${c.citizen}、友善環境 ${c.environment}、複合利用 ${c.composite}</div></div></div><div class="table-wrap"><table class="deliberation-table deliberation-transposed" style="width:${tableWidth}px;min-width:${tableWidth}px"><thead><tr><th>評分內容</th>${reviewers.map(({label})=>`<th data-anonymous-reviewer>${label}</th>`).join('')}</tr></thead><tbody>
    <tr class="deliberation-summary-row"><th scope="row">評分狀態</th>${cells(caseId,a=>`<td class="${a?.complete?'pass':'completion incomplete'}">${a?.complete?'已完成':'未完成'}</td>`)}</tr>
    ${CATS.map(cat=>`<tr class="deliberation-category-row"><th scope="row"><span class="deliberation-group-name">${esc(CAT_NAMES[cat])}</span><span class="deliberation-group-note">大項得分</span></th>${cells(caseId,a=>`<td>${a?.totals?.[cat]!=null?Number(a.totals[cat]).toFixed(1):'—'}</td>`)}</tr>${config.criteria.filter(item=>item.categoryId===cat).map((item,index)=>`<tr class="deliberation-child-row"><th scope="row"><span class="deliberation-child-index">子項 ${index+1}</span><span class="deliberation-child-name">${esc(item.itemName)}</span></th>${cells(caseId,a=>{const value=a?.scores?.[item.itemId];return `<td data-deliberation-score>${value!==''&&value!=null?esc(value):'—'}</td>`})}</tr>`).join('')}`).join('')}
    <tr class="deliberation-total-row"><th scope="row">總分</th>${cells(caseId,a=>`<td><strong>${a?.complete&&a?.total!=null?Number(a.total).toFixed(1):'—'}</strong></td>`)}</tr>
  </tbody></table></div></div>`;
  return `<div class="section-title"><div class="card-title"><div><h2>評分研商頁面</h2><p class="lede">委員姓名已遮蔽，匿名編號依啟用委員順序產生。三大項分組顯示，各大項下方依序列出 5 個子項，橫向比較各委員評分。</p></div><div class="toolbar no-print"><button class="btn secondary" id="deliberationReload">重新載入</button><button class="btn" id="deliberationPrint">列印研商頁面</button></div></div></div>${activeCases().map(caseTable).join('')||'<div class="notice">目前沒有啟用中的案件。</div>'}`;
}

function bindDeliberation(){$('#deliberationReload').onclick=loadAdmin;$('#deliberationPrint').onclick=()=>window.print()}

function guideMarkup(){return `<div class="section-title"><h2>使用與轉置</h2><p class="lede">專案可直接儲存在 Firebase 線上專案庫；JSON 匯出與匯入作為額外的離線備份。</p></div><div class="card"><h3>雲端與匯出工具</h3><div class="toolbar"><button class="btn" id="exportCsv">匯出委員評分 CSV</button><button class="btn secondary" id="exportProject">匯出完整專案 JSON</button><button class="btn secondary" id="importProjectFile">匯入專案 JSON</button><a class="btn secondary" href="${esc(adminConfig.googleAdminUrl||'')}" target="_blank" rel="noopener">Google 雲端管理頁（備用）</a><a class="btn secondary" href="${esc(config.googlePublicUrl||'')}" target="_blank" rel="noopener">Google 雲端表單入口</a></div></div><div class="card"><h3>五級距定義</h3><div class="bands">${config.bands.map((b,i)=>`<div class="band-card"><strong>${esc(b.label)} 分｜快速帶入 ${b.pick}</strong>${esc(b.title)}<br><span class="muted">${esc(b.detail||BAND_DETAILS[i])}</span></div>`).join('')}</div></div><div class="card"><h3>計算邏輯</h3><ol><li>各大項的 5 個子項均分該大項配分。</li><li>子項實得分＝子項配分上限 × 委員評分 ÷ 100。</li><li>15 個子項全數完成才納入案件平均。</li><li>案件平均達 ${config.passScore} 分為及格，並依平均分由高至低排名。</li></ol></div>`}
function bindGuide(){$('#exportCsv').onclick=exportCsv;$('#exportProject').onclick=downloadProject;$('#importProjectFile').onclick=()=>$('#projectFileInput').click();$('#projectFileInput').onchange=importProject}

function projectData(){const {cloudProjects,currentProjectId,...portableAdminConfig}=adminConfig;return {config:structuredClone(config),cases:structuredClone(cases),reviewers:structuredClone(adminData.reviewers),assessments:structuredClone(adminData.assessments),exclusions:structuredClone(adminData.exclusions),adminConfig:portableAdminConfig}}
function projectSnapshot(){return {format:'small-hydro-review-cloud-project',version:3,exportedAt:new Date().toISOString(),data:projectData()}}
function safeName(v){return String(v||'小水力審查專案').replace(/[\\/:*?"<>|]/g,'_').trim()||'小水力審查專案'}
function download(name,content,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function downloadProject(){download(safeName(config.title)+'_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(projectSnapshot(),null,2),'application/json;charset=utf-8')}
function toCsv(rows){return '\ufeff'+rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n')}
function exportCsv(){const criteriaByCategory=Object.fromEntries(CATS.map(cat=>[cat,config.criteria.filter(i=>i.categoryId===cat)])),header=['案號','申請單位','案場名稱','委員','完成','納入平均'];for(const cat of CATS){header.push(`${CAT_NAMES[cat]}大項得分`);for(const [index,item] of criteriaByCategory[cat].entries())header.push(`${CAT_NAMES[cat]}子項${index+1}｜${item.itemName}（0–100）`)}header.push('總分','公民參與書面意見','友善環境書面意見','複合利用書面意見','總評','最後儲存時間');const rows=[header];for(const [caseId,c] of Object.entries(cases))for(const [token,r] of Object.entries(adminData.reviewers)){const a=adminData.assessments[token]?.[caseId],row=[c.no,c.organization,c.name,r.name,a?.complete?'是':'否',adminData.exclusions[caseId]?.[token]===false?'否':'是'];for(const cat of CATS){row.push(a?.totals?.[cat]??'');for(const item of criteriaByCategory[cat])row.push(a?.scores?.[item.itemId]??'')}row.push(a?.total??'',a?.comments?.citizen??'',a?.comments?.environment??'',a?.comments?.composite??'',a?.comments?.overall??'',a?.updatedAt?new Date(a.updatedAt).toLocaleString():'');rows.push(row)}download('小水力審查_委員評分彙總.csv',toCsv(rows),'text/csv;charset=utf-8')}
function bindProjectBar(){
  $('#saveProject').onclick=()=>saveCloudProject(false);$('#saveProjectAs').onclick=()=>saveCloudProject(true);$('#openProject').onclick=openCloudProject;$('#newProject').onclick=newCloudProject;
}
function newCloudId(){return 'project_'+Date.now().toString(36)+'_'+randomToken().slice(0,8)}
async function saveCloudProject(asNew=false,forcedName=''){let id=asNew?'':(adminConfig.currentProjectId||''),name=forcedName||(id?adminConfig.cloudProjects?.[id]?.name:'');if(!id){if(!forcedName){const entered=prompt('請輸入線上專案名稱：',name||config.title||'小水力審查專案');if(entered===null)return;name=entered.trim()||'小水力審查專案'}id=newCloudId()}const entry={name:name||config.title,savedAt:new Date().toISOString(),data:projectData()};await set(ref(db,`adminConfig/cloudProjects/${id}`),entry);await set(ref(db,'adminConfig/currentProjectId'),id);adminConfig.cloudProjects||={};adminConfig.cloudProjects[id]=entry;adminConfig.currentProjectId=id;renderAdmin();$('#cloudProjectStatus').textContent=`已儲存線上專案：${entry.name}｜${new Date(entry.savedAt).toLocaleString()}`}
async function openCloudProject(){
  const id=$('#cloudProjectSelect').value,entry=adminConfig.cloudProjects?.[id];
  if(!id||!entry)return alert('請先選擇要開啟的線上專案');
  if(id===adminConfig.currentProjectId)return alert(`目前已開啟線上專案：${entry.name}`);
  if(!confirm(`確定開啟線上專案「${entry.name}」？\n\n系統會先自動保存目前專案，再切換案件、委員、評分與各子頁資料。`))return;
  const btn=$('#openProject'),previousId=adminConfig.currentProjectId||'',previousEntry=adminConfig.cloudProjects?.[previousId],rollbackData=projectData();
  btn.disabled=true;$('#cloudProjectStatus').textContent=`正在備份目前專案並開啟：${entry.name}…`;
  try{
    if(previousId&&previousEntry){
      const backup={name:previousEntry.name||config.title,savedAt:new Date().toISOString(),data:rollbackData};
      await set(ref(db,`adminConfig/cloudProjects/${previousId}`),backup);
      adminConfig.cloudProjects[previousId]=backup;
    }
    await restoreProjectData(entry.data);
    await set(ref(db,'adminConfig/currentProjectId'),id);
    adminConfig.currentProjectId=id;
    config=(await get(ref(db,'config'))).val()||{};
    cases=(await get(ref(db,'cases'))).val()||{};
    normalizeConfig();
    adminReviewer='';adminCase='';activeCase='';
    await loadAdmin();
    $('#cloudProjectStatus').textContent=`已開啟線上專案：${entry.name}｜所有分頁已同步更新`;
    alert(`已開啟線上專案：${entry.name}\n\n基本設定、委員評分、彙總排名及評分研商頁面均已同步更新。`);
  }catch(err){
    let rollbackMessage='';
    try{
      await restoreProjectData(rollbackData);
      await set(ref(db,'adminConfig/currentProjectId'),previousId||null);
      adminConfig.currentProjectId=previousId;
      config=(await get(ref(db,'config'))).val()||{};
      cases=(await get(ref(db,'cases'))).val()||{};
      normalizeConfig();
      adminReviewer='';adminCase='';activeCase='';
      await loadAdmin();
      rollbackMessage='；已自動回復切換前資料';
    }catch(rollbackErr){rollbackMessage=`；自動回復失敗：${rollbackErr.message}`}
    await setSession({adminToken:ADMIN});
    const status=$('#cloudProjectStatus');if(status)status.textContent=`開啟失敗：${err.message}${rollbackMessage}`;
    alert(`無法開啟線上專案「${entry.name}」：\n${err.message}${rollbackMessage}`);
  }finally{if(document.body.contains(btn))btn.disabled=false}
}
async function newCloudProject(){if(!confirm('建立新線上專案會清空目前案件評分與排除設定，但保留委員及專屬網址。是否繼續？'))return;const entered=prompt('請輸入新線上專案名稱：','小水力審查專案');if(entered===null)return;const name=entered.trim()||'小水力審查專案';await clearAssessments(adminData.assessments);await set(ref(db,'exclusions'),null);await set(ref(db,'cases'),{case1:{no:'案1',organization:'',name:'',citizen:50,environment:30,composite:20,active:true}});await update(ref(db,'config'),{title:name,passScore:70});config=(await get(ref(db,'config'))).val()||{};normalizeConfig();cases=(await get(ref(db,'cases'))).val()||{};adminData.assessments={};adminData.exclusions={};adminTab='setup';await saveCloudProject(true,name)}
async function withReviewerAccess(token,record,task){const wasInactive=record?.active===false;if(wasInactive)await update(ref(db,'reviewers/'+token),{active:true});await setSession({adminToken:ADMIN,reviewerToken:token});try{await task()}finally{await setSession({adminToken:ADMIN});if(wasInactive)await update(ref(db,'reviewers/'+token),{active:false})}}
async function clearAssessments(source){for(const [token,byCase] of Object.entries(source||{}))await withReviewerAccess(token,adminData.reviewers[token],async()=>{for(const caseId of Object.keys(byCase||{}))await set(ref(db,`assessments/${token}/${caseId}`),null)})}
async function syncReviewers(next){const all=new Set([...Object.keys(adminData.reviewers),...Object.keys(next||{})]);for(const token of all)await set(ref(db,'reviewers/'+token),next?.[token]||null)}
async function restoreProjectData(d){
  if(!d?.config||!d?.cases||!d?.reviewers)throw new Error('專案資料格式不符：缺少設定、案件或委員資料');
  const nextAssessments=d.assessments||{},nextExclusions=d.exclusions||{};
  await clearAssessments(adminData.assessments);
  await syncReviewers(d.reviewers);
  await set(ref(db,'config'),d.config);
  await set(ref(db,'cases'),d.cases);
  await set(ref(db,'exclusions'),Object.keys(nextExclusions).length?nextExclusions:null);
  const {cloudProjects,currentProjectId,...portableAdminConfig}=d.adminConfig||{};
  if(Object.keys(portableAdminConfig).length)await update(ref(db,'adminConfig'),portableAdminConfig);
  adminData.reviewers=d.reviewers;
  for(const [token,byCase] of Object.entries(nextAssessments))await withReviewerAccess(token,d.reviewers[token],async()=>{for(const [caseId,value] of Object.entries(byCase||{}))await set(ref(db,`assessments/${token}/${caseId}`),value)});
  config=d.config;normalizeConfig();cases=d.cases;adminData.assessments=nextAssessments;adminData.exclusions=nextExclusions;
}
async function importProject(e){const file=e.target.files?.[0];e.target.value='';if(!file)return;try{const parsed=JSON.parse(await file.text()),d=parsed?.format==='small-hydro-review-cloud-project'?parsed.data:parsed;if(!confirm('匯入 JSON 會以檔案內容替換目前線上設定、案件、委員與評分。是否繼續？'))return;await restoreProjectData(d);alert('專案 JSON 已完整匯入雲端。');await loadAdmin()}catch(err){await setSession({adminToken:ADMIN});alert('無法匯入專案：'+err.message)}}

function showError(msg){$('#notice').className='notice error';$('#notice').textContent=msg}
function currentCommentTarget(){return {token:ADMIN?adminReviewer:TOKEN,caseId:ADMIN?adminCase:activeCase}}
async function persistCommentFields(ids){
  const {token,caseId}=currentCommentTarget();
  if(!token||!caseId)throw new Error('請先選擇委員與案件');
  const path=`assessments/${token}/${caseId}`;
  let phase='取得委員寫入授權';
  const write=async()=>{
    phase='讀取既有評分';
    const saved=(await get(ref(db,path))).val()||{};
    const scores=Object.fromEntries(config.criteria.map(item=>[item.itemId,saved.scores?.[item.itemId]??'']));
    const comments=Object.fromEntries([...CATS,'overall'].map(id=>[id,saved.comments?.[id]??'']));
    const now=new Date().toISOString(),commentUpdatedAt={...(saved.commentUpdatedAt||{})};
    for(const id of ids){comments[id]=document.querySelector(`[data-comment="${id}"]`)?.value??'';commentUpdatedAt[id]=now}
    const data={scores,comments,total:Number(saved.total)||0,totals:saved.totals||{citizen:0,environment:0,composite:0},complete:saved.complete===true,updatedAt:now,commentsUpdatedAt:now,commentUpdatedAt};
    phase='寫入書面意見';
    await set(ref(db,path),data);
    if(ADMIN){adminData.assessments[token]||={};adminData.assessments[token][caseId]=structuredClone(data)}else submissions[caseId]=structuredClone(data);
    ids.forEach(id=>draft.comments[id]=comments[id]);
    return data;
  };
  try{
    if(ADMIN){let result;await withReviewerAccess(token,adminData.reviewers[token],async()=>{result=await write()});return result}
    return await write();
  }catch(error){throw new Error(`${phase}階段：${error.message}`)}
}
async function saveSingleCommentForCurrent(event,id){
  event?.preventDefault();event?.stopPropagation();
  const btn=document.querySelector(`[data-save-single-comment="${id}"]`),field=document.querySelector(`[data-comment="${id}"]`),fieldStatus=document.querySelector(`[data-single-comment-status="${id}"]`),status=$('#status');
  if(!btn||!field||btn.disabled)return;
  const name=id==='overall'?'綜合意見':CAT_NAMES[id];
  btn.disabled=true;btn.textContent='儲存中…';fieldStatus.textContent='正在儲存…';status.textContent=`正在儲存${name}…`;
  try{const data=await persistCommentFields([id]),cleared=!field.value.trim();btn.textContent='已完成儲存 ✓';fieldStatus.className='completion ok small-text';fieldStatus.textContent=(cleared?'已清空並儲存：':'已儲存：')+new Date(data.commentUpdatedAt[id]).toLocaleString();status.className='completion ok';status.textContent=`${name}${cleared?'已清空並儲存':'已完成儲存'}`;alert(`${name}${cleared?'已清空並儲存':'已完成儲存'}。`)}
  catch(error){const message=`${name}儲存失敗：${error.message}`;btn.textContent=`儲存${name}`;fieldStatus.className='validation-error small-text';fieldStatus.textContent=message;status.className='validation-error';status.textContent=message;alert(message)}
  finally{btn.disabled=false}
}
async function saveAllCommentsForCurrent(event){
  event?.preventDefault();event?.stopPropagation();const btn=$('#saveCommentsBtn'),status=$('#status');if(!btn||btn.disabled)return;
  const ids=[...CATS];
  btn.disabled=true;btn.textContent='儲存中…';status.textContent='正在儲存全部書面意見…';
  try{const data=await persistCommentFields(ids);for(const id of ids){const fieldStatus=document.querySelector(`[data-single-comment-status="${id}"]`);if(fieldStatus){fieldStatus.className='completion ok small-text';fieldStatus.textContent=(data.comments[id]?.trim()?'已儲存：':'已清空並儲存：')+new Date(data.commentUpdatedAt[id]).toLocaleString()}}btn.textContent='書面意見已儲存 ✓';status.className='completion ok';status.textContent='三大項書面意見已完成儲存（含空白欄位）';alert('三大項書面意見已完成儲存（含空白欄位）。')}
  catch(error){const message=`書面意見儲存失敗：${error.message}`;btn.textContent='儲存三大項書面意見';status.className='validation-error';status.textContent=message;alert(message)}
  finally{btn.disabled=false}
}
window.saveReviewerComments=saveAllCommentsForCurrent;
window.saveSingleComment=saveSingleCommentForCurrent;
$('#logoutBtn').onclick=logout;
requireLogin().then(boot).catch(e=>{if($('#appShell').classList.contains('hide')){$('#loginMessage').textContent=e.message}else showError(e.message)});
