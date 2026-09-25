import{api}from"./web-api.js";import{notify}from"./web-telegram.js";import{fail}from"./web-utils.js";

// Shared Transaction PIN + Telegram biometric helpers used by Onchain Transfer,
// Withdrawal and Profile > Security. Biometrics are only ever turned ON or OFF
// from Profile > Security — nowhere else offers to "enable" them. Transfer and
// withdrawal only ever *use* biometrics if the user already switched them on
// in Settings; otherwise they fall back to the Transaction PIN.

export function biometricManager(){return window.Telegram?.WebApp?.BiometricManager||null;}
export function bmInit(bm){return new Promise(resolve=>{try{if(!bm)return resolve(null);if(bm.isInited)return resolve(bm);bm.init(()=>resolve(bm));}catch(_){resolve(null)}})}
export function bmRequest(bm,reason){return new Promise(resolve=>{try{bm.requestAccess({reason},ok=>resolve(!!ok));}catch(_){resolve(false)}})}
export function bmAuth(bm,reason){return new Promise(resolve=>{try{bm.authenticate({reason},r=>resolve(r||{}));}catch(_){resolve({})}})}

// Generic PIN entry / creation sheet. When canUseBio is true it shows a single
// "Use biometrics" button (never an "Enable biometrics" option — enabling only
// happens in Profile > Security).
export function pinSheet(el,{title="Confirm",hint="",canUseBio=false,needSetup=false,bioReason="Confirm this action."}={}){
 return new Promise(resolve=>{
  const old=el.querySelector('.security-sheet');old?.remove();
  const box=document.createElement('div');box.className='security-sheet';
  box.innerHTML=`<div class="security-backdrop"></div><div class="security-panel"><div class="sheet-handle"></div><h3>${title}</h3><p class="hint">${hint}</p><div class="pin-boxes" aria-label="4 digit PIN">${[0,1,2,3].map(i=>`<input class="pin-box" data-i="${i}" inputmode="numeric" maxlength="1" autocomplete="one-time-code" aria-label="PIN digit ${i+1}">`).join('')}</div><div class="sheet-actions">${canUseBio?`<button class="btn ghost" id="bio">☝ Use biometrics</button>`:''}<button class="btn" id="pinOk" disabled>${needSetup?'Save PIN':'Confirm with PIN'}</button><button class="btn ghost" id="cancel">Cancel</button></div></div>`;
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
  const bio=box.querySelector('#bio');
  if(bio)bio.onclick=async()=>{
   const bm=await bmInit(biometricManager());
   if(!bm||!bm.isBiometricAvailable)return notify('Biometrics are not available on this device.');
   if(!bm.isAccessGranted){const ok=await bmRequest(bm,bioReason);if(!ok)return notify('Biometric access was not granted.');}
   const r=await bmAuth(bm,bioReason);
   if(r.isAuthenticated&&r.biometricToken){box.remove();resolve({type:'biometric',token:r.biometricToken});}
   else notify('Biometric verification failed.');
  };
 });
}

// Confirms a security-sensitive action (a GPX transfer or a withdrawal).
// Requires the Transaction PIN either way; if the user already turned
// biometrics on in Profile > Security, it's offered as an alternative to
// typing the PIN. Never offers to turn biometrics on from here.
export async function confirmSecurity(el,{actionLabel='this action'}={}){
 let sec;
 try{sec=await api.getSecurity();}catch(e){fail(e);return null;}
 if(!sec.has_pin){
  const made=await pinSheet(el,{title:'Set Transaction PIN',hint:`Create a 4-digit PIN. You will use it to authorize ${actionLabel}.`,canUseBio:false,needSetup:true});
  if(!made)return null;
  try{await api.setPin(made.pin,'');}catch(e){fail(e);return null;}
  return {type:'pin',pin:made.pin};
 }
 return await pinSheet(el,{title:'Confirm',hint:`Enter your 4-digit PIN${sec.has_biometric?' or use biometrics':''} to authorize ${actionLabel}.`,canUseBio:!!sec.has_biometric,needSetup:false,bioReason:`Confirm ${actionLabel}.`});
}
