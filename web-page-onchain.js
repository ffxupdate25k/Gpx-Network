import{api}from"./web-api.js";import{notify,haptic,confirmBox}from"./web-telegram.js";import{fail,esc}from"./web-utils.js";import{bottom}from"./web-page-dashboard.js";

function biometricManager(){return window.Telegram?.WebApp?.BiometricManager||null;}
function bmInit(bm){return new Promise(resolve=>{try{if(bm.isInited)return resolve(bm);bm.init(()=>resolve(bm));}catch(_){resolve(null)}})}
function bmRequest(bm){return new Promise(resolve=>{try{bm.requestAccess({reason:"Use biometrics to confirm GPX transfers."},ok=>resolve(!!ok));}catch(_){resolve(false)}})}
function bmAuth(bm){return new Promise(resolve=>{try{bm.authenticate({reason:"Confirm this GPX transfer."},r=>resolve(r||{}));}catch(_){resolve({})}})}
function bmClearToken(bm){try{if(bm?.updateToken)bm.updateToken({token:"",callback:()=>{}})}catch(_){} }

export default{async render(el,{go}){const me=await api.getMe();let recipient=null,lookupTimer=null;
 const recipientCard=(u)=>`<div class="recipient-pop"><div class="recipient-avatar">${u.photo_url?`<img src="${esc(u.photo_url)}" alt="">`:`<span>${esc((u.name||"U").slice(0,1).toUpperCase())}</span>`}</div><div><b>${esc(u.name)}</b><small>GPX Network account</small></div><span class="recipient-ok">✓</span></div>`;
 const statusPage=(title,text,done=false)=>{el.innerHTML=`<section class="page transfer-status-page"><div class="top"><button class="page-back">‹</button><div class="top-copy"><h1>GPX Network</h1><small>Onchain Transfer</small></div></div><div class="body"><div class="transfer-status-card"><div class="transfer-orbit ${done?'done':''}"><span>${done?'✓':'G'}</span></div><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="transfer-progress"><span class="transfer-progress-bar ${done?'done':''}"></span></div><small>${done?'Transfer completed successfully.':'Confirming your GPX transfer on GPX Network…'}</small></div></div>${bottom("wallet")}</section>`;};
 const pinSheet=({canBio=false,hasBio=false,needSetup=false})=>new Promise(resolve=>{
  const old=el.querySelector('.security-sheet');old?.remove();
  const box=document.createElement('div');box.className='security-sheet';
  box.innerHTML=`<div class="security-backdrop"></div><div class="security-panel"><div class="sheet-handle"></div><h3>${needSetup?'Set Transaction PIN':'Confirm Transfer'}</h3><p class="hint">${needSetup?'Create a 4-digit PIN. You will use it to authorize GPX transfers.':'Enter your 4-digit PIN or use biometrics to authorize this transfer.'}</p><div class="pin-boxes" aria-label="4 digit PIN">${[0,1,2,3].map(i=>`<input class="pin-box" data-i="${i}" inputmode="numeric" maxlength="1" autocomplete="one-time-code" aria-label="PIN digit ${i+1}">`).join('')}</div><div class="sheet-actions">${canBio?`<button class="btn ghost" id="bio">${hasBio?'☝ Use biometrics':'☝ Enable biometrics'}</button>`:''}<button class="btn" id="pinOk" disabled>${needSetup?'Save PIN':'Confirm with PIN'}</button><button class="btn ghost" id="cancel">Cancel</button></div></div>`;
  el.appendChild(box);
  const inputs=[...box.querySelectorAll('.pin-box')], save=box.querySelector('#pinOk');
  const value=()=>inputs.map(x=>x.value).join('');
  const update=()=>{const full=value().length===4;save.disabled=!full;save.classList.toggle('pin-ready',full);};
  inputs.forEach((input,i)=>{
    input.addEventListener('input',()=>{input.value=input.value.replace(/\D/g,'').slice(0,1);if(input.value&&i<3)inputs[i+1].focus();update();});
    input.addEventListener('keydown',e=>{if(e.key==='Backspace'&&!input.value&&i>0){inputs[i-1].focus();inputs[i-1].value='';update();}if(e.key==='ArrowLeft'&&i>0)inputs[i-1].focus();if(e.key==='ArrowRight'&&i<3)inputs[i+1].focus();});
    input.addEventListener('paste',e=>{e.preventDefault();const t=(e.clipboardData?.getData('text')||'').replace(/\D/g,'').slice(0,4);t.split('').forEach((d,j)=>{if(inputs[j])inputs[j].value=d});(inputs[Math.min(3,t.length-1)]||inputs[0]).focus();update();});
  });
  setTimeout(()=>inputs[0].focus(),50);
  box.querySelector('#cancel').onclick=()=>{box.remove();resolve(null)};
  save.onclick=()=>{const pin=value();if(pin.length!==4)return;box.remove();resolve({type:'pin',pin});};
  const bio=box.querySelector('#bio');if(bio)bio.onclick=async()=>{const bm=await bmInit(biometricManager());if(!bm||!bm.isBiometricAvailable)return notify('Biometrics are not available on this device.');if(!bm.isAccessGranted){const ok=await bmRequest(bm);if(!ok)return notify('Biometric access was not granted.');}if(hasBio){const r=await bmAuth(bm);if(r.isAuthenticated&&r.biometricToken){box.remove();resolve({type:'biometric',token:r.biometricToken});}else notify('Biometric verification failed.');}else{const pin=value();if(pin.length!==4)return notify('Enter your 4-digit PIN first.');const r=await bmAuth(bm);if(r.isAuthenticated&&r.biometricToken){try{await api.registerBiometric(r.biometricToken,pin);box.remove();resolve({type:'biometric',token:r.biometricToken});notify('Biometrics enabled for GPX transfers.');}catch(e){fail(e)}}else notify('Biometric verification failed.');};};
 });
 const getSecurity=async()=>{
  let sec=await api.getSecurity();
  const bm=await bmInit(biometricManager());
  const canBio=!!(bm&&bm.isBiometricAvailable);
  // First-time setup: create the PIN, then optionally register the biometric
  // using that freshly-created PIN. The previous flow asked for a second PIN
  // immediately and could never enable biometrics after setup.
  if(!sec.has_pin){
    const made=await pinSheet({canBio:false,hasBio:false,needSetup:true});
    if(!made)return null;
    await api.setPin(made.pin,'');
    sec=await api.getSecurity();
    if(canBio){
      try{
        if(!bm.isAccessGranted){
          const ok=await bmRequest(bm);
          if(!ok) return {type:'pin',pin:made.pin};
        }
        const r=await bmAuth(bm);
        if(r.isAuthenticated&&r.biometricToken){
          const registered=await api.registerBiometric(r.biometricToken,made.pin);
          if(registered?.ok!==false) return {type:'biometric',token:r.biometricToken};
        }
      }catch(e){ /* fall back to the PIN */ }
    }
    return {type:'pin',pin:made.pin};
  }
  if(canBio){
    return await pinSheet({canBio:true,hasBio:sec.has_biometric,needSetup:false});
  }
  return await pinSheet({canBio:false,hasBio:false,needSetup:false});
 };
 el.innerHTML=`<section class="page"><div class="top"><button class="page-back">‹</button><div class="top-copy"><h1>Onchain Transfer</h1><small>Mini App only</small></div></div><div class="body"><div class="tabs2"><button class="active" id="sendTab">Send</button><button id="receiveTab">Receive</button></div><div class="card"><b>Your GPX Wallet Address</b><div class="walletaddr">${esc(me.gpx_wallet_address||"No wallet generated")}</div><div class="two"><button class="btn ghost" id="copy">Copy Address</button><button class="btn ghost" id="new">Generate New</button></div><button class="btn danger" id="revoke">Revoke Old Wallet</button></div><div class="card" id="sendBox"><b>Transfer GPX</b>${me.level<10?`<div class="locknote">🔒 You must be Level 10 to transfer to other users.<br>100 referrals = 1 level.</div>`:""}<label>Recipient Wallet Address</label><input id="to" placeholder="Enter GPX wallet address" autocomplete="off"><div id="recipientBox"></div><label>Amount (GPX)</label><input id="amt" type="number" min="1" placeholder="Enter amount"><button class="btn" id="send" ${me.level<10?"disabled":""}>➤ Send GPX</button></div><div class="card" id="receiveBox" hidden><b>Receive GPX</b><p class="hint">Share this wallet address with another GPX Network user.</p><div class="walletaddr">${esc(me.gpx_wallet_address||"No wallet generated")}</div><button class="btn ghost" id="copyReceive">Copy Address</button></div></div>${bottom("wallet")}</section>`;
 const lookup=async()=>{const a=el.querySelector('#to').value.trim();const box=el.querySelector('#recipientBox');recipient=null;if(!/^0x[a-fA-F0-9]{40}$/.test(a)){box.innerHTML='';return;}try{const u=await api.transferRecipient(a);recipient=u;box.innerHTML=recipientCard(u);}catch(e){box.innerHTML=`<div class="recipient-pop bad"><div class="recipient-avatar">?</div><div><b>Wallet not found</b><small>${esc(e.message)}</small></div></div>`;}};
 el.querySelector('#to').addEventListener('input',()=>{clearTimeout(lookupTimer);lookupTimer=setTimeout(lookup,300)});
 el.querySelector('#sendTab').onclick=()=>{el.querySelector('#sendTab').classList.add('active');el.querySelector('#receiveTab').classList.remove('active');el.querySelector('#sendBox').hidden=false;el.querySelector('#receiveBox').hidden=true};el.querySelector('#receiveTab').onclick=()=>{el.querySelector('#receiveTab').classList.add('active');el.querySelector('#sendTab').classList.remove('active');el.querySelector('#sendBox').hidden=true;el.querySelector('#receiveBox').hidden=false};
 const copy=async(a)=>{if(a){try{await navigator.clipboard.writeText(a);notify('Address copied.')}catch(_){notify(a)}}};el.querySelector('#copyReceive').onclick=()=>copy(me.gpx_wallet_address);el.querySelector('#copy').onclick=()=>copy(me.gpx_wallet_address);
 el.querySelector('#new').onclick=async()=>{if(!(await confirmBox('Generate a new wallet? Your old wallet will be revoked.')))return;try{const r=await api.generateGpxWallet();notify('New GPX wallet generated.');me.gpx_wallet_address=r.address;el.querySelectorAll('.walletaddr').forEach(x=>x.textContent=r.address)}catch(e){fail(e)}};
 el.querySelector('#revoke').onclick=async()=>{if(!(await confirmBox('Revoke the old GPX wallet?')))return;try{await api.revokeGpxWallet();notify('Old wallet revoked. Generate a new wallet to receive transfers.');el.querySelectorAll('.walletaddr').forEach(x=>x.textContent='Revoked')}catch(e){fail(e)}};
 el.querySelector('#send').onclick=async()=>{const address=el.querySelector('#to').value.trim(),amount=Number(el.querySelector('#amt').value);if(!recipient||recipient.gpx_wallet_address?.toLowerCase()!==address.toLowerCase())return notify('Enter and verify a valid GPX recipient wallet first.');if(!amount||amount<=0)return notify('Enter a valid GPX amount.');if(amount>Number(me.balance))return notify('Not enough GPX balance.');try{const security=await getSecurity();if(!security)return;statusPage('Transfer Processing','Your GPX transfer has been authorized and is being processed.');const r=await api.transferGpx(address,amount,security);haptic('success');statusPage('Transfer Complete',`Sent ${Number(r.amount).toLocaleString()} GPX to ${recipient.name}.`,true);setTimeout(()=>go('onchain',true),3500);}catch(e){fail(e);}};
}};