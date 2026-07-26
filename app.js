const state={data:null,editingId:null,busy:false,cardFilter:''};
const $=id=>document.getElementById(id);

document.addEventListener('DOMContentLoaded',()=>{
  bindUI(); setToday(); loadCached();
  if(configReady()) refreshData(); else openSettings(true);
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
});

function bindUI(){
  document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page,b)));
  $('refreshBtn').addEventListener('click',refreshData);
  $('settingsBtn').addEventListener('click',()=>openSettings());
  $('closeSettings').addEventListener('click',closeSettings);
  $('saveSettings').addEventListener('click',saveSettings);
  $('clearSettings').addEventListener('click',clearSettings);
  $('txForm').addEventListener('submit',submitTransaction);
  $('cancelEditBtn').addEventListener('click',resetForm);
  $('txSearch').addEventListener('input',renderTransactions);
  $('txCardFilter').addEventListener('change',()=>{state.cardFilter=$('txCardFilter').value;renderTransactions();});
}

function configReady(){return !!(localStorage.getItem('cc_api_url')&&localStorage.getItem('cc_api_key'))}
function apiUrl(){return (localStorage.getItem('cc_api_url')||'').trim()}
function apiKey(){return (localStorage.getItem('cc_api_key')||'').trim()}

function openSettings(force=false){
  $('apiUrl').value=apiUrl(); $('apiKey').value=apiKey();
  $('settingsModal').classList.remove('hidden');
  if(force) $('closeSettings').classList.add('hidden'); else $('closeSettings').classList.remove('hidden');
}
function closeSettings(){if(configReady()) $('settingsModal').classList.add('hidden')}
function saveSettings(){
  const u=$('apiUrl').value.trim(),k=$('apiKey').value.trim();
  if(!u.endsWith('/exec')) return toast('Use the Apps Script Web App URL ending in /exec.');
  if(!k) return toast('Paste the API key.');
  localStorage.setItem('cc_api_url',u);localStorage.setItem('cc_api_key',k);
  $('settingsModal').classList.add('hidden'); refreshData();
}
function clearSettings(){
  localStorage.removeItem('cc_api_url');localStorage.removeItem('cc_api_key');
  state.data=null;localStorage.removeItem('cc_cache');renderEmpty();openSettings(true);
}


async function loadDataWithRetry(){
  let lastError;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      return await jsonp('data',null,30000);
    }catch(err){
      lastError=err;
      if(attempt<3){
        setSyncStatus(`Retrying connection (${attempt+1}/3)…`,'syncing');
        await wait(900*attempt);
      }
    }
  }
  throw lastError||new Error('Unable to connect.');
}

function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function setSyncStatus(text,kind=''){ $('syncText').textContent=text; document.body.dataset.syncState=kind; }

function refreshData(){
  if(!configReady()){
    openSettings(true);
    return Promise.reject(new Error('Connection settings are missing.'));
  }
  setBusy(true);
  setSyncStatus('Syncing…','syncing');
  return loadDataWithRetry()
    .then(result=>{
      state.data=result.data;
      localStorage.setItem('cc_cache',JSON.stringify(state.data));
      renderAll();
      setSyncStatus('synced '+state.data.syncedAt,'ok');
      return state.data;
    })
    .catch(err=>{
      setSyncStatus('offline / last saved view','offline');
      toast(err.message||'Unable to refresh.');
      throw err;
    })
    .finally(()=>setBusy(false));
}

function jsonp(action,payload=null,timeoutMs=30000){
  return new Promise((resolve,reject)=>{
    const cb='__cccb_'+Date.now()+'_'+Math.floor(Math.random()*1e6);
    const script=document.createElement('script');
    const timer=setTimeout(()=>done(new Error('Connection timed out.')),timeoutMs);

    function cleanup(){
      clearTimeout(timer);
      try{delete window[cb]}catch(_){}
      script.remove();
    }

    function done(err,data){
      cleanup();
      if(err)return reject(err);
      if(!data || data.ok!==true){
        return reject(new Error((data&&data.error)||'Google Sheet action failed.'));
      }
      resolve(data);
    }

    window[cb]=data=>done(null,data);
    script.onerror=()=>done(new Error('Could not reach the Google Sheet API.'));

    const u=new URL(apiUrl());
    u.searchParams.set('action',action);
    u.searchParams.set('key',apiKey());
    u.searchParams.set('callback',cb);
    if(payload!==null) u.searchParams.set('payload',JSON.stringify(payload));
    u.searchParams.set('_',Date.now());

    script.src=u.toString();
    document.head.appendChild(script);
  });
}

function postAction(action,payload){
  // JSONP is used for write operations too. This avoids cross-origin iframe
  // redirect issues and lets the app receive the actual Apps Script error.
  return jsonp(action,payload);
}

function loadCached(){
  try{const d=JSON.parse(localStorage.getItem('cc_cache')||'null');if(d){state.data=d;renderAll();$('syncText').textContent='last saved view'}}catch(_){}
}
function renderEmpty(){['totalDebt','totalLimit','availableCredit','paymentsThisMonth'].forEach(id=>$(id).textContent='$0.00');$('overallUtilization').textContent='0.0%';$('attentionCount').textContent='0';$('dashboardCards').innerHTML='';$('allCards').innerHTML='';$('transactionList').innerHTML='';$('paymentList').innerHTML=''}

function renderAll(){
  if(!state.data)return;
  fillSelect('txCard',state.data.cards.map(c=>c.name),'Select card');
  fillSelect('txType',state.data.transactionTypes,'Select type');
  fillSelect('txCategory',state.data.categories,'Select category');
  fillFilterSelect();
  renderDashboard();renderTransactions();renderPayments();renderCards();
}
function fillFilterSelect(){
  const s=$('txCardFilter'); if(!s)return;
  const cards=state.data.cards.map(c=>c.name);
  s.innerHTML='<option value="">All Cards</option>'+cards.map(x=>`<option value="${attr(x)}">${esc(x)}</option>`).join('');
  if(state.cardFilter && cards.includes(state.cardFilter)) s.value=state.cardFilter;
  else {state.cardFilter='';s.value='';}
}
function openCardTransactions(cardName){
  state.cardFilter=cardName||'';
  const f=$('txCardFilter'); if(f)f.value=state.cardFilter;
  showPage('transactions',document.querySelector('[data-page="transactions"]'));
  renderTransactions();
  setTimeout(()=>document.getElementById('transactionList')?.scrollIntoView({behavior:'smooth',block:'start'}),50);
}

function renderDashboard(){
  const s=state.data.summary;
  $('totalDebt').textContent=money(s.totalDebt);$('totalLimit').textContent=money(s.totalCreditLimit);
  $('availableCredit').textContent=money(s.availableCredit);$('overallUtilization').textContent=pct(s.overallUtilization);
  $('paymentsThisMonth').textContent=money(s.paymentsThisMonth);$('attentionCount').textContent=s.cardsNeedingAttention;
  $('dashboardCards').innerHTML=s.cards.map(c=>cardHTML(c,true)).join('');
}
function renderCards(){$('allCards').innerHTML=state.data.summary.cards.map(c=>cardHTML(c,true)).join('')}
function cardHTML(c,clickable=false){
  const cls=String(c.status).toLowerCase().replace(/\s+/g,'-');
  const click=clickable?` onclick="openCardTransactions('${attr(c.name)}')" role="button" tabindex="0" class="ccard clickable"`:' class="ccard"';
  return `<article${click}><div class="ccard-top"><div><h3>${esc(c.name)}</h3><span class="due">Due day ${esc(c.dueDay)}</span></div><span class="status ${esc(c.status).replace(/\s/g,'-')}">${esc(c.status)}</span></div>
  <div class="balance">${money(c.balance)}</div><div class="ccard-meta"><div><span>Limit</span><b>${money(c.limit)}</b></div><div><span>Available</span><b>${money(c.available)}</b></div><div><span>Utilization</span><b>${pct(c.utilization)}</b></div><div><span>Payments this month</span><b>${money(c.paymentsThisMonth)}</b></div></div>
  <div class="util-track"><div class="util-fill ${cls}" style="width:${Math.min(100,Math.max(0,c.utilization*100))}%"></div></div></article>`;
}


function txVisual(type){
  const t=String(type||'').toLowerCase();
  if(['purchase','interest','fee'].includes(t)){
    return {cls:'charge',label:'Charge',sign:'+'};
  }
  if(['payment','credit/refund'].includes(t)){
    return {cls:'credit',label:t==='payment'?'Payment':'Credit / Refund',sign:'−'};
  }
  return {cls:'neutral',label:type||'Other',sign:''};
}

function signedMoney(type,amount){
  const v=txVisual(type);
  return `${v.sign}${money(Math.abs(Number(amount||0)))}`;
}

function renderTransactions(){
  if(!state.data)return;
  const q=$('txSearch').value.trim().toLowerCase();
  const rows=state.data.transactions.filter(t=>{
    if(state.cardFilter && t.card!==state.cardFilter) return false;
    return !q||[t.date,t.card,t.description,t.category,t.type,t.notes].join(' ').toLowerCase().includes(q);
  });
  $('transactionList').innerHTML=rows.length?rows.map(t=>{
    const v=txVisual(t.type);
    return `<article class="tx-row ${v.cls}">
      <div class="tx-date">${datePretty(t.date)}</div>
      <div class="tx-main">
        <b>${esc(t.card)} · ${esc(t.description||t.type)}</b>
        <small><span class="tx-badge ${v.cls}">${esc(v.label)}</span> ${esc(t.category)}${t.notes?' · '+esc(t.notes):''}</small>
      </div>
      <div class="tx-amount ${v.cls}">${signedMoney(t.type,t.amount)}</div>
      <div class="tx-actions">
        <button class="small-btn" onclick="editTx('${attr(t.id)}')">Edit</button>
        <button class="small-btn delete" onclick="deleteTx('${attr(t.id)}')">Delete</button>
      </div>
    </article>`;
  }).join(''):'<p class="help">No transactions found.</p>';
}
function renderPayments(){
  const pays=state.data.payments||[];$('payTotal').textContent=money(state.data.summary.paymentsThisMonth);
  $('payYear').textContent=(state.data.monthlyPayments[0]||{}).year||new Date().getFullYear();
  $('paymentList').innerHTML=pays.length?pays.map(t=>`<article class="tx-row credit"><div class="tx-date">${datePretty(t.date)}</div><div class="tx-main"><b>${esc(t.card)} · ${esc(t.description||'Payment')}</b><small><span class="tx-badge credit">Payment</span> ${esc(t.referenceConfirmation||'No confirmation number')}</small></div><div class="tx-amount credit">−${money(Math.abs(Number(t.amount||0)))}</div></article>`).join(''):'<p class="help">No payments recorded.</p>';
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const table=$('monthlyTable');table.querySelector('thead').innerHTML='<tr><th>Card</th>'+months.map(m=>`<th>${m}</th>`).join('')+'</tr>';
  table.querySelector('tbody').innerHTML=(state.data.monthlyPayments||[]).map(r=>'<tr><td>'+esc(r.card)+'</td>'+r.months.map(v=>`<td>${money(v)}</td>`).join('')+'</tr>').join('');
}

async function runWriteAction(action,payload){
  setSyncStatus('Saving…','saving');
  const result=await jsonp(action,payload,45000);
  setSyncStatus('Saved ✓','saved');
  return result;
}

async function submitTransaction(e){
  e.preventDefault();
  if(state.busy)return;

  const wasEditing=!!state.editingId;
  const tx={
    id:state.editingId||'',
    date:$('txDate').value,
    card:$('txCard').value,
    type:$('txType').value,
    category:$('txCategory').value,
    description:$('txDescription').value.trim(),
    amount:Number($('txAmount').value),
    referenceConfirmation:$('txReference').value.trim(),
    notes:$('txNotes').value.trim()
  };

  if(!tx.card||!tx.type||!tx.category||!(tx.amount>0)){
    return toast('Complete Card, Type, Category and Amount.');
  }

  state.busy=true;
  $('saveBtn').disabled=true;
  $('refreshBtn').disabled=true;
  $('saveBtn').textContent=wasEditing?'Saving Changes…':'Saving…';

  try{
    await runWriteAction(wasEditing?'update':'add',tx);
    clearTransactionForm();
    toast(wasEditing?'Transaction updated.':'Transaction saved.');
    try{
      await refreshData();
    }catch(refreshErr){
      toast('Saved to Google Sheets. Refresh is still catching up.');
    }
  }catch(err){
    const msg=String(err&&err.message||'Unable to save.');
    if(msg.toLowerCase().includes('timed out')){
      toast('Save status is uncertain. Press Refresh before trying again.');
      setSyncStatus('Check before retrying','warning');
    }else{
      toast(msg);
      setSyncStatus('Save failed','error');
    }
  }finally{
    state.busy=false;
    $('saveBtn').disabled=false;
    $('refreshBtn').disabled=false;
    $('saveBtn').textContent='Save Transaction';
  }
}
function editTx(id){
  const t=state.data.transactions.find(x=>x.id===id);if(!t)return;
  state.editingId=id;$('formTitle').textContent='Edit Transaction';$('saveBtn').textContent='Save Changes';$('cancelEditBtn').classList.remove('hidden');
  $('txId').value=id;$('txDate').value=t.date;$('txCard').value=t.card;$('txType').value=t.type;$('txCategory').value=t.category;$('txDescription').value=t.description;$('txAmount').value=t.amount;$('txReference').value=t.referenceConfirmation;$('txNotes').value=t.notes;
  showPage('transactions',document.querySelector('[data-page="transactions"]'));window.scrollTo({top:0,behavior:'smooth'});
}
async function deleteTx(id){
  const t=state.data.transactions.find(x=>x.id===id);
  if(!t)return;
  if(!confirm(`Delete ${t.card} · ${t.description||t.type} · ${money(t.amount)}?

This removes it from Google Sheets and recalculates all balances.`))return;

  state.busy=true;
  $('refreshBtn').disabled=true;
  try{
    await runWriteAction('delete',{id});
    toast('Transaction deleted.');
    try{
      await refreshData();
    }catch(refreshErr){
      toast('Deleted from Google Sheets. Refresh is still catching up.');
    }
  }catch(err){
    const msg=String(err&&err.message||'Unable to delete.');
    if(msg.toLowerCase().includes('timed out')){
      toast('Delete status is uncertain. Press Refresh before trying again.');
      setSyncStatus('Check before retrying','warning');
    }else{
      toast('Delete failed: '+msg);
      setSyncStatus('Delete failed','error');
    }
  }finally{
    state.busy=false;
    $('refreshBtn').disabled=false;
  }
}
function clearTransactionForm(){
  state.editingId=null;$('formTitle').textContent='Add Transaction';$('saveBtn').textContent='Save Transaction';$('cancelEditBtn').classList.add('hidden');
  $('txId').value='';$('txCard').value='';$('txType').value='';$('txCategory').value='';$('txDescription').value='';$('txAmount').value='';$('txReference').value='';$('txNotes').value='';setToday();
}
function resetForm(){clearTransactionForm()}
function setToday(){const d=new Date();$('txDate').value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}

function fillSelect(id,items,placeholder){const s=$(id),old=s.value;s.innerHTML=`<option value="">${placeholder}</option>`+items.map(x=>`<option value="${attr(x)}">${esc(x)}</option>`).join('');if(items.includes(old))s.value=old}
function showPage(id,btn){document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===id));document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b===btn))}
function setBusy(v){state.busy=v;document.body.style.cursor=v?'progress':'';$('saveBtn').disabled=v;$('refreshBtn').disabled=v}
function money(v){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v||0))}
function pct(v){return new Intl.NumberFormat('en-US',{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1}).format(Number(v||0))}
function datePretty(v){if(!v)return'';const p=v.split('-').map(Number);return p.length===3?new Date(p[0],p[1]-1,p[2]).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}):esc(v)}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function attr(v){return esc(v).replace(/`/g,'&#096;')}
let toastTimer;function toast(m){const t=$('toast');t.textContent=m;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3000)}
